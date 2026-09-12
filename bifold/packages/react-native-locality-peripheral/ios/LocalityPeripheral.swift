import CoreBluetooth
import CryptoKit
import DeviceCheck
import Foundation
import LocalAuthentication

/**
 The device's BLE peripheral role in the locality ceremony
 (locality-plan.md §10.3 item 9), iOS side — the counterpart to
 `LocalityPeripheralModule.kt`, serving the identical wire protocol to
 witness-server's `BleLocalityProvider.runTranscriptExchange()`: advertise the
 rendezvous EID as a service UUID, accept the sensor's nonce on one
 characteristic, serve the signed transcript across two, all inside the
 ceremony window and foreground only.

 Read `LocalityPeripheralModule.kt` first. This file mirrors its structure
 deliberately — same lifecycle, same two-characteristic split, same JCS
 binding, same `null`-not-reject contract — so the two can be diffed. What
 follows are only the places iOS genuinely cannot mirror it.

 ## Why the signature has a different shape here

 Android signs the binding directly with `SHA256withECDSA` and hands back DER.
 iOS cannot. The key the VRC evidence already commits to is an App Attest key,
 and App Attest keys are reachable only through
 `DCAppAttestService.generateAssertion`, which returns a CBOR map
 `{signature, authenticatorData}` whose signature covers
 `SHA256(authenticatorData ‖ SHA256(binding))`.

 The alternative — minting a second, ordinary Secure Enclave key that CAN
 produce Android-shaped bytes — was considered and rejected: its public key
 would differ from the one in the VRC evidence, so
 `transcriptKeyMatchesVrcSigner` on the witness would never match, discarding
 the single check that ties the device on the radio to the device in the
 credential. The witness learns App Attest instead
 (`witness-server/src/trustTasks/appAttest.ts`). See
 docs/plans/locality-plan/2026-09-12-al.md.

 ## Why the biometric prompt cannot pre-authorize the signature

 Android's whole reason for splitting auth from signing is that a
 `CryptoObject`-bound `Signature` can be authorized once, before advertising,
 and used later without a second prompt — keeping the OS prompt out of the
 RTT-bound window.

 There is no iOS equivalent. An App Attest key is not protected by an access
 control the way a `kSecAccessControlBiometryCurrentSet` Secure Enclave key
 is; `generateAssertion` takes no `LAContext` and cannot be pre-armed. So the
 `LAContext` prompt here is a POLICY gate, not a cryptographic one — exactly
 what `Attestation.mm`'s `signWithHardwareKey` already does for VRC content
 signing, and kept identical to it so both prompts behave the same way for the
 same `authMode`.

 The consequence is a real timing risk that Android does not have:
 `generateAssertion` runs INSIDE the window, after the nonce arrives. It is a
 local operation with no network, so it should be fast — but "should be" is
 not a measurement, and `PROVISIONAL_RTT_BOUND_MS` on the witness is only
 400ms. `signingElapsedMs` is logged on every run specifically so a live
 device run can answer this. MEASURE IT BEFORE TRUSTING THIS IN PRODUCTION.

 ## Why reads may arrive before there is anything to serve

 Following from the above: Android signs synchronously inside its write
 callback, so by the time it responds to the write, the transcript is ready.
 Here the write callback returns while `generateAssertion` is still in flight,
 and the central may well read before it lands. Those reads are queued
 (`pendingReadRequests`) and flushed when the assertion arrives, rather than
 answered with an error — failing them would abort a perfectly good ceremony
 over a few milliseconds of Apple's scheduling.
 */
@objc(LocalityPeripheral)
class LocalityPeripheral: NSObject {

  private static let logPrefix = "[Locality:Peripheral:iOS]"

