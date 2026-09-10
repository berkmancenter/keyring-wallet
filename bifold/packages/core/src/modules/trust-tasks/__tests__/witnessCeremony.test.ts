/**
 * Witness ceremony tests — wallet side of §9 step 5. A fake witness answers
 * through the same inbound seam the real dispatch uses
 * (resolveWitnessResponse), so the ceremony's thread correlation, proof
 * gates, and the VWC's task binding (§4.9.1 taskContext + §4.9.3
 * taskDigestMultibase) are exercised for real; document-proof crypto is
 * mocked (covered in documentProof.test.ts).
 */
import * as witnessSession from '@openvtc/trust-tasks/witness/session/0.1/payload'
import * as witnessSubmit from '@openvtc/trust-tasks/witness/session/submit/0.1/payload'

import { DeviceLocalityProvider, LOCALITY_EXT_NAMESPACE, LocalityTranscript, transcriptDigestMultibase } from '../deviceLocality'
import { digestMultibase } from '../documentProof'
import { resolveWitnessResponse, runWitnessSession } from '../witnessCeremony'

const STUB_PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-08-18T00:00:00Z',
  verificationMethod: 'did:peer:4witness#key-1',
  proofPurpose: 'assertionMethod',
  proofValue: 'zStub',
}

jest.mock('../documentProof', () => ({
  ...jest.requireActual('../documentProof'),
  signDocumentProof: jest.fn(async (_agent: unknown, document: Record<string, unknown>) => ({
    ...document,
    proof: STUB_PROOF,
  })),
  verifyDocumentProof: jest.fn(async () => true),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyDocumentProof: mockedVerify } = require('../documentProof') as { verifyDocumentProof: jest.Mock }

const PARTIES: [string, string] = ['did:peer:0zMyRel', 'did:peer:0zPeerRel']

function makeFakeAgent() {
  const storedCredentials: unknown[] = []
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    modules: {
      didcomm: {
        connections: {
          getById: async () => ({ id: 'witness-conn', did: 'did:peer:4me', theirDid: 'did:peer:4witness' }),
        },
      },
    },
    w3cCredentials: {
      store: jest.fn(async (opts: unknown) => {
        storedCredentials.push(opts)
      }),
    },
  }
  return { agent: agent as never, storedCredentials }
}

/**
 * A scripted witness: answers the session with a challenge, the submit with
 * a VWC — through the same resolver the inbound dispatch uses. `mutate` lets
 * a test corrupt the VWC response; `challengeExt`/`observationFor` let a
 * test drive the locality leg (sensor directive on the challenge, and the
 * witness's own claimed observation on the VWC response — as a function of
 * the submit document actually sent, so a test can react to what the
 * device really did).
 */
function makeWitness(
  mutate?: (vwcResponse: Record<string, unknown>, sessionDoc: Record<string, unknown>) => void,
  options?: {
    challengeExt?: Record<string, unknown>
    observationFor?: (submitDoc: Record<string, unknown>) => Record<string, unknown> | undefined
  }
) {
  const sent: Record<string, unknown>[] = []
  let sessionDoc: Record<string, unknown> | undefined
  const sendDocument = async (_agent: unknown, _connectionId: string, document: Record<string, unknown>) => {
    sent.push(document)
    if (document.type === witnessSession.TYPE_URI) {
      sessionDoc = document
      setTimeout(() => {
        resolveWitnessResponse({
          id: 'resp-challenge',
          type: `${witnessSession.TYPE_URI}#response`,
          threadId: document.threadId,
          parentThreadId: document.parentThreadId,
          issuer: 'did:peer:4witness',
          recipient: 'did:peer:4me',
          issuedAt: new Date().toISOString(),
          payload: {
            challenge: 'nonce-1',
            domain: 'witness.example',
            ...(options?.challengeExt ? { ext: options.challengeExt } : {}),
          },
          proof: STUB_PROOF,
        })
      }, 0)
    }
    if (document.type === witnessSubmit.TYPE_URI) {
      const vwc = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
        issuer: 'did:example:witness',
        credentialSubject: {
          parties: PARTIES,
          taskContext: sessionDoc?.id,
          taskDigestMultibase: sessionDoc ? digestMultibase(sessionDoc) : undefined,
        },
        proof: { type: 'DataIntegrityProof', proofValue: 'zvwc' },
      }
      const observationExt = options?.observationFor?.(document)
      const response: Record<string, unknown> = {
        id: 'resp-vwc',
        type: `${witnessSubmit.TYPE_URI}#response`,
        threadId: document.threadId,
        parentThreadId: document.parentThreadId,
        issuer: 'did:peer:4witness',
        recipient: 'did:peer:4me',
        issuedAt: new Date().toISOString(),
        payload: {
          vwc,
          vwcDigestMultibase: digestMultibase(vwc),
          ...(observationExt ? { ext: observationExt } : {}),
        },
        proof: STUB_PROOF,
      }
      if (mutate) mutate(response, sessionDoc as Record<string, unknown>)
      setTimeout(() => resolveWitnessResponse(response), 0)
    }
  }
  return { sendDocument, sent }
}

