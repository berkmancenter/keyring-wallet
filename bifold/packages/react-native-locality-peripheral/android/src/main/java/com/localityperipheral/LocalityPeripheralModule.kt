package com.localityperipheral

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.util.UUID

/**
 * The device's BLE peripheral role in the locality ceremony
 * (locality-plan.md §10.3 item 9): advertise the rendezvous EID as a
 * service UUID, serve one GATT characteristic (write nonce, then read the
 * signed transcript), sign with the existing hardware-attestation key, all
 * inside the ceremony window and foreground-only.
 *
 * One method does the whole lifecycle (`respondToSensor`) rather than
 * several — see `NativeLocalityPeripheral.ts`'s own header for why: the
 * RN bridge is a timing risk against witness-server's own RTT bound, so
 * nothing here round-trips through JS mid-ceremony.
 *
 * The wire protocol (nonce as UTF-8 hex text, the read response as a full
 * JSON transcript) is traced against witness-server's real
 * `BleLocalityProvider.runTranscriptExchange()` — see the fields below and
 * `NativeLocalityPeripheral.ts`'s comments, not assumed from the reference
 * ladder's bare-echo test (which never carried a real transcript).
 */
class LocalityPeripheralModule : LocalityPeripheralSpec {

  private val reactContext: ReactApplicationContext
  private val mainHandler = Handler(Looper.getMainLooper())

  constructor(context: ReactApplicationContext) : super(context) {
    reactContext = context
  }

  override fun getName(): String = NAME

  companion object {
    const val NAME = "LocalityPeripheral"
    private const val TAG = "Locality:Peripheral"

    // DELIBERATE DUPLICATE of AttestationModule.kt's own constants, for the
    // reason this package's README states: a real cross-module Gradle
    // dependency between two independent RN native packages is fragile to
    // wire correctly without a build to verify it against, so this is a
    // fourth copy of "the alias", checked by convention rather than the
    // compiler — alongside the JS-side binding triple (wallet/witness-
    // server/this file all independently assemble the same JCS binding).
    private const val HARDWARE_SIGNING_KEY_ALIAS = "vrc_hardware_signing_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  }

  // ---------------------------------------------------------------- isSupported

  @ReactMethod
  override fun isSupported(promise: Promise) {
    try {
      val pm = reactContext.packageManager
      if (!pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
        promise.resolve(false)
        return
      }
      val adapter = (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
      if (adapter == null || !adapter.isEnabled) {
        promise.resolve(false)
        return
      }
      promise.resolve(adapter.isMultipleAdvertisementSupported)
    } catch (e: Exception) {
      Log.w(TAG, "isSupported check failed: ${e.message}")
      promise.resolve(false)
    }
  }

  // ------------------------------------------------------------- respondToSensor

  /**
   * One in-flight ceremony at a time. Holds everything the write callback
   * and the timeout runnable need, so neither has to re-derive it.
   */
  private class ActiveCall(
    val promise: Promise,
    val contextString: String,
    val method: String,
    val taskDigestMultibase: String,
    val challenge: String,
    val sensorDid: String,
    val hardwareAttestation: String,
    val devicePublicKeyBase64: String,
    var authorizedSignature: Signature? = null,
    var gattServer: BluetoothGattServer? = null,
    var advertiser: BluetoothLeAdvertiser? = null,
    var advertiseCallback: AdvertiseCallback? = null,
    var settled: Boolean = false,
    var timeoutRunnable: Runnable? = null,
    var pendingResult: WritableMap? = null,
  )

  @Volatile private var activeCall: ActiveCall? = null

  /**
   * BLUETOOTH_ADVERTISE/BLUETOOTH_CONNECT are API 31+ runtime (dangerous)
   * permissions — this only checks whether they're already granted; the
   * actual OS request dialog is a JS-level, pre-ceremony UX decision
   * (item 8's own still-unbuilt pre-flight sheet is the natural place for
   * it, not a bare permission popup mid-ceremony). Native's job is to fail
   * gracefully rather than crash with an unhandled SecurityException if
   * called without it — pre-31, these are install-time-granted and always
   * "permitted" from this check's perspective.
   */
  private fun hasBluetoothPeripheralPermissions(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val advertiseGranted = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.BLUETOOTH_ADVERTISE) ==
      PackageManager.PERMISSION_GRANTED
    val connectGranted = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.BLUETOOTH_CONNECT) ==
      PackageManager.PERMISSION_GRANTED
    return advertiseGranted && connectGranted
  }

