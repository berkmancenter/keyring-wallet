/**
 * The grant's signer (plan §3.4, step 7.3, measured in step 0.1(f)): `keys/sign-document/0.1` with the persona's
 * `signingKeyId`. Every request it sends, and every answer the fake VTA gives, is validated against the
 * specification's own schema at the pin (`fixtures/keys-sign-document-0.1`, `dtgwg-trust-tasks-tf` 2a66a0351), so
 * neither side can take a shape the VTA would not. A refusal the fake throws is not a payload and is not checked.
 */
import Ajv from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'
import { expectNoDrift, registryPath } from '../../trust-tasks/__tests__/fixtures/registryDrift'
import { KEYS_SIGN_DOCUMENT_TASK, VdcSignPort, buildVdcGrant, issueVdc, vdcScopeFor, vtaVdcSigner } from '../vdc'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const DIR = join(__dirname, 'fixtures', 'keys-sign-document-0.1')
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, unknown>

/** The payload schema's `$ref` to the framework resolves against its `$id` to this URL; registered there. */
function schemas() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  const framework = { ...read('framework-0.1.schema.json') }
  delete framework.$id
  ajv.addSchema(framework, 'https://trusttasks.org/_framework/0.1/framework.schema.json')
  ajv.addSchema(read('keys-sign-document-0.1.payload.schema.json'))
  const request = ajv.getSchema(KEYS_SIGN_DOCUMENT_TASK)
  if (!request) throw new Error('no schema for keys/sign-document/0.1')
  return { request, response: ajv.compile({ $ref: `${KEYS_SIGN_DOCUMENT_TASK}#/$defs/Response` }) }
}
const S = schemas()

function expectValid(validate: (v: unknown) => boolean, value: unknown) {
  if (!validate(value)) throw new Error(JSON.stringify((validate as { errors?: unknown }).errors, null, 1))
}

const PERSONA = 'did:webvh:QmPersona:persona.example.org'
const KEY = `${PERSONA}#key-0`
const K_A = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const NOW = Date.parse('2026-11-25T12:00:00Z')

const unsigned = () =>
  buildVdcGrant({
    personaDid: PERSONA,
    agentDid: K_A,
    scope: vdcScopeFor({ memory: true, roomAdded: false }),
    now: NOW,
  })

const proofFor = (verificationMethod: string) => ({
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-11-25T12:00:00Z',
  verificationMethod,
  proofPurpose: 'assertionMethod',
  proofValue: 'z3FXQjecWJKT',
})

/** A fake VTA that answers as `keys/sign-document/0.1` does, after `edit` has had its way with the answer. */
function vta(edit: (answer: Record<string, unknown>) => unknown = (a) => a) {
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const port: VdcSignPort = {
    async task(type, payload) {
      sent.push({ type, payload })
      expectValid(S.request, payload)
      const document = payload.document as Record<string, unknown>
      const proof = proofFor(String(payload.keyId))
      const out = edit({ keyId: payload.keyId, signerDid: document.issuer, document: { ...document, proof }, proof })
      if (out instanceof Error) throw out
      expectValid(S.response, out)
      return out
    },
  }
  return { port, sent }
}

describe('vtaVdcSigner: the grant signed as the persona with keys/sign-document/0.1', () => {
  it('sends the persona key and the unsigned grant, and returns the grant as sent with its proof', async () => {
    const { port, sent } = vta()
    const grant = unsigned()
    const signed = await issueVdc(grant, vtaVdcSigner(port, KEY))
    expect(sent).toEqual([{ type: KEYS_SIGN_DOCUMENT_TASK, payload: { keyId: KEY, document: grant } }])
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { proof, ...claims } = signed
    expect(claims).toEqual(grant)
    expect(proof).toMatchObject({
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      proofPurpose: 'assertionMethod',
      verificationMethod: KEY,
    })
  })

  it.each([
    ['another key', (a: Record<string, unknown>) => ({ ...a, keyId: `${PERSONA}#key-1` }), 'another key'],
    [
      'another signer',
      (a: Record<string, unknown>) => ({ ...a, signerDid: 'did:webvh:QmOther:other.example.org' }),
      'someone other',
    ],
    [
      'no proof on the document',
      (a: Record<string, unknown>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { proof: _p, ...rest } = a.document as Record<string, unknown>
        return { ...a, document: rest }
      },
      'no signed credential',
    ],
  ])('refuses an answer with %s', async (_, edit, message) => {
    const { port } = vta(edit)
    await expect(issueVdc(unsigned(), vtaVdcSigner(port, KEY))).rejects.toThrow(message)
  })

  it('refuses an answer whose claims changed, through issueVdc', async () => {
    const { port } = vta((a) => ({ ...a, document: { ...(a.document as object), validUntil: '2027-01-01T00:00:00Z' } }))
    await expect(issueVdc(unsigned(), vtaVdcSigner(port, KEY))).rejects.toThrow('changed the credential')
  })

  it("passes the VTA's refusal on as it came", async () => {
    const { port } = vta(() => new VtiRefusal('keys/sign-document:issuerMismatch', 'not the issuer'))
    await expect(issueVdc(unsigned(), vtaVdcSigner(port, KEY))).rejects.toMatchObject({
      name: 'VtiRefusal',
      code: 'keys/sign-document:issuerMismatch',
    })
  })

  it('control: the schema refuses a request member 0.1 does not have', () => {
    expect(S.request({ keyId: KEY, document: unsigned(), purpose: 'assertionMethod' })).toBe(false)
  })
})

describe('the vendored keys/sign-document schema still matches the registry', () => {
  // Left to the formatter (not in packages/.prettierignore), so compared as JSON. Runs where the registry clone is
  // found (registryPath); CI has none and skips.
  const maybe = registryPath() ? it : it.skip

  maybe('the same JSON as the commit PROVENANCE names', () => {
    expectNoDrift(
      DIR,
      {
        'keys-sign-document-0.1.payload.schema.json': 'specs/keys/sign-document/0.1/payload.schema.json',
        'framework-0.1.schema.json': 'specs/_framework/0.1/framework.schema.json',
      },
      { as: 'json' }
    )
  })
})
