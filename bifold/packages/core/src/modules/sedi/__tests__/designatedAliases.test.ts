/**
 * The phone side of the K1 State office's designated aliases (../webs/designatedAliases): only a host the State root
 * designates, in an ACDC anchored in its own live KEL, may be used. Fixtures: fixtures/k1-aliases, THROWAWAY material
 * from a fresh State office store (see its PROVENANCE.json); its AIDs are trusted by no build.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { setStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import {
  DESIGNATED_ALIASES_SCHEMA,
  checkDesignation,
  hostDesignatedByRoot,
  rootWebsAt,
} from '../webs/designatedAliases'
import type { WebsFetch, WebsResponse } from '../webs/resolve'

const FX = join(__dirname, 'fixtures', 'k1-aliases')
const prov = JSON.parse(readFileSync(join(FX, 'PROVENANCE.json'), 'utf8')) as {
  root: string
  schema: string
  hosts: { a: string; b: string }
}
const ROOT = prov.root
const A = prov.hosts.a
const B = prov.hosts.b
const file = (f: string) => readFileSync(join(FX, f), 'utf8')
const te = new TextEncoder()

type Body = string | { status: number } | { throws: string }
/** A host serving the root's three files; anything unrouted is a 404. Records every URL asked for. */
function served(host: string, files: { kel: Body; doc: Body; aliases?: Body }) {
  const base = `https://${host}/keyring-demo-state/${ROOT}/`
  const routes: Record<string, Body | undefined> = {
    [`${base}keri.cesr`]: files.kel,
    [`${base}did.json`]: files.doc,
    [`${base}designated-aliases.json`]: files.aliases,
  }
  const asked: string[] = []
  const f = (async (url: string): Promise<WebsResponse> => {
    asked.push(url)
    const r = routes[url]
    if (r === undefined) return { ok: false, status: 404, url, arrayBuffer: async () => new ArrayBuffer(0) }
    if (typeof r === 'object' && 'throws' in r) throw new Error(r.throws)
    if (typeof r === 'object') return { ok: false, status: r.status, url, arrayBuffer: async () => new ArrayBuffer(0) }
    const body = te.encode(r)
    return {
      ok: true,
      status: 200,
      url,
      redirected: false,
      headers: { get: () => null },
      arrayBuffer: async () => body.slice().buffer as ArrayBuffer,
    }
  }) as unknown as WebsFetch & { asked: string[] }
  f.asked = asked
  return f
}
/** demo-a's files as published while it was designated. */
const atA = (aliases: Body = file('a.designated-aliases.json')) =>
  served(A, { kel: file('a.keri.cesr'), doc: file('a.did.json'), aliases })
/** After the re-designation to demo-b: the root's newer KEL (same keys, so demo-a's did.json still matches it). */
const atAafter = (aliases: Body) => served(A, { kel: file('b.keri.cesr'), doc: file('a.did.json'), aliases })
const atB = (aliases: Body = file('b.designated-aliases.json')) =>
  served(B, { kel: file('b.keri.cesr'), doc: file('b.did.json'), aliases })
const check = (host: string, f: WebsFetch) => checkDesignation(ROOT, host, f)

beforeEach(() => setStateVerifiedApproversEnabled(true))