const FAKE_TRANSCRIPT: LocalityTranscript = {
  method: 'ble-challenge-response/0.1',
  taskDigestMultibase: 'zStubTaskDigest',
  challenge: 'nonce-1',
  sensorNonce: 'sensor-nonce-abc',
  sensorDid: 'did:peer:4witness',
  devicePublicKey: 'deviceKeyBase64',
  signature: 'sigBase64url',
  hardwareAttestation: 'verified',
}

function fakeDeviceLocalityProvider(transcript: LocalityTranscript | null): DeviceLocalityProvider {
  return {
    name: 'fake',
    respondToSensor: async () => transcript,
  }
}

const baseOptions = (witness: ReturnType<typeof makeWitness>, retained: Record<string, unknown>[]) => ({
  witnessConnectionId: 'witness-conn',
  exchangeId: 'exchange-1',
  parties: PARTIES,
  myRelationshipDid: 'did:peer:0zMyRel',
  buildPresentation: jest.fn(async (challenge: string, domain: string) => ({
    type: ['VerifiablePresentation'],
    proof: { challenge, domain },
  })),
  sendDocument: witness.sendDocument,
  retain: async (document: Record<string, unknown>) => {
    retained.push(document)
  },
  timeoutMs: 2000,
})

describe('runWitnessSession', () => {
  test('the full ceremony: session, challenge-bound VP, VWC validated and stored', async () => {
    const { agent, storedCredentials } = makeFakeAgent()
    const witness = makeWitness()
    const retained: Record<string, unknown>[] = []
    const options = baseOptions(witness, retained)

    const outcome = await runWitnessSession(agent, options)

    // the session opened its own thread, nested under the exchange
    const sessionDoc = witness.sent[0] as { type: string; threadId: string; parentThreadId: string; id: string }
    expect(sessionDoc.type).toBe(witnessSession.TYPE_URI)
    expect(sessionDoc.threadId).toBe(sessionDoc.id)
    expect(sessionDoc.parentThreadId).toBe('exchange-1')
    expect(outcome.sessionId).toBe(sessionDoc.id)

    // the VP bound to the witnessed challenge, submitted with a proof
    expect(options.buildPresentation).toHaveBeenCalledWith('nonce-1', 'witness.example')
    const submitDoc = witness.sent[1] as { type: string; threadId: string; proof: unknown }
    expect(submitDoc.type).toBe(witnessSubmit.TYPE_URI)
    expect(submitDoc.threadId).toBe(sessionDoc.id)
    expect(submitDoc.proof).toEqual(STUB_PROOF)

    // the VWC stored, its task binding checked
    expect(storedCredentials).toHaveLength(1)
    const subject = (outcome.vwc as { credentialSubject: { taskContext: string } }).credentialSubject
    expect(subject.taskContext).toBe(sessionDoc.id)
    expect(retained).toHaveLength(2) // session request + signed submit
  })

  test('a challenge whose proof fails verification aborts the ceremony', async () => {
    const { agent, storedCredentials } = makeFakeAgent()
    const witness = makeWitness()
    mockedVerify.mockResolvedValueOnce(false)

    await expect(runWitnessSession(agent, baseOptions(witness, []))).rejects.toThrow('challenge proof')
    expect(storedCredentials).toHaveLength(0)
  })

  test('a VWC naming a different session (taskContext) is refused', async () => {
    const { agent, storedCredentials } = makeFakeAgent()
    const witness = makeWitness((response) => {
      const payload = response.payload as { vwc: { credentialSubject: { taskContext: string } } }
      payload.vwc.credentialSubject.taskContext = 'some-other-session'
      ;(response.payload as { vwcDigestMultibase: string }).vwcDigestMultibase = digestMultibase(payload.vwc)
    })

    await expect(runWitnessSession(agent, baseOptions(witness, []))).rejects.toThrow('taskContext')
    expect(storedCredentials).toHaveLength(0)
  })

  test('a VWC whose taskDigestMultibase does not bind the session document is refused', async () => {
    const { agent, storedCredentials } = makeFakeAgent()
    const witness = makeWitness((response) => {
      const payload = response.payload as { vwc: { credentialSubject: { taskDigestMultibase: string } } }
      payload.vwc.credentialSubject.taskDigestMultibase = digestMultibase({ counterfeit: true })
      ;(response.payload as { vwcDigestMultibase: string }).vwcDigestMultibase = digestMultibase(payload.vwc)
    })

    await expect(runWitnessSession(agent, baseOptions(witness, []))).rejects.toThrow('taskDigestMultibase')
    expect(storedCredentials).toHaveLength(0)
  })

  test('a delivery whose vwcDigestMultibase mismatches the VWC is refused', async () => {
    const { agent, storedCredentials } = makeFakeAgent()
    const witness = makeWitness((response) => {
      ;(response.payload as { vwcDigestMultibase: string }).vwcDigestMultibase = digestMultibase({ not: 'the vwc' })
    })

    await expect(runWitnessSession(agent, baseOptions(witness, []))).rejects.toThrow('vwcDigestMultibase')
    expect(storedCredentials).toHaveLength(0)
  })

  describe('locality (locality-plan.md §10.3 item 10)', () => {
    test('an explicit decline is recorded in the session request ext, not omitted', async () => {
      const witness = makeWitness()
      const { agent } = makeFakeAgent()
      await runWitnessSession(agent, { ...baseOptions(witness, []), localityOffered: false })

      const sessionDoc = witness.sent[0] as { payload: { ext?: Record<string, unknown> } }
      expect(sessionDoc.payload.ext).toEqual({
        [LOCALITY_EXT_NAMESPACE]: { locality: { offered: false, reason: 'declinedByHolder' } },
      })
    })

    test('omitting localityOffered entirely means no ext at all — distinct from an explicit decline', async () => {
      const witness = makeWitness()
      const { agent } = makeFakeAgent()
      await runWitnessSession(agent, baseOptions(witness, [])) // no localityOffered

      const sessionDoc = witness.sent[0] as { payload: { ext?: unknown } }
      expect(sessionDoc.payload.ext).toBeUndefined()
    })

    test('an offer plus a sensor directive runs the radio phase and attaches the transcript to the submit ext', async () => {
      const directive = {
        [LOCALITY_EXT_NAMESPACE]: {
          locality: { policy: 'offered', method: 'ble-challenge-response/0.1', sensorDid: 'did:peer:4witness', windowSeconds: 120 },
        },
      }
      const witness = makeWitness(undefined, { challengeExt: directive })
      const { agent } = makeFakeAgent()
      const provider = fakeDeviceLocalityProvider(FAKE_TRANSCRIPT)

      const outcome = await runWitnessSession(agent, {
        ...baseOptions(witness, []),
        localityOffered: true,
        deviceLocalityProvider: provider,
      })

      const submitDoc = witness.sent[1] as { payload: { ext?: Record<string, unknown> } }
      expect(submitDoc.payload.ext).toEqual({ [LOCALITY_EXT_NAMESPACE]: { locality: { transcript: FAKE_TRANSCRIPT } } })
      expect(outcome.locality).toEqual({ transcriptProduced: true })
    })

    test('windowLost (provider resolves null) is recorded honestly — no transcript, session still completes', async () => {
      const directive = {
        [LOCALITY_EXT_NAMESPACE]: { locality: { policy: 'offered', method: 'ble-challenge-response/0.1', sensorDid: 'did:peer:4witness', windowSeconds: 120 } },
      }
      const witness = makeWitness(undefined, { challengeExt: directive })
      const { agent, storedCredentials } = makeFakeAgent()

      const outcome = await runWitnessSession(agent, {
        ...baseOptions(witness, []),
        localityOffered: true,
        deviceLocalityProvider: fakeDeviceLocalityProvider(null),
      })

      const submitDoc = witness.sent[1] as { payload: { ext?: unknown } }
      expect(submitDoc.payload.ext).toBeUndefined() // no transcript to attach
      expect(outcome.locality).toEqual({ transcriptProduced: false })
      expect(storedCredentials).toHaveLength(1) // the exchange still completes
    })

    test('a witness claiming a confirmed observation this device never produced a transcript for is refused', async () => {
      // No directive at all this time — the device never ran the radio
      // phase — but the witness's #response claims a confirmed observation
      // anyway. Exactly the case item 10 exists to catch.
      const witness = makeWitness(undefined, {
        observationFor: () => ({
          [LOCALITY_EXT_NAMESPACE]: {
            locality: { observation: { confirmed: true, transcriptDigestMultibase: transcriptDigestMultibase(FAKE_TRANSCRIPT) } },
          },
        }),
      })
      const { agent, storedCredentials } = makeFakeAgent()

      await expect(
        runWitnessSession(agent, { ...baseOptions(witness, []), localityOffered: true })
      ).rejects.toThrow('never produced a transcript')
      expect(storedCredentials).toHaveLength(0)
    })

    test("a witness claiming an observation whose digest doesn't match this device's real transcript is refused", async () => {
      const directive = {
        [LOCALITY_EXT_NAMESPACE]: { locality: { policy: 'offered', method: 'ble-challenge-response/0.1', sensorDid: 'did:peer:4witness', windowSeconds: 120 } },
      }
      const witness = makeWitness(undefined, {
        challengeExt: directive,
        observationFor: () => ({
          [LOCALITY_EXT_NAMESPACE]: {
            locality: { observation: { confirmed: true, transcriptDigestMultibase: 'zSomeOtherTranscriptEntirely' } },
          },
        }),
      })
      const { agent, storedCredentials } = makeFakeAgent()

      await expect(
        runWitnessSession(agent, {
          ...baseOptions(witness, []),
          localityOffered: true,
          deviceLocalityProvider: fakeDeviceLocalityProvider(FAKE_TRANSCRIPT),
        })
      ).rejects.toThrow("does not match this device's own transcript")
      expect(storedCredentials).toHaveLength(0)
    })

    test('a witness observation that genuinely matches the real transcript completes normally', async () => {
      const directive = {
        [LOCALITY_EXT_NAMESPACE]: { locality: { policy: 'offered', method: 'ble-challenge-response/0.1', sensorDid: 'did:peer:4witness', windowSeconds: 120 } },
      }
      const witness = makeWitness(undefined, {
        challengeExt: directive,
        observationFor: () => ({
          [LOCALITY_EXT_NAMESPACE]: {
            locality: { observation: { confirmed: true, transcriptDigestMultibase: transcriptDigestMultibase(FAKE_TRANSCRIPT) } },
          },
        }),
      })
      const { agent, storedCredentials } = makeFakeAgent()

      const outcome = await runWitnessSession(agent, {
        ...baseOptions(witness, []),
        localityOffered: true,
        deviceLocalityProvider: fakeDeviceLocalityProvider(FAKE_TRANSCRIPT),
      })

      expect(outcome.locality).toEqual({ transcriptProduced: true })
      expect(storedCredentials).toHaveLength(1)
    })
  })
})