  /**
   DELIBERATE DUPLICATES of `Attestation.mm`'s own keychain coordinates —
   `KeychainServiceName`, `keychainIdentifier2()` and
   `keychainIdentifierAppAttestPublicKey()`. This is the iOS twin of
   `LocalityPeripheralModule.kt`'s `HARDWARE_SIGNING_KEY_ALIAS` duplication
   and exists for the same stated reason: a real cross-package native
   dependency between two independent RN modules is fragile to wire without a
   build to verify it against.

   The coupling is load-bearing, not incidental. Reading a DIFFERENT keychain
   item here would mean signing with a different key than the VRC evidence
   commits to, and `transcriptKeyMatchesVrcSigner` would silently report false
   on every ceremony — the exact failure this whole design exists to avoid. If
   `Attestation.mm` ever renames these, this file must move with it.
   */
  private static let keychainService = "AriesAttestation"
  /// Suffixes, not whole accounts — both sides append them to the bundle id.
  /// Split out as their own literals so `jcsBindingParity.test.ts` can assert
  /// character-for-character that these are the same strings `Attestation.mm`
  /// writes; interpolated into one expression they were unmatchable.
  private static let keyIdAccountSuffix = ".AttestationKey"
  private static let publicKeyAccountSuffix = ".AppAttestPublicKey"
  private static var bundleId: String { Bundle.main.bundleIdentifier ?? "" }
  private static var keyIdAccount: String { bundleId + keyIdAccountSuffix }
  private static var publicKeyAccount: String { bundleId + publicKeyAccountSuffix }

  // ------------------------------------------------------------- active call

  /// One in-flight ceremony at a time, mirroring Android's `ActiveCall`.
  private final class ActiveCall {
    let resolve: RCTPromiseResolveBlock
    let reject: RCTPromiseRejectBlock
    let serviceUuid: CBUUID
    let characteristicUuid: CBUUID
    let signatureCharacteristicUuid: CBUUID
    let contextString: String
    let method: String
    let taskDigestMultibase: String
    let challenge: String
    let sensorDid: String
    let hardwareAttestation: String
    let devicePublicKeyBase64: String
    let keyId: String
    let windowSeconds: Double

    var settled = false
    var timeoutTimer: DispatchSourceTimer?
    var pendingResult: [String: Any]?
    /// See the two-characteristic note in `startAdvertisingAndServe`.
    var pendingCoreResponseBytes: Data?
    var pendingSignatureResponseBytes: Data?
    var coreFullyServed = false
    var signatureFullyServed = false
    /// Reads that arrived while `generateAssertion` was still in flight.
    var pendingReadRequests: [CBATTRequest] = []
    var advertisingStarted = false

    init(
      resolve: @escaping RCTPromiseResolveBlock,
      reject: @escaping RCTPromiseRejectBlock,
      serviceUuid: CBUUID,
      characteristicUuid: CBUUID,
      signatureCharacteristicUuid: CBUUID,
      contextString: String,
      method: String,
      taskDigestMultibase: String,
      challenge: String,
      sensorDid: String,
      hardwareAttestation: String,
      devicePublicKeyBase64: String,
      keyId: String,
      windowSeconds: Double
    ) {
      self.resolve = resolve
      self.reject = reject
      self.serviceUuid = serviceUuid
      self.characteristicUuid = characteristicUuid
      self.signatureCharacteristicUuid = signatureCharacteristicUuid
      self.contextString = contextString
      self.method = method
      self.taskDigestMultibase = taskDigestMultibase
      self.challenge = challenge
      self.sensorDid = sensorDid
      self.hardwareAttestation = hardwareAttestation
      self.devicePublicKeyBase64 = devicePublicKeyBase64
      self.keyId = keyId
      self.windowSeconds = windowSeconds
    }
  }

  private var activeCall: ActiveCall?
  private var peripheralManager: CBPeripheralManager?
  /// Everything touching `activeCall` or CoreBluetooth runs here — CB delivers
  /// its callbacks on the queue it was constructed with, and the RN method
  /// calls arrive on RN's own queue.
  private let queue = DispatchQueue(label: "org.keyring.locality.peripheral")
  /// Set while waiting for `poweredOn`, since a manager's state is not ready
  /// the instant it is constructed.
  private var startAdvertisingWhenPoweredOn = false

  @objc static func requiresMainQueueSetup() -> Bool { false }

  // ------------------------------------------------------------- isSupported

