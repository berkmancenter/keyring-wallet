/**
 * Cross-side parity: this file's `deriveEid`/`serviceUuidFromEid`/`bindingFor`
 * must produce byte-identical output to witness-server's
 * `trustTasks/locality.ts` copy of the same functions (locality-plan.md §5.3,
 * §5.4) — the two run in different processes (Hermes vs. Node) and never
 * import each other by design (this file's own header comment), so nothing
 * but a shared fixture catches the two copies drifting apart.
 *
 * The fixture values below are NOT hand-computed: they are witness-server's
 * `deriveEid`/`serviceUuidFromEid`/`bindingFor`, run for real via `ts-node`
 * against these exact inputs, and pasted in verbatim. If witness-server's
 * copy ever changes these algorithms, this test is the thing that goes red
 * on the wallet side.
 */
import { deriveEid, serviceUuidFromEid, bindingFor, EID_UUID_PREFIX, transcriptDigestMultibase } from '../deviceLocality'

const CHALLENGE = 'test-challenge-fixture-v1-9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f'
const TASK_DIGEST = 'sha256:aabbccddeeff00112233445566778899aabbccddeeff0011223344556677889900'
const SENSOR_NONCE = 'ff00112233445566778899aabbccddeeff00112233445566778899aabbccdd'
const SENSOR_DID = 'did:peer:4witness-fixture'

// witness-server's trustTasks/locality.ts, run for real against the inputs above.
const WITNESS_SERVER_EID = '68a667b5af4c54aa90d17544'
const WITNESS_SERVER_UUID = '4b524c31-68a6-67b5-af4c-54aa90d17544'
const WITNESS_SERVER_BINDING_HEX =
  '7b226368616c6c656e6765223a22746573742d6368616c6c656e67652d666978747572652d76312d3966326331643765346138623063356633653664316132623763386439653066222c22636f6e74657874223a226b657972696e672d6c6f63616c6974792d7631222c2273656e736f72446964223a226469643a706565723a347769746e6573732d66697874757265222c2273656e736f724e6f6e6365223a226666303031313232333334343535363637373838393961616262636364646565666630303131323233333434353536363737383839396161626263636464222c227461736b4469676573744d756c746962617365223a227368613235363a616162626363646465656666303031313232333334343535363637373838393961616262636364646565666630303131323233333434353536363737383839393030227d'

describe('deviceLocality — EID/UUID/binding, cross-checked against witness-server (locality-plan.md §5.3-5.4)', () => {
  test('deriveEid matches witness-server exactly', () => {
    expect(deriveEid(CHALLENGE, TASK_DIGEST)).toBe(WITNESS_SERVER_EID)
  })

  test('serviceUuidFromEid matches witness-server exactly, and uses the KRL1 prefix', () => {
    const uuid = serviceUuidFromEid(WITNESS_SERVER_EID)
    expect(uuid).toBe(WITNESS_SERVER_UUID)
    expect(uuid.startsWith(EID_UUID_PREFIX)).toBe(true)
  })

  test('bindingFor matches witness-server exactly, byte for byte', () => {
    const binding = bindingFor({ taskDigestMultibase: TASK_DIGEST, challenge: CHALLENGE, sensorNonce: SENSOR_NONCE, sensorDid: SENSOR_DID })
    expect(Buffer.from(binding).toString('hex')).toBe(WITNESS_SERVER_BINDING_HEX)
  })

  test('the whole chain composes: challenge+taskDigest -> EID -> the exact UUID a real sensor would scan for', () => {
    expect(serviceUuidFromEid(deriveEid(CHALLENGE, TASK_DIGEST))).toBe(WITNESS_SERVER_UUID)
  })

  test('transcriptDigestMultibase is deterministic and sha256-prefixed (sanity check alongside the parity fixtures above)', () => {
    const transcript = {
      method: 'ble-challenge-response/0.1' as const,
      taskDigestMultibase: TASK_DIGEST,
      challenge: CHALLENGE,
      sensorNonce: SENSOR_NONCE,
      sensorDid: SENSOR_DID,
      devicePublicKey: 'ZmFrZS1wdWJsaWMta2V5',
      signature: 'ZmFrZS1zaWduYXR1cmU',
      hardwareAttestation: 'verified' as const,
    }
    const digest = transcriptDigestMultibase(transcript)
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(transcriptDigestMultibase(transcript)).toBe(digest)
  })
})