  @ReactMethod
  override fun respondToSensor(params: ReadableMap, promise: Promise) {
    if (activeCall != null) {
      promise.reject("error", "A locality ceremony is already in progress")
      return
    }

    if (!hasBluetoothPeripheralPermissions()) {
      // Not granted is a normal, expected state until a pre-flight UX asks
      // for it (item 8) — §7.1's declinedByHolder/windowLost territory,
      // not an implementation error.
      promise.resolve(null)
      return
    }

    val serviceUuidStr = params.getString("serviceUuid")
    val characteristicUuidStr = params.getString("characteristicUuid")
    val contextString = params.getString("contextString")
    val method = params.getString("method")
    val taskDigestMultibase = params.getString("taskDigestMultibase")
    val challenge = params.getString("challenge")
    val sensorDid = params.getString("sensorDid")
    val hardwareAttestation = params.getString("hardwareAttestation")
    val windowSeconds = if (params.hasKey("windowSeconds")) params.getDouble("windowSeconds") else Double.NaN

    if (serviceUuidStr == null || characteristicUuidStr == null || contextString == null || method == null ||
      taskDigestMultibase == null || challenge == null || sensorDid == null || hardwareAttestation == null ||
      windowSeconds.isNaN()
    ) {
      promise.reject("error", "respondToSensor: missing or malformed params")
      return
    }

    val serviceUuid: UUID
    val characteristicUuid: UUID
    try {
      serviceUuid = UUID.fromString(serviceUuidStr)
      characteristicUuid = UUID.fromString(characteristicUuidStr)
    } catch (e: IllegalArgumentException) {
      promise.reject("error", "respondToSensor: malformed UUID: ${e.message}")
      return
    }

    val activity = currentActivity as? FragmentActivity
    if (activity == null) {
      promise.reject("error", "No activity available for biometric prompt")
      return
    }

    val (privateKey, publicKey) = try {
      loadHardwareKey()
    } catch (e: Exception) {
      promise.reject("error", "Hardware signing key unavailable: ${e.message}", e)
      return
    }

    val devicePublicKeyBase64 = Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)

    val call = ActiveCall(
      promise = promise,
      contextString = contextString,
      method = method,
      taskDigestMultibase = taskDigestMultibase,
      challenge = challenge,
      sensorDid = sensorDid,
      hardwareAttestation = hardwareAttestation,
      devicePublicKeyBase64 = devicePublicKeyBase64,
    )
    activeCall = call

