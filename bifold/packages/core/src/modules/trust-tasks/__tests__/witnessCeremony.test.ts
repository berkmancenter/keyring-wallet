/**
 * Witness ceremony tests — wallet side of §9 step 5. A fake witness answers
 * through the same inbound seam the real dispatch uses
 * (resolveWitnessResponse), so the ceremony's thread correlation, proof
 * gates, and the VWC's task binding (§4.9.1 taskContext + §4.9.3
 * taskDigestMultibase) are exercised for real; document-proof crypto is
 * mocked (covered in documentProof.test.ts).
 */
import { DTG_PREDICATE_WITNESSED } from '@bifold/dtg-vocab'
import * as witnessSession from '@openvtc/trust-tasks/witness/session/0.1/payload'
import * as witnessSubmit from '@openvtc/trust-tasks/witness/session/submit/0.1/payload'

import {
  DeviceLocalityProvider,
  LOCALITY_EXT_NAMESPACE,
  LocalityTranscript,
  transcriptDigestMultibase,
} from '../deviceLocality'
import { digestMultibase, taskDigestMultibase } from '../documentProof'
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
      const payload = response.payload as { vwcDigestMultibase: string }
      payload.vwcDigestMultibase = digestMultibase({ not: 'the vwc' })
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
          locality: {
            policy: 'offered',
            method: 'ble-challenge-response/0.1',
            sensorDid: 'did:peer:4witness',
            windowSeconds: 120,
          },
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
        [LOCALITY_EXT_NAMESPACE]: {
          locality: {
            policy: 'offered',
            method: 'ble-challenge-response/0.1',
            sensorDid: 'did:peer:4witness',
            windowSeconds: 120,
          },
        },
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
            locality: {
              observation: { confirmed: true, transcriptDigestMultibase: transcriptDigestMultibase(FAKE_TRANSCRIPT) },
            },
          },
        }),
      })
      const { agent, storedCredentials } = makeFakeAgent()

      await expect(runWitnessSession(agent, { ...baseOptions(witness, []), localityOffered: true })).rejects.toThrow(
        'never produced a transcript'
      )
      expect(storedCredentials).toHaveLength(0)
    })

    test("a witness claiming an observation whose digest doesn't match this device's real transcript is refused", async () => {
      const directive = {
        [LOCALITY_EXT_NAMESPACE]: {
          locality: {
            policy: 'offered',
            method: 'ble-challenge-response/0.1',
            sensorDid: 'did:peer:4witness',
            windowSeconds: 120,
          },
        },
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
        [LOCALITY_EXT_NAMESPACE]: {
          locality: {
            policy: 'offered',
            method: 'ble-challenge-response/0.1',
            sensorDid: 'did:peer:4witness',
            windowSeconds: 120,
          },
        },
      }
      const witness = makeWitness(undefined, {
        challengeExt: directive,
        observationFor: () => ({
          [LOCALITY_EXT_NAMESPACE]: {
            locality: {
              observation: { confirmed: true, transcriptDigestMultibase: transcriptDigestMultibase(FAKE_TRANSCRIPT) },
            },
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

  // VSC migration plan §6 V3: D6 (subject binding) and D8 (predicate
  // acceptance), against the real digest primitives (taskDigestMultibase,
  // digestBytesEqual) and the real @bifold/dtg-vocab accept-list — not
  // mocked, so a real mismatch is what actually fails these tests, not an
  // assertion that trusts its own fixture.
  describe('D6 — subject binding, and D8 — predicate acceptance', () => {
    const referencedVrc = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: 'did:peer:0zPeerRel',
      credentialSubject: { id: 'did:peer:0zMyRel' },
      proof: { type: 'DataIntegrityProof', proofValue: 'zvrc' },
    }

    function vscVwc(
      overrides: { predicate?: string; subjectId?: string; digestMultibase?: string; issuerScope?: string } = {}
    ) {
      return {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
        issuer: 'did:example:witness',
        // issuerScope (cred-spec #68): REQUIRED on every DTG credential as of
        // 2026-09-28. 'directed' is the dtg:witnessed profile's own stated
        // minimum. Overridable so a test can specifically exercise the
        // issuerScope check itself (missing/invalid/narrower-than-minimum).
        issuerScope: overrides.issuerScope ?? 'directed',
        credentialSubject: {
          id: overrides.subjectId ?? referencedVrc.issuer,
          predicate: overrides.predicate ?? DTG_PREDICATE_WITNESSED,
          object: { digestMultibase: overrides.digestMultibase ?? taskDigestMultibase(referencedVrc) },
        },
      }
    }

    /**
     * Replaces the delivered VWC's credentialSubject and re-derives every
     * digest downstream of it, so only the intended field is actually wrong.
     *
     * taskContext/taskDigestMultibase are placed BOTH nested (credentialSubject)
     * and at the top level. Both placements now round-trip for real: the
     * task-binding check above dual-reads top level first, nested as a
     * fallback (matching cred-spec pin 94af2d8's top-level placement, and
     * WitnessTaskSessions.placeTaskContext/placeTaskDigestMultibase's actual
     * vsc-shape emission). Keeping both here isn't required for THIS
     * fixture's own read anymore, but does still matter for D8's real
     * @bifold/dtg-vocab accept-list check below, which expects D4's
     * top-level placement independent of this ceremony's own dual-read.
     */
    function withVsc(vsc: Record<string, unknown>) {
      return (response: Record<string, unknown>, sessionDoc: Record<string, unknown>) => {
        const payload = response.payload as { vwc: Record<string, unknown> }
        const subject = vsc.credentialSubject as Record<string, unknown>
        payload.vwc = {
          ...vsc,
          taskContext: sessionDoc.id,
          taskDigestMultibase: digestMultibase(sessionDoc),
          credentialSubject: { ...subject, taskContext: sessionDoc.id, taskDigestMultibase: digestMultibase(sessionDoc) },
        }
        ;(response.payload as Record<string, unknown>).vwcDigestMultibase = digestMultibase(payload.vwc)
      }
    }

    test('a VSC-shaped VWC whose subject and digest both match the referenced VRC: subjectBinding is checked and ok', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness(withVsc(vscVwc()))

      const outcome = await runWitnessSession(agent, { ...baseOptions(witness, []), referencedVrc })

      expect(outcome.subjectBinding).toEqual({ checked: true, ok: true })
      expect(storedCredentials).toHaveLength(1)
    })

    test('the digest edge binds a v5-shaped VRC (issuerScope + evidence): ok, and any change to issuerScope breaks it', async () => {
      const v5Vrc = {
        ...referencedVrc,
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://registry.trustoverip.org/dtg/context/v1',
          'https://www.firstperson.network/hardware-evidence/v1',
        ],
        issuerScope: 'pairwise',
        evidence: [{ id: 'urn:uuid:e1', type: ['BiometricAttestation', 'HardwareKeyAttestation'] }],
      }
      const ok = makeFakeAgent()
      const outcome = await runWitnessSession(ok.agent, {
        ...baseOptions(makeWitness(withVsc(vscVwc({ digestMultibase: taskDigestMultibase(v5Vrc) }))), []),
        referencedVrc: v5Vrc,
      })
      expect(outcome.subjectBinding).toEqual({ checked: true, ok: true })

      const swapped = makeFakeAgent()
      await expect(
        runWitnessSession(swapped.agent, {
          ...baseOptions(makeWitness(withVsc(vscVwc({ digestMultibase: taskDigestMultibase(v5Vrc) }))), []),
          referencedVrc: { ...v5Vrc, issuerScope: 'public' },
        })
      ).rejects.toThrow('VWC subject binding failed')
    })

    test('no referencedVrc supplied: subjectBinding is unchecked, not falsely ok (cred-spec C5 — an opaque hash, not an identified edge)', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness(withVsc(vscVwc()))

      const outcome = await runWitnessSession(agent, baseOptions(witness, []))

      expect(outcome.subjectBinding.checked).toBe(false)
      expect(outcome.subjectBinding.ok).toBe(false)
      expect(storedCredentials).toHaveLength(1) // unchecked is conforming, not a refusal
    })

    test('a VSC-shaped VWC whose subject is NOT the referenced VRC\'s issuer is refused (the D6 violation this check exists to catch)', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness(withVsc(vscVwc({ subjectId: 'did:peer:0zSomeoneElse' })))

      await expect(runWitnessSession(agent, { ...baseOptions(witness, []), referencedVrc })).rejects.toThrow(
        'VWC subject binding failed'
      )
      expect(storedCredentials).toHaveLength(0)
    })

    test('a VSC-shaped VWC whose digest does not match the referenced VRC is refused', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness(withVsc(vscVwc({ digestMultibase: taskDigestMultibase({ different: 'document' }) })))

      await expect(runWitnessSession(agent, { ...baseOptions(witness, []), referencedVrc })).rejects.toThrow(
        'VWC subject binding failed'
      )
      expect(storedCredentials).toHaveLength(0)
    })

    test('an unrecognized predicate is refused outright (D8 — rejection is the only conforming outcome)', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness(withVsc(vscVwc({ predicate: 'https://example.com/not-in-accept-list' })))

      await expect(runWitnessSession(agent, { ...baseOptions(witness, []), referencedVrc })).rejects.toThrow(
        'VWC predicate rejected'
      )
      expect(storedCredentials).toHaveLength(0)
    })

    test('a legacy WD02 VWC (no predicate at all) is not subject to D8 — the check does not apply, it does not fail', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness() // the file's default witness emits the legacy WitnessCredential shape

      const outcome = await runWitnessSession(agent, baseOptions(witness, []))

      expect(storedCredentials).toHaveLength(1)
      expect(outcome.subjectBinding.checked).toBe(false) // legacy fixture carries no digest either
    })

    test('issuerScope (cred-spec #68): a VSC-shaped VWC missing issuerScope is refused', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const vwc = vscVwc() as Record<string, unknown>
      delete vwc.issuerScope
      const witness = makeWitness(withVsc(vwc))

      await expect(runWitnessSession(agent, { ...baseOptions(witness, []), referencedVrc })).rejects.toThrow(
        'VWC issuerScope rejected'
      )
      expect(storedCredentials).toHaveLength(0)
    })

    test('issuerScope: pairwise is narrower than the dtg:witnessed profile\'s directed minimum, and is refused', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness(withVsc(vscVwc({ issuerScope: 'pairwise' })))

      await expect(runWitnessSession(agent, { ...baseOptions(witness, []), referencedVrc })).rejects.toThrow(
        'VWC issuerScope rejected'
      )
      expect(storedCredentials).toHaveLength(0)
    })

    test('issuerScope: public is broader than the directed minimum and is accepted', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness(withVsc(vscVwc({ issuerScope: 'public' })))

      const outcome = await runWitnessSession(agent, { ...baseOptions(witness, []), referencedVrc })

      expect(outcome.issuerScope).toEqual({ applicable: true, ok: true })
      expect(storedCredentials).toHaveLength(1)
    })

    test('issuerScope: a legacy WD02 VWC (no predicate at all) is not subject to this check — it predates the property', async () => {
      const { agent, storedCredentials } = makeFakeAgent()
      const witness = makeWitness()

      const outcome = await runWitnessSession(agent, baseOptions(witness, []))

      expect(outcome.issuerScope).toEqual({ applicable: false, ok: true })
      expect(storedCredentials).toHaveLength(1)
    })
  })
})

