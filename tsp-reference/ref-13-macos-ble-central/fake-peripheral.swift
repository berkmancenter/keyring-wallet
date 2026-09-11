// A stand-in locality peripheral, in CoreBluetooth.
//
// Act 2 of this rung needs something advertising a locality EID. Nothing does
// today: the Android peripheral only advertises inside a live ceremony (which
// needs two phones and a Linux witness), and the iOS peripheral does not exist
// yet. This is the smallest thing that closes that gap — it advertises a
// chosen EID and answers the same GATT exchange the real peripheral must,
// so `run.mjs` can be proven correct BEFORE any iOS code exists.
//
// It is deliberately written against CoreBluetooth's PERIPHERAL role, which is
// the same API surface the iOS module will use. So this doubles as a dry run
// of the iOS implementation's radio half: same service/characteristic setup,
// same write-then-read handling, same chunking behaviour.
//
// What it is NOT: it does not sign anything. `signatureBase64Url` and
// `devicePublicKeyBase64` are canned. The real peripheral signs the transcript
// with the hardware-attestation key under the caller-resolved authMode — that
// is the part this cannot stand in for, and the part most worth care on iOS.
//
//   swiftc -O fake-peripheral.swift -o fake-peripheral
//   ./fake-peripheral <24-hex-eid>

import CoreBluetooth
import Foundation

// Unbuffered: this is meant to be run redirected to a log while a probe
// runs beside it, and Swift block-buffers stdout when it is not a tty --
// which makes a working peripheral look like a silent, hung one.
setvbuf(stdout, nil, _IONBF, 0)

let EID_UUID_PREFIX = "4b524c31"
let CORE_CHAR = CBUUID(string: "4b524c32-0000-1000-8000-2a2b3c4d5e6f")
let SIG_CHAR  = CBUUID(string: "4b524c33-0000-1000-8000-2a2b3c4d5e6f")

func serviceUuid(fromEid eid: String) -> CBUUID {
    let hex = EID_UUID_PREFIX + eid
    let i = { (n: Int) in hex.index(hex.startIndex, offsetBy: n) }
    let s = "\(hex[i(0)..<i(8)])-\(hex[i(8)..<i(12)])-\(hex[i(12)..<i(16)])-\(hex[i(16)..<i(20)])-\(hex[i(20)...])"
    return CBUUID(string: s)
}

guard CommandLine.arguments.count == 2,
      CommandLine.arguments[1].count == 24,
      CommandLine.arguments[1].allSatisfy({ $0.isHexDigit }) else {
    FileHandle.standardError.write("usage: ./fake-peripheral <24-hex-eid>\n".data(using: .utf8)!)
    exit(2)
}
let eid = CommandLine.arguments[1].lowercased()
let svcUuid = serviceUuid(fromEid: eid)

final class FakePeripheral: NSObject, CBPeripheralManagerDelegate {
    private var manager: CBPeripheralManager!
    private var coreChar: CBMutableCharacteristic!
    private var sigChar: CBMutableCharacteristic!
    /// The nonce the central wrote. The real peripheral signs over exactly this.
    private var sensorNonce: String = ""

    func start() {
        manager = CBPeripheralManager(delegate: self, queue: nil)
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        print("[fake] CoreBluetooth state: \(peripheral.state.rawValue) (5 = poweredOn)")
        guard peripheral.state == .poweredOn else { return }

        coreChar = CBMutableCharacteristic(type: CORE_CHAR, properties: [.read, .write], value: nil, permissions: [.readable, .writeable])
        sigChar  = CBMutableCharacteristic(type: SIG_CHAR,  properties: [.read],         value: nil, permissions: [.readable])
        let service = CBMutableService(type: svcUuid, primary: true)
        service.characteristics = [coreChar, sigChar]
        peripheral.add(service)
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [svcUuid]])
        print("[fake] advertising \(svcUuid.uuidString)")
    }

    /// The central writes its freshly minted nonce to the core characteristic.
    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests where request.characteristic.uuid == CORE_CHAR {
            sensorNonce = String(data: request.value ?? Data(), encoding: .utf8) ?? ""
            print("[fake] nonce written: \(sensorNonce)")
        }
        peripheral.respond(to: requests[0], withResult: .success)
    }

    /// Both characteristics are read back, chunked at the negotiated offset —
    /// the same long-read chaining the Linux provider's readFullValue does.
    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        let payload: Data
        if request.characteristic.uuid == CORE_CHAR {
            payload = Data("""
            {"method":"ble-challenge-response/0.1","taskDigestMultibase":"zQmFakeDigestForRef13","challenge":"ref-13-probe","sensorDid":"did:example:ref13sensor","sensorNonceHex":"\(sensorNonce)","hardwareAttestation":"absent","windowSeconds":30}
            """.trimmingCharacters(in: .whitespacesAndNewlines).utf8)
        } else {
            // Canned. The real peripheral signs the transcript here with the
            // hardware key under the caller-resolved authMode.
            payload = Data(#"{"devicePublicKeyBase64":"ZmFrZS1wdWJsaWMta2V5","signatureBase64Url":"ZmFrZS1zaWduYXR1cmU"}"#.utf8)
        }
        guard request.offset <= payload.count else {
            peripheral.respond(to: request, withResult: .invalidOffset)
            return
        }
        request.value = payload.subdata(in: request.offset..<payload.count)
        peripheral.respond(to: request, withResult: .success)
    }
}

let fake = FakePeripheral()
fake.start()
print("[fake] eid \(eid) — Ctrl+C to stop")
RunLoop.main.run()