    authorizeSignature(activity, privateKey, call) { authorized ->
      if (!authorized) {
        // Declined/cancelled/failed biometric auth — §7.1's declinedByHolder,
        // a normal ceremony outcome, not an error this should reject for.
        finishCall(call, result = null)
        return@authorizeSignature
      }
      try {
        startAdvertisingAndServe(serviceUuid, characteristicUuid, windowSeconds, call)
      } catch (e: Exception) {
        Log.e(TAG, "Failed to start advertising/GATT server: ${e.message}")
        finishCallWithError(call, "Failed to start BLE peripheral: ${e.message}")
      }
    }
  }

  @ReactMethod
  override fun stopAdvertising(promise: Promise) {
    val call = activeCall
    if (call != null) {
      teardown(call)
      finishCall(call, result = null)
    }
    promise.resolve(null)
  }

  // ------------------------------------------------------------- key/signature

  private fun loadHardwareKey(): Pair<PrivateKey, PublicKey> {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
    keyStore.load(null)
    if (!keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
      throw IllegalStateException("no hardware signing key exists yet")
    }
    val privateKey = keyStore.getKey(HARDWARE_SIGNING_KEY_ALIAS, null) as? PrivateKey
      ?: throw IllegalStateException("could not load private key")
    val publicKey = keyStore.getCertificate(HARDWARE_SIGNING_KEY_ALIAS)?.publicKey
      ?: throw IllegalStateException("could not load public key")
    return Pair(privateKey, publicKey)
  }

  /**
   * Authorize a `Signature` bound to the hardware key via one `BiometricPrompt`
   * + `CryptoObject` round trip, right now — *before* advertising starts,
   * outside the RTT-bound window. The callback receives `true` (authorized;
   * `call.authorizedSignature` is now set and safe to `update()`/`sign()`
   * later, from the GATT write callback, with no further prompt) or `false`
   * (declined/cancelled/failed — not an error, see the caller).
   *
   * NOTE ON TIMING: Android's per-operation `CryptoObject` auth has no
   * documented hard expiry after a successful prompt — the underlying
   * KeyStore operation stays open until used, aborted, or reclaimed under
   * resource pressure — but this is empirical platform behavior, not a
   * guaranteed contract. Holding it across an entire `windowSeconds` (tens
   * of seconds) advertising window is the whole point of this split; it
   * has not yet been verified against a real device for how long that
   * hold reliably survives. Worth confirming on `R5CN70Q6PDP` before
   * trusting this in production.
   */
  private fun authorizeSignature(
    activity: FragmentActivity,
    privateKey: PrivateKey,
    call: ActiveCall,
    onResult: (authorized: Boolean) -> Unit,
  ) {
    val signature = Signature.getInstance("SHA256withECDSA")
    try {
      signature.initSign(privateKey)
    } catch (e: Exception) {
      Log.e(TAG, "initSign failed: ${e.message}")
      onResult(false)
      return
    }

    val executor = ContextCompat.getMainExecutor(reactContext)
    val callback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        val authorizedSignature = result.cryptoObject?.signature
        if (authorizedSignature == null) {
          Log.e(TAG, "Biometric succeeded but no crypto object in result")
          onResult(false)
          return
        }
        call.authorizedSignature = authorizedSignature
        onResult(true)
      }

      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        Log.i(TAG, "Biometric authorization declined/failed [$errorCode]: $errString")
        onResult(false)
      }

      override fun onAuthenticationFailed() {
        // A single failed attempt (e.g. fingerprint not recognized) — the
        // prompt itself stays open for retry; nothing to do here.
      }
    }

    val promptInfo = BiometricPrompt.PromptInfo.Builder()
      .setTitle("Confirm In-Person Presence")
      .setSubtitle("Authenticate to sign the locality confirmation")
      .setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
      )
      .build()

    activity.runOnUiThread {
      try {
        val biometricPrompt = BiometricPrompt(activity, executor, callback)
        biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(signature))
      } catch (e: Exception) {
        Log.e(TAG, "Failed to show biometric prompt: ${e.message}")
        onResult(false)
      }
    }
  }

  // ------------------------------------------------------------- BLE peripheral

  private fun startAdvertisingAndServe(
    serviceUuid: UUID,
    characteristicUuid: UUID,
    windowSeconds: Double,
    call: ActiveCall,
  ) {
    val bluetoothManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      ?: throw IllegalStateException("BluetoothManager unavailable")
    val adapter = bluetoothManager.adapter ?: throw IllegalStateException("no Bluetooth adapter")
    val advertiser = adapter.bluetoothLeAdvertiser ?: throw IllegalStateException("no BLE advertiser (adapter off?)")

    val characteristic = BluetoothGattCharacteristic(
      characteristicUuid,
      BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ,
    )
    val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(characteristic)

    val gattServerCallback = object : BluetoothGattServerCallback() {
      override fun onCharacteristicWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        char: BluetoothGattCharacteristic,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) {
        if (char.uuid != characteristicUuid) return
        if (responseNeeded) {
          call.gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
        }
        if (call.settled) return

        try {
          // §5.3: the sensor's nonce arrives as UTF-8 text of a hex string
          // (`randomBytes(32).toString('hex')` on the witness side, written
          // as `Buffer.from(sensorNonce, 'utf8')`) — decode as text, not hex.
          val sensorNonce = String(value, StandardCharsets.UTF_8)
          val bindingBytes = jcsBinding(call.contextString, call.taskDigestMultibase, call.challenge, sensorNonce, call.sensorDid)

          val authorizedSignature = call.authorizedSignature
            ?: throw IllegalStateException("no authorized signature — should be unreachable")
          authorizedSignature.update(bindingBytes)
          val signatureBytes = authorizedSignature.sign()
          val signatureBase64Url = Base64.encodeToString(
            signatureBytes,
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
          )

          val transcriptJson = transcriptJson(
            method = call.method,
            taskDigestMultibase = call.taskDigestMultibase,
            challenge = call.challenge,
            sensorNonce = sensorNonce,
            sensorDid = call.sensorDid,
            devicePublicKeyBase64 = call.devicePublicKeyBase64,
            signatureBase64Url = signatureBase64Url,
            hardwareAttestation = call.hardwareAttestation,
          )
          characteristic.value = transcriptJson.toByteArray(StandardCharsets.UTF_8)

          val resultMap = Arguments.createMap()
          resultMap.putString("sensorNonceHex", sensorNonce)
          resultMap.putString("devicePublicKeyBase64", call.devicePublicKeyBase64)
          resultMap.putString("signatureBase64Url", signatureBase64Url)
          call.pendingResult = resultMap
        } catch (e: KeyPermanentlyInvalidatedException) {
          Log.e(TAG, "Signing key invalidated: ${e.message}")
          finishCallWithError(call, "Hardware key invalidated — recreate it")
        } catch (e: UserNotAuthenticatedException) {
          Log.e(TAG, "Authorized signature was not actually authorized: ${e.message}")
          finishCallWithError(call, "Signature was not authorized")
        } catch (e: Exception) {
          Log.e(TAG, "Failed to sign transcript: ${e.message}")
          finishCallWithError(call, "Failed to sign transcript: ${e.message}")
        }
      }

      override fun onCharacteristicReadRequest(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        char: BluetoothGattCharacteristic,
      ) {
        if (char.uuid != characteristicUuid) return
        val fullValue = char.value
        if (fullValue == null || offset > fullValue.size) {
          call.gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
          return
        }
        // Long-read support: the central may re-request at increasing
        // offsets if the transcript exceeds the negotiated MTU.
        val slice = fullValue.copyOfRange(offset, fullValue.size)
        call.gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, slice)

        // The sensor has now read the transcript — the round trip this
        // call exists to run is complete.
        val pending = call.pendingResult
        if (pending != null && !call.settled) {
          finishCall(call, result = pending)
        }
      }
    }

    val gattServer = bluetoothManager.openGattServer(reactContext, gattServerCallback)
      ?: throw IllegalStateException("failed to open GATT server")
    gattServer.addService(service)
    call.gattServer = gattServer

    val advertiseCallback = object : AdvertiseCallback() {
      override fun onStartFailure(errorCode: Int) {
        Log.e(TAG, "Advertising failed to start [$errorCode]")
        finishCallWithError(call, "Advertising failed to start [$errorCode]")
      }
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
        Log.i(TAG, "Advertising started")
      }
    }
    call.advertiser = advertiser
    call.advertiseCallback = advertiseCallback

    val advertiseSettings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val advertiseData = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(serviceUuid))
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .build()
    advertiser.startAdvertising(advertiseSettings, advertiseData, advertiseCallback)

    val timeoutMs = (windowSeconds * 1000).toLong().coerceAtLeast(0)
    val timeoutRunnable = Runnable {
      if (!call.settled) {
        Log.i(TAG, "Window elapsed with no completed observation")
        finishCall(call, result = null)
      }
    }
    call.timeoutRunnable = timeoutRunnable
    mainHandler.postDelayed(timeoutRunnable, timeoutMs)
  }

  // ------------------------------------------------------------- teardown/finish

  private fun teardown(call: ActiveCall) {
    call.timeoutRunnable?.let { mainHandler.removeCallbacks(it) }
    try {
      call.advertiser?.stopAdvertising(call.advertiseCallback)
    } catch (e: Exception) {
      Log.w(TAG, "stopAdvertising failed: ${e.message}")
    }
    try {
      call.gattServer?.close()
    } catch (e: Exception) {
      Log.w(TAG, "closing GATT server failed: ${e.message}")
    }
  }

  private fun finishCall(call: ActiveCall, result: WritableMap?) {
    if (call.settled) return
    call.settled = true
    teardown(call)
    if (activeCall === call) activeCall = null
    call.promise.resolve(result)
  }

  private fun finishCallWithError(call: ActiveCall, message: String) {
    if (call.settled) return
    call.settled = true
    teardown(call)
    if (activeCall === call) activeCall = null
    call.promise.reject("error", message)
  }

  // ------------------------------------------------------------- JSON helpers

  /** Minimal, correct JSON string escaping — RFC 8259 control-char rules. */
  private fun jsonEscape(s: String): String {
    val sb = StringBuilder(s.length + 2)
    sb.append('"')
    for (c in s) {
      when (c) {
        '"' -> sb.append("\\\"")
        '\\' -> sb.append("\\\\")
        '\n' -> sb.append("\\n")
        '\r' -> sb.append("\\r")
        '\t' -> sb.append("\\t")
        else -> if (c.code < 0x20) sb.append("\\u%04x".format(c.code)) else sb.append(c)
      }
    }
    sb.append('"')
    return sb.toString()
  }

  /**
   * The five-value binding (plan §5.4), JCS-canonicalized — a THIRD
   * deliberate duplicate of `deviceLocality.ts`'s/witness-server's
   * `bindingFor()`, alongside those two, for the reason recorded in this
   * package's README (only this file ever learns `sensorNonce`, so only
   * this file can assemble the binding once it arrives). All five values
   * are plain strings with no JSON-special characters in practice
   * (hex/base64/DID text) — `jsonEscape` still applies the real rules
   * rather than assuming that. Field order is hardcoded alphabetically
   * (challenge, context, sensorDid, sensorNonce, taskDigestMultibase) to
   * match RFC 8785 key ordering for this fixed five-key shape — checked
   * against `deviceLocality.test.ts`'s frozen fixture, not just eyeballed.
   */
  private fun jcsBinding(
    contextString: String,
    taskDigestMultibase: String,
    challenge: String,
    sensorNonce: String,
    sensorDid: String,
  ): ByteArray {
    val json = "{" +
      "\"challenge\":${jsonEscape(challenge)}," +
      "\"context\":${jsonEscape(contextString)}," +
      "\"sensorDid\":${jsonEscape(sensorDid)}," +
      "\"sensorNonce\":${jsonEscape(sensorNonce)}," +
      "\"taskDigestMultibase\":${jsonEscape(taskDigestMultibase)}" +
      "}"
    return json.toByteArray(StandardCharsets.UTF_8)
  }

  /** The full `LocalityTranscript` (plan §5.3), as the GATT read response — see the Spec's own comment for why this is the wire shape, not just the signature. */
  private fun transcriptJson(
    method: String,
    taskDigestMultibase: String,
    challenge: String,
    sensorNonce: String,
    sensorDid: String,
    devicePublicKeyBase64: String,
    signatureBase64Url: String,
    hardwareAttestation: String,
  ): String {
    return "{" +
      "\"method\":${jsonEscape(method)}," +
      "\"taskDigestMultibase\":${jsonEscape(taskDigestMultibase)}," +
      "\"challenge\":${jsonEscape(challenge)}," +
      "\"sensorNonce\":${jsonEscape(sensorNonce)}," +
      "\"sensorDid\":${jsonEscape(sensorDid)}," +
      "\"devicePublicKey\":${jsonEscape(devicePublicKeyBase64)}," +
      "\"signature\":${jsonEscape(signatureBase64Url)}," +
      "\"hardwareAttestation\":${jsonEscape(hardwareAttestation)}" +
      "}"
  }
}