// ---- 228: the witness answers with a witnessed/1 VWC (DTG Credentials v1) --

/** Reshape the scripted witness's VWC as witnessed/1: the citation at the top level, no parties. */
const asWitnessedV1 =
  (taskContext?: string) => (response: Record<string, unknown>, sessionDoc: Record<string, unknown>) => {
    const payload = response.payload as { vwc: Record<string, unknown>; vwcDigestMultibase: string }
    payload.vwc = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://registry.trustoverip.org/dtg/context/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
      issuer: 'did:example:witness',
      issuerScope: 'public',
      taskContext: taskContext ?? sessionDoc.id,
      taskDigestMultibase: digestMultibase(sessionDoc),
      credentialSubject: {
        id: 'did:peer:0zMyRel',
        predicate: 'https://registry.trustoverip.org/dtg/vsc/witnessed/1',
        object: { digestMultibase: 'zQmXhTCPnjuGdyMqWWfdwyqNW4D6banDLjnA9x6Kxzc9ecK' },
      },
      proof: { type: 'DataIntegrityProof', proofValue: 'zvwc' },
    }
    payload.vwcDigestMultibase = digestMultibase(payload.vwc)
  }

describe('runWitnessSession with a witnessed/1 VWC', () => {
  test('binds the session through the top-level citation, and stores it', async () => {
    const { agent, storedCredentials } = makeFakeAgent()
    const witness = makeWitness(asWitnessedV1())
    const outcome = await runWitnessSession(agent, baseOptions(witness, []))
    expect(storedCredentials).toHaveLength(1)
    expect((outcome.vwc as { taskContext: string }).taskContext).toBe(outcome.sessionId)
  })

  test('refuses one whose top-level taskContext names another session', async () => {
    const { agent, storedCredentials } = makeFakeAgent()
    const witness = makeWitness(asWitnessedV1('some-other-session'))
    await expect(runWitnessSession(agent, baseOptions(witness, []))).rejects.toThrow('taskContext')
    expect(storedCredentials).toHaveLength(0)
  })
})