describe('a host the State root designates', () => {
  it("the schema constant is the State office's (fixtures carry it)", () => {
    expect(DESIGNATED_ALIASES_SCHEMA).toBe(prov.schema)
    expect(rootWebsAt(ROOT, A)).toBe(`did:webs:${A}:keyring-demo-state:${ROOT}`)
  })

  it('DESIGNATED: demo-a while it is designated, and demo-b after the re-designation', async () => {
    expect(await check(A, atA())).toEqual({ result: 'designated', why: 'listed' })
    expect(await check(B, atB())).toEqual({ result: 'designated', why: 'listed' })
    expect(await hostDesignatedByRoot(ROOT, B, atB())).toBe('designated')
  })

  it('ANOTHER HOST: the live designation (demo-b) served at demo-a does not list demo-a (control: at demo-b it does)', async () => {
    expect(await check(A, atAafter(file('b.designated-aliases.json')))).toMatchObject({
      result: 'notDesignated',
      why: 'hostNotListed',
    })
  })

  it("REVOKED: demo-a's designation, revoked by the re-designation, is not a designation", async () => {
    expect(await check(A, atAafter(file('a-revoked.designated-aliases.json')))).toMatchObject({
      result: 'notDesignated',
      why: 'revoked',
    })
  })

  it("STALE: demo-a's file from before its revoke is refused against the root's newer KEL (control: DESIGNATED, same file, older KEL)", async () => {
    expect(await check(A, atAafter(file('a.designated-aliases.json')))).toMatchObject({
      result: 'notDesignated',
      why: 'statusNotCurrent',
    })
  })

  it('TAMPERED ids: the listed host changed in the proof text is refused as a bad file', async () => {
    const f = JSON.parse(file('b.designated-aliases.json')) as { proof: string }
    const tampered = JSON.stringify({ ...f, proof: f.proof.split(`did:webs:${B}:`).join(`did:webs:${A}:`) })
    expect(tampered).not.toBe(file('b.designated-aliases.json'))
    expect((await check(A, atAafter(tampered))).result).toBe('badFile')
  })

  it('WRONG ISSUER: a genuine aliases ACDC issued by the org unit, not the root, is refused', async () => {
    expect(await check(B, atB(file('wrong-issuer.designated-aliases.json')))).toMatchObject({
      result: 'badFile',
      why: 'wrongIssuer',
    })
  })

  it("WRONG SCHEMA: the root's own Unit ACDC (issued, current, its own) in the aliases file is refused", async () => {
    expect(await check(B, atB(file('wrong-schema.designated-aliases.json')))).toMatchObject({
      result: 'badFile',
      why: 'wrongSchema',
    })
  })

  it('404: no designation published is not a designation', async () => {
    expect(await check(A, served(A, { kel: file('a.keri.cesr'), doc: file('a.did.json') }))).toEqual({
      result: 'notDesignated',
      why: 'notPublished',
    })
  })

  it('OVERSIZE: a file over the cap is refused (64 KiB)', async () => {
    const big = JSON.stringify({ ...JSON.parse(file('a.designated-aliases.json')), pad: 'x'.repeat(64 * 1024) })
    expect(await check(A, atA(big))).toMatchObject({ result: 'badFile', why: 'tooLarge' })
  })

  it("UNREACHABLE never designates: the aliases file or the root's KEL failing to load", async () => {
    expect((await check(A, atA({ throws: 'Network request failed' }))).result).toBe('unreachable')
    expect((await check(A, atA({ status: 503 }))).result).not.toBe('designated')
    expect((await check(A, served(A, { kel: { throws: 'offline' }, doc: file('a.did.json') }))).result).toBe(
      'unreachable'
    )
  })

  it("the root's own files failing at that host is a bad file (its did.json names another host)", async () => {
    expect(
      await check(
        A,
        served(A, { kel: file('b.keri.cesr'), doc: file('b.did.json'), aliases: file('b.designated-aliases.json') })
      )
    ).toMatchObject({
      result: 'badFile',
      why: 'stateNotVerified',
    })
  })

  it('unreadable files are bad files, never designated', async () => {
    for (const body of [
      'not json',
      '{}',
      JSON.stringify({ said: 'x', proof: 'y', tel: { ripText: 'z', updateTexts: [] } }),
    ])
      expect((await check(A, atA(body))).result).toBe('badFile')
  })

  it('bad input asks nothing: a host that is not a bare public hostname, or a root that is not an AID', async () => {
    const f = atA()
    expect((await checkDesignation(ROOT, 'https://x.example', f)).result).toBe('notDesignated')
    expect((await checkDesignation(ROOT, 'localhost', f)).result).toBe('notDesignated')
    expect((await checkDesignation('nope', A, f)).result).toBe('notDesignated')
    expect((f as unknown as { asked: string[] }).asked).toEqual([])
  })

  it('switched off: nothing is fetched and the answer is never designated (control: DESIGNATED)', async () => {
    setStateVerifiedApproversEnabled(false)
    const f = atA()
    expect(await check(A, f)).toMatchObject({ result: 'unreachable', why: 'switchedOff' })
    expect((f as unknown as { asked: string[] }).asked).toEqual([])
  })
})