  @objc(isSupported:reject:)
  func isSupported(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    // A capability question, not a permission or timing one (see the Spec's
    // own doc comment). App Attest is part of the capability here: without it
    // this module can advertise but never produce a signature the witness
    // would accept, which is not "supported" in any useful sense.
    guard DCAppAttestService.shared.isSupported else {
      NSLog("\(Self.logPrefix) unsupported: App Attest unavailable (simulator, or unsupported device)")
      resolve(false)
      return
    }
    // CBPeripheralManager's state is only knowable asynchronously, and
    // constructing one purely to read it would trigger the permission prompt
    // as a side effect of a capability check. `CBManager.authorization` is the
    // documented way to ask without that, and the peripheral role itself is
    // available on every iOS version this package supports.
    if #available(iOS 13.1, *) {
      let authorization = CBManager.authorization
      resolve(authorization != .restricted && authorization != .denied)
    } else {
      resolve(true)
    }
  }

  // --------------------------------------------------------- respondToSensor

  @objc(respondToSensor:resolve:reject:)
  func respondToSensor(
    _ params: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { self.startRespondToSensor(params, resolve: resolve, reject: reject) }
  }

  private func startRespondToSensor(
    _ params: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    if activeCall != nil {
      reject("error", "A locality ceremony is already in progress", nil)
      return
    }

    guard
      let serviceUuidString = params["serviceUuid"] as? String,
      let characteristicUuidString = params["characteristicUuid"] as? String,
      let signatureCharacteristicUuidString = params["signatureCharacteristicUuid"] as? String,
      let contextString = params["contextString"] as? String,
      let method = params["method"] as? String,
      let taskDigestMultibase = params["taskDigestMultibase"] as? String,
      let challenge = params["challenge"] as? String,
      let sensorDid = params["sensorDid"] as? String,
      let hardwareAttestation = params["hardwareAttestation"] as? String,
      let windowSeconds = (params["windowSeconds"] as? NSNumber)?.doubleValue,
      let authMode = params["authMode"] as? String
    else {
      reject("error", "respondToSensor: missing or malformed params", nil)
      return
    }

    // CBUUID(string:) traps on malformed input rather than returning nil, so
    // the shape is checked first — a malformed UUID must reject, not crash.
    guard
      let serviceUuid = Self.parseUuid(serviceUuidString),
      let characteristicUuid = Self.parseUuid(characteristicUuidString),
      let signatureCharacteristicUuid = Self.parseUuid(signatureCharacteristicUuidString)
    else {
      reject("error", "respondToSensor: malformed UUID", nil)
      return
    }

    guard DCAppAttestService.shared.isSupported else {
      // An environment problem the caller should treat as a bug, matching
      // Android's "hardware signing key unavailable" rejection — not a
      // ceremony outcome.
      reject("error", "App Attest is not available on this device", nil)
      return
    }

    guard let keyId = Self.keychainString(account: Self.keyIdAccount), !keyId.isEmpty else {
      reject("error", "Hardware signing key unavailable: no App Attest key exists yet", nil)
      return
    }
    guard let publicKeyData = Self.keychainData(account: Self.publicKeyAccount), !publicKeyData.isEmpty else {
      // The public key is cached by `Attestation.mm` when the key is attested.
      // Its absence means attestation never completed, so there is nothing the
      // witness could match against even if this signed successfully.
      reject("error", "Hardware signing key unavailable: no cached App Attest public key", nil)
      return
    }

    let call = ActiveCall(
      resolve: resolve,
      reject: reject,
      serviceUuid: serviceUuid,
      characteristicUuid: characteristicUuid,
      signatureCharacteristicUuid: signatureCharacteristicUuid,
      contextString: contextString,
      method: method,
      taskDigestMultibase: taskDigestMultibase,
      challenge: challenge,
      sensorDid: sensorDid,
      hardwareAttestation: hardwareAttestation,
      // Base64 of the RAW 65-byte EC point, which is what
      // `SecKeyCopyExternalRepresentation` produced when `Attestation.mm`
      // cached it — NOT SPKI-wrapped as on Android. witness-server's
      // `rawPointFromDevicePublicKey` accepts both; the `===` in
      // `transcriptKeyMatchesVrcSigner` is what actually requires this to be
      // byte-identical to the VRC evidence's own copy.
      devicePublicKeyBase64: publicKeyData.base64EncodedString(),
      keyId: keyId,
      windowSeconds: windowSeconds
    )
    activeCall = call

    authorize(authMode: authMode) { [weak self] authorized in
      guard let self else { return }
      self.queue.async {
        guard self.activeCall === call, !call.settled else { return }
        guard authorized else {
          // §7.1's declinedByHolder — a normal outcome, resolved as null.
          self.finish(call, result: nil)
          return
        }
        self.startAdvertisingAndServe(call)
      }
    }
  }

  @objc(stopAdvertising:reject:)
  func stopAdvertising(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      if let call = self.activeCall {
        self.finish(call, result: nil)
      } else {
        self.teardownRadio()
      }
      resolve(nil)
    }
  }

  // ------------------------------------------------------------ authorization

  /**
   The policy gate. Identical in intent and wording to `Attestation.mm`'s VRC
   content-signing prompt, because both authorize use of the SAME App Attest
   key and a user seeing two different prompts for one ceremony would be
   reading a distinction that does not exist.

   `LAPolicyDeviceOwnerAuthentication` (not `...WithBiometrics`) so passcode
   remains a fallback, matching `allowedAuthenticatorsFor` on Android.
   */
  private func authorize(authMode: String, completion: @escaping (Bool) -> Void) {
    let context = LAContext()
    let passcodeOnly = authMode == "passcode"
    // iOS has no DEVICE_CREDENTIAL-only policy to match Android's. With
    // biometrics enrolled it will still offer Face ID first and let the user
    // fall back to the passcode — `Attestation.mm` documents the same
    // limitation for VRC content signing, and the two must not diverge, so
    // `authMode` changes only the wording here. (There is a private KVC key
    // that suppresses the biometric attempt; it is deliberately not used.)
    NSLog("\(Self.logPrefix) ▶ Authorizing with \(passcodeOnly ? "passcode" : "biometric") auth [authMode=\(authMode)]")

    let reason = passcodeOnly
      ? "Enter your device passcode to sign the locality confirmation"
      : "Authenticate to sign the locality confirmation"
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
      if !success {
        NSLog("\(Self.logPrefix) Authorization declined/failed: \(error?.localizedDescription ?? "unknown")")
      }
      completion(success)
    }
  }

  // ------------------------------------------------------------ BLE lifecycle

  private func startAdvertisingAndServe(_ call: ActiveCall) {
    startAdvertisingWhenPoweredOn = true
    // Constructed here rather than at init so the OS permission prompt appears
    // as part of a ceremony the user just authorized, not at app launch.
    if peripheralManager == nil {
      peripheralManager = CBPeripheralManager(delegate: self, queue: queue, options: nil)
    } else if peripheralManager?.state == .poweredOn {
      publishServiceAndAdvertise(call)
    }

    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + max(call.windowSeconds, 0))
    timer.setEventHandler { [weak self] in
      guard let self, let current = self.activeCall, current === call, !call.settled else { return }
      NSLog("\(Self.logPrefix) Window elapsed with no completed observation")
      self.finish(call, result: nil)
    }
    call.timeoutTimer = timer
    timer.resume()
  }

  private func publishServiceAndAdvertise(_ call: ActiveCall) {
    guard let manager = peripheralManager, !call.advertisingStarted else { return }
    call.advertisingStarted = true

    // TWO characteristics, not one — the same hard GATT ceiling Android hit
    // live on 2026-08-21: a single attribute value cannot exceed 512 bytes
    // (Bluetooth Core Spec Vol 3, Part F, §3.2.9) no matter what MTU is
    // negotiated, and a full transcript runs past that once it carries a real
    // key and signature. Core keeps the write side; signature is read-only.
    //
    // `value: nil` on both is REQUIRED, not incidental: CoreBluetooth treats a
    // characteristic constructed with a non-nil value as a cached static
    // value, refuses to make it writable, and never calls the read delegate at
    // all — the transcript would never be served and the ceremony would time
    // out with no error anywhere.
    let coreCharacteristic = CBMutableCharacteristic(
      type: call.characteristicUuid,
      properties: [.write, .read],
      value: nil,
      permissions: [.writeable, .readable]
    )
    let signatureCharacteristic = CBMutableCharacteristic(
      type: call.signatureCharacteristicUuid,
      properties: [.read],
      value: nil,
      permissions: [.readable]
    )
    let service = CBMutableService(type: call.serviceUuid, primary: true)
    service.characteristics = [coreCharacteristic, signatureCharacteristic]

    manager.removeAllServices()
    manager.add(service)
    // The 128-bit service UUID goes in the advertisement proper only while the
    // app is in the FOREGROUND. Backgrounded, iOS moves 128-bit UUIDs into the
    // "overflow" area, which only other iOS devices scanning for that exact
    // UUID can see — invisible to the witness's BlueZ/noble central. The
    // ceremony is foreground-only by design (plan §10.3 item 9), so this is a
    // constraint the design already accepts rather than a limitation to fix.
    manager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [call.serviceUuid]])
  }

  // ------------------------------------------------------------ the signing

  /// Called on `queue` once the sensor's nonce has arrived.
  private func signAndPrepareTranscript(_ call: ActiveCall, sensorNonce: String) {
    let binding = Self.jcsBinding(
      contextString: call.contextString,
      taskDigestMultibase: call.taskDigestMultibase,
      challenge: call.challenge,
      sensorNonce: sensorNonce,
      sensorDid: call.sensorDid
    )
    let clientDataHash = Data(SHA256.hash(data: binding))
    let startedAt = Date()

    DCAppAttestService.shared.generateAssertion(call.keyId, clientDataHash: clientDataHash) { [weak self] assertion, error in
      guard let self else { return }
      self.queue.async {
        guard self.activeCall === call, !call.settled else { return }
        let elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1000)
        guard let assertion, error == nil else {
          NSLog("\(Self.logPrefix) ✗ generateAssertion failed after \(elapsedMs)ms: \(error?.localizedDescription ?? "unknown")")
          self.finishWithError(call, "Failed to sign transcript: \(error?.localizedDescription ?? "assertion failed")")
          return
        }
        // The one number a live device run exists to produce: this is the
        // latency Android does not pay, spent inside witness-server's own
        // RTT bound. See this file's header.
        NSLog("\(Self.logPrefix) ✓ Assertion created [\(assertion.count) bytes, signingElapsedMs=\(elapsedMs)]")

        let signatureBase64Url = Self.base64UrlNoPadding(assertion)
        call.pendingCoreResponseBytes = Self.coreTranscriptJson(
          method: call.method,
          taskDigestMultibase: call.taskDigestMultibase,
          challenge: call.challenge,
          sensorNonce: sensorNonce,
          sensorDid: call.sensorDid,
          hardwareAttestation: call.hardwareAttestation
        )
        call.pendingSignatureResponseBytes = Self.signatureTranscriptJson(
          devicePublicKeyBase64: call.devicePublicKeyBase64,
          signatureBase64Url: signatureBase64Url
        )
        call.pendingResult = [
          "sensorNonceHex": sensorNonce,
          "devicePublicKeyBase64": call.devicePublicKeyBase64,
          "signatureBase64Url": signatureBase64Url,
        ]

        // Anything the central asked for while Apple was signing.
        let queued = call.pendingReadRequests
        call.pendingReadRequests = []
        for request in queued { self.serveRead(call, request: request) }
      }
    }
  }

  // ------------------------------------------------------------- serving reads

  private func serveRead(_ call: ActiveCall, request: CBATTRequest) {
    guard let manager = peripheralManager else { return }
    let isSignature = request.characteristic.uuid == call.signatureCharacteristicUuid
    guard isSignature || request.characteristic.uuid == call.characteristicUuid else {
      manager.respond(to: request, withResult: .attributeNotFound)
      return
    }
    guard let fullValue = isSignature ? call.pendingSignatureResponseBytes : call.pendingCoreResponseBytes else {
      // Still signing — hold it rather than failing the ceremony. See header.
      call.pendingReadRequests.append(request)
      return
    }
    guard request.offset <= fullValue.count else {
      manager.respond(to: request, withResult: .invalidOffset)
      return
    }

    // Truncate to the central's own limit ourselves, exactly as the Android
    // side does and for the same reason: BLE's long-read procedure is driven
    // by the CENTRAL re-reading at increasing offsets until it receives a
    // response shorter than the maximum, so deciding the chunk size here is
    // what lets this file know unambiguously which response carried the last
    // byte. Handing back the whole remainder and letting CoreBluetooth
    // truncate leaves that unknowable, and the GATT server would be torn down
    // under the central's continuation reads — the exact live hang of
    // 2026-08-21 on Android.
    let maxChunk = max(request.central.maximumUpdateValueLength, 1)
    let end = min(request.offset + maxChunk, fullValue.count)
    request.value = fullValue.subdata(in: request.offset..<end)
    manager.respond(to: request, withResult: .success)

    guard end >= fullValue.count else { return }
    if isSignature { call.signatureFullyServed = true } else { call.coreFullyServed = true }
    guard call.coreFullyServed, call.signatureFullyServed, let result = call.pendingResult, !call.settled else { return }
    finish(call, result: result)
  }

  // ------------------------------------------------------- teardown / finish

  private func teardownRadio() {
    guard let manager = peripheralManager else { return }
    if manager.isAdvertising { manager.stopAdvertising() }
    manager.removeAllServices()
    startAdvertisingWhenPoweredOn = false
  }

  private func finish(_ call: ActiveCall, result: [String: Any]?) {
    guard !call.settled else { return }
    call.settled = true
    call.timeoutTimer?.cancel()
    call.timeoutTimer = nil
    teardownRadio()
    if activeCall === call { activeCall = nil }
    call.resolve(result)
  }

  private func finishWithError(_ call: ActiveCall, _ message: String) {
    guard !call.settled else { return }
    call.settled = true
    call.timeoutTimer?.cancel()
    call.timeoutTimer = nil
    teardownRadio()
    if activeCall === call { activeCall = nil }
    call.reject("error", message, nil)
  }

  // -------------------------------------------------------------- small parts

  /// `CBUUID(string:)` raises on malformed input, so the shape is validated first.
  private static func parseUuid(_ value: String) -> CBUUID? {
    let bare = value.replacingOccurrences(of: "-", with: "")
    guard bare.count == 32 || bare.count == 8 || bare.count == 4 else { return nil }
    guard bare.allSatisfy({ $0.isHexDigit }) else { return nil }
    return CBUUID(string: value)
  }

  /// Base64url, unpadded — matching Android's `URL_SAFE | NO_WRAP | NO_PADDING`.
  private static func base64UrlNoPadding(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private static func keychainData(account: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
    return item as? Data
  }

  private static func keychainString(account: String) -> String? {
    guard let data = keychainData(account: account) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  /// RFC 8259 string escaping — the Swift twin of Android's `jsonEscape`.
  private static func jsonEscape(_ value: String) -> String {
    var out = "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    return out + "\""
  }

  /**
   The five-value binding (plan §5.4), JCS-canonicalized — a FOURTH deliberate
   duplicate, alongside `deviceLocality.ts` (wallet), `locality.ts`
   (witness-server) and `LocalityPeripheralModule.kt` (Android), for the reason
   this package's README records: only the native side ever learns
   `sensorNonce`, so only the native side can assemble the binding once it
   arrives.

   Key order is hardcoded alphabetically — challenge, context, sensorDid,
   sensorNonce, taskDigestMultibase — to match RFC 8785 for this fixed
   five-key shape. Checked against `deviceLocality.test.ts`'s frozen
   cross-parity fixture, and against the Kotlin copy, in
   `__tests__/jcsBindingParity.test.ts`. A single character out of place here
   produces a signature the witness rejects with no indication why.
   */
  private static func jcsBinding(
    contextString: String,
    taskDigestMultibase: String,
    challenge: String,
    sensorNonce: String,
    sensorDid: String
  ) -> Data {
    let json = "{"
      + "\"challenge\":\(jsonEscape(challenge)),"
      + "\"context\":\(jsonEscape(contextString)),"
      + "\"sensorDid\":\(jsonEscape(sensorDid)),"
      + "\"sensorNonce\":\(jsonEscape(sensorNonce)),"
      + "\"taskDigestMultibase\":\(jsonEscape(taskDigestMultibase))"
      + "}"
    return Data(json.utf8)
  }

  /// The CORE half of `LocalityTranscript` — everything but the two crypto-sized fields.
  private static func coreTranscriptJson(
    method: String,
    taskDigestMultibase: String,
    challenge: String,
    sensorNonce: String,
    sensorDid: String,
    hardwareAttestation: String
  ) -> Data {
    let json = "{"
      + "\"method\":\(jsonEscape(method)),"
      + "\"taskDigestMultibase\":\(jsonEscape(taskDigestMultibase)),"
      + "\"challenge\":\(jsonEscape(challenge)),"
      + "\"sensorNonce\":\(jsonEscape(sensorNonce)),"
      + "\"sensorDid\":\(jsonEscape(sensorDid)),"
      + "\"hardwareAttestation\":\(jsonEscape(hardwareAttestation))"
      + "}"
    return Data(json.utf8)
  }

  /// The SIGNATURE half — see `coreTranscriptJson`.
  private static func signatureTranscriptJson(devicePublicKeyBase64: String, signatureBase64Url: String) -> Data {
    let json = "{"
      + "\"devicePublicKey\":\(jsonEscape(devicePublicKeyBase64)),"
      + "\"signature\":\(jsonEscape(signatureBase64Url))"
      + "}"
    return Data(json.utf8)
  }
}

// ------------------------------------------------------ CBPeripheralManagerDelegate

extension LocalityPeripheral: CBPeripheralManagerDelegate {

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard let call = activeCall, !call.settled else { return }
    switch peripheral.state {
    case .poweredOn:
      if startAdvertisingWhenPoweredOn { publishServiceAndAdvertise(call) }
    case .unauthorized, .unsupported:
      finishWithError(call, "Bluetooth peripheral role unavailable (state: \(peripheral.state.rawValue))")
    case .poweredOff:
      // Not an implementation error — the user can turn the radio off
      // mid-ceremony, which is §7.1's windowLost, resolved as null.
      NSLog("\(Self.logPrefix) Bluetooth powered off mid-ceremony")
      finish(call, result: nil)
    default:
      break
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard let call = activeCall, !call.settled, let error else { return }
    finishWithError(call, "Failed to publish GATT service: \(error.localizedDescription)")
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    guard let call = activeCall, !call.settled else { return }
    if let error {
      finishWithError(call, "Advertising failed to start: \(error.localizedDescription)")
      return
    }
    NSLog("\(Self.logPrefix) Advertising started")
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    guard let call = activeCall, !call.settled else { return }
    guard let request = requests.first(where: { $0.characteristic.uuid == call.characteristicUuid }) else {
      if let first = requests.first { peripheral.respond(to: first, withResult: .attributeNotFound) }
      return
    }
    // Respond to the write immediately — Apple requires exactly one response
    // per batch, and the signing that follows is asynchronous.
    peripheral.respond(to: request, withResult: .success)

    guard call.pendingResult == nil, call.pendingCoreResponseBytes == nil else { return }
    guard let value = request.value, let sensorNonce = String(data: value, encoding: .utf8), !sensorNonce.isEmpty else {
      NSLog("\(Self.logPrefix) write carried no decodable nonce")
      return
    }
    // §5.3: the nonce arrives as UTF-8 TEXT of a hex string — the witness
    // mints `randomBytes(32).toString('hex')` and writes that string's bytes.
    // Decoding it as hex here would produce a different binding and a
    // signature the witness silently rejects.
    signAndPrepareTranscript(call, sensorNonce: sensorNonce)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    guard let call = activeCall, !call.settled else {
      peripheral.respond(to: request, withResult: .unlikelyError)
      return
    }
    serveRead(call, request: request)
  }
}
