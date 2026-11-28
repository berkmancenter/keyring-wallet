/**
 * The VDC re-issue policy (backlog fb-3, plan §3.4): an `active` record whose entry was read as listed and whose grant
 * has 48 hours or less left gets a new grant, signed as its persona, scoped as at pairing, ending at the entry's
 * expiry for a temporary agent and 7 days ahead for a persistent one. Records with no grant, and temporary ones already
 * expired, are skipped; a throw is `failed` and the next record still runs.
 */
import type { AccessEntry } from '../carriage'
import type { EntryRead } from '../entryRead'
import { agentRecord, FIXTURE_NOW } from '../testing/fixtures'
import type { AgentConnection } from '../types'
import { AGENT_VDC_SCOPE, KEYS_SIGN_DOCUMENT_TASK, VDC_MAX_VALIDITY_MS, type VdcSignPort } from '../vdc'
import { reissueDueGrants, type VdcReissuePorts } from '../vdcReissue'

const HOUR = 60 * 60 * 1000
const NOW = FIXTURE_NOW
const PERSONA = 'did:webvh:persona.example:ada'

const listed = (subject: string): EntryRead => ({
  kind: 'listed',
  entry: { subject, role: 'application', act: { stated: 'contexts', contexts: [] } } as AccessEntry,
})

/** A grant as the record stores it: only `validUntil` matters to the policy. */
const grantUntil = (ms: number) => ({ validUntil: new Date(ms).toISOString(), issuer: PERSONA })

/** An active persistent agent whose grant ends `left` from now. */
const persistent = (id: string, left: number, overrides: Partial<AgentConnection> = {}) =>
  agentRecord({
    id,
    agentDid: id,
    grantType: 'persistent',
    expiresAt: undefined,
    vdcGrant: grantUntil(NOW + left),
    ...overrides,
  })

/** A fake VTA answering `keys/sign-document/0.1` as signed by the asked key; `fail` names agents it refuses. */
function signer(fail: ReadonlySet<string> = new Set()) {
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const vdcSign: VdcSignPort = {
    async task(type, payload) {
      sent.push({ type, payload })
      const document = payload.document as Record<string, unknown> & { credentialSubject: { id: string } }
      if (fail.has(document.credentialSubject.id)) throw new Error('keys:notFound')
      return { keyId: payload.keyId, signerDid: document.issuer, document: { ...document, proof: { sig: 'z' } } }
    },
  }
  return { vdcSign, sent }
}

/** A store over `records`, recording each update. */
function store(records: AgentConnection[]) {
  const byId = new Map(records.map((r) => [r.id, r]))
  const updated: string[] = []
  const connections: VdcReissuePorts['connections'] = {
    async update(id, change) {
      updated.push(id)
      const current = byId.get(id)
      if (!current) return undefined
      const next = change(current)
      byId.set(id, next)
      return next
    },
  }
  return { connections, byId, updated }
}

function run(
  records: AgentConnection[],
  reads: Map<string, EntryRead> = new Map(records.map((r) => [r.id, listed(r.agentDid)])),
  options: { fail?: Set<string>; signingKeyIdOf?: (persona: string) => string; stored?: AgentConnection[] } = {}
) {
  const sign = signer(options.fail)
  const db = store(options.stored ?? records)
  const ports: VdcReissuePorts = {
    clock: () => NOW,
    vdcSign: sign.vdcSign,
    connections: db.connections,
    ...(options.signingKeyIdOf ? { signingKeyIdOf: options.signingKeyIdOf } : {}),
  }
  return { result: reissueDueGrants(ports, records, reads), sign, db }
}

const grantOf = (record: AgentConnection | undefined) =>
  record?.vdcGrant as
    | { validUntil: string; issuer: string; credentialSubject: { id: string; delegation: { scope: string[] } } }
    | undefined

describe('reissueDueGrants', () => {
  it('re-issues a grant with 48 hours or less left, and leaves one with more alone', async () => {
    const due = persistent('did:key:z6MkDue', 47 * HOUR)
    const lapsed = persistent('did:key:z6MkLapsed', -HOUR)
    const fresh = persistent('did:key:z6MkFresh', 72 * HOUR)
    const { result, db, sign } = run([due, lapsed, fresh])
    expect(await result).toEqual({ reissued: [due.id, lapsed.id], failed: [] })
    expect(db.updated).toEqual([due.id, lapsed.id])
    expect(sign.sent.map((s) => s.type)).toEqual([KEYS_SIGN_DOCUMENT_TASK, KEYS_SIGN_DOCUMENT_TASK])
    expect(grantOf(db.byId.get(fresh.id))?.validUntil).toBe(new Date(NOW + 72 * HOUR).toISOString())
  })

  it('an entry read as not listed means no re-issue', async () => {
    const record = persistent('did:key:z6MkGone', HOUR)
    const { result, sign } = run([record], new Map([[record.id, { kind: 'notListed' }]]))
    expect(await result).toEqual({ reissued: [], failed: [] })
    expect(sign.sent).toEqual([])
  })

  it('an unknown read, or no read at all, means no re-issue', async () => {
    const unknown = persistent('did:key:z6MkUnknown', HOUR)
    const unread = persistent('did:key:z6MkUnread', HOUR)
    const { result, sign } = run([unknown, unread], new Map([[unknown.id, { kind: 'unknown' }]]))
    expect(await result).toEqual({ reissued: [], failed: [] })
    expect(sign.sent).toEqual([])
  })

  it("a persistent agent's new grant runs 7 days ahead, signed as its persona, scoped as at pairing", async () => {
    const record = persistent('did:key:z6MkKept', HOUR)
    const { result, db, sign } = run([record])
    await result
    const grant = grantOf(db.byId.get(record.id))
    expect(Date.parse(grant?.validUntil as string)).toBe(NOW + VDC_MAX_VALIDITY_MS)
    expect(grant?.issuer).toBe(PERSONA)
    expect(grant?.credentialSubject.id).toBe(record.agentDid)
    expect(grant?.credentialSubject.delegation.scope).toEqual([AGENT_VDC_SCOPE.chat, AGENT_VDC_SCOPE.memory])
    expect(sign.sent[0].payload.keyId).toBe(`${PERSONA}#key-0`)
  })

  it("a temporary agent's new grant ends at the record's expiresAt", async () => {
    const expiresAt = new Date(NOW + 30 * HOUR).toISOString()
    const record = agentRecord({ id: 'did:key:z6MkTemp', agentDid: 'did:key:z6MkTemp', expiresAt })
    const withGrant = { ...record, vdcGrant: grantUntil(NOW + HOUR) }
    const { result, db } = run([withGrant])
    expect(await result).toEqual({ reissued: [withGrant.id], failed: [] })
    expect(Date.parse(grantOf(db.byId.get(record.id))?.validUntil as string)).toBe(Date.parse(expiresAt))
  })

  it('without memories the scope is chat alone, and signingKeyIdOf names the key', async () => {
    const record = persistent('did:key:z6MkChat', HOUR, { memoryContexts: [] })
    const { result, db, sign } = run([record], undefined, { signingKeyIdOf: (p) => `${p}#key-7` })
    await result
    expect(grantOf(db.byId.get(record.id))?.credentialSubject.delegation.scope).toEqual([AGENT_VDC_SCOPE.chat])
    expect(sign.sent[0].payload.keyId).toBe(`${PERSONA}#key-7`)
  })

  it('a signer failure is failed, and the next record still runs', async () => {
    const refused = persistent('did:key:z6MkRefused', HOUR)
    const next = persistent('did:key:z6MkNext', HOUR)
    const { result, db } = run([refused, next], undefined, { fail: new Set([refused.agentDid]) })
    expect(await result).toEqual({ reissued: [next.id], failed: [refused.id] })
    expect(grantOf(db.byId.get(refused.id))?.validUntil).toBe(new Date(NOW + HOUR).toISOString())
    expect(db.updated).toEqual([next.id])
  })

  it('a store that throws is failed too', async () => {
    const record = persistent('did:key:z6MkStoreDown', HOUR)
    const ports: VdcReissuePorts = {
      clock: () => NOW,
      vdcSign: signer().vdcSign,
      connections: {
        async update() {
          throw new Error('storage unavailable')
        },
      },
    }
    expect(await reissueDueGrants(ports, [record], new Map([[record.id, listed(record.agentDid)]]))).toEqual({
      reissued: [],
      failed: [record.id],
    })
  })

  it('skips, without failing, a record with no grant, a grant with no validUntil string, and an expired temporary one', async () => {
    const noGrant = persistent('did:key:z6MkNoGrant', HOUR, { vdcGrant: undefined })
    const noUntil = persistent('did:key:z6MkNoUntil', HOUR, { vdcGrant: { validUntil: 12 } })
    const expiredTemp = agentRecord({
      id: 'did:key:z6MkExpiredTemp',
      agentDid: 'did:key:z6MkExpiredTemp',
      expiresAt: new Date(NOW - HOUR).toISOString(),
      vdcGrant: grantUntil(NOW - HOUR),
    })
    const { result, sign, db } = run([noGrant, noUntil, expiredTemp])
    expect(await result).toEqual({ reissued: [], failed: [] })
    expect(sign.sent).toEqual([])
    expect(db.updated).toEqual([])
  })

  it('only an active record is due: expired, revoking and revoked are left alone', async () => {
    const records = (['expired', 'revoking', 'revoked'] as const).map((state) =>
      persistent(`did:key:z6Mk-${state}`, HOUR, { state })
    )
    const { result, sign } = run(records)
    expect(await result).toEqual({ reissued: [], failed: [] })
    expect(sign.sent).toEqual([])
  })

  it('a record that left active while its grant was signed keeps its old grant and is in neither list', async () => {
    const record = persistent('did:key:z6MkRevokedMeanwhile', HOUR)
    const stored = [{ ...record, state: 'revoking' as const }]
    const { result, db } = run([record], undefined, { stored })
    expect(await result).toEqual({ reissued: [], failed: [] })
    expect(grantOf(db.byId.get(record.id))?.validUntil).toBe(new Date(NOW + HOUR).toISOString())
  })

  it('control: 49 hours left is not due', async () => {
    // control: one hour past the 48-hour window; the 47-hour record in the first case is re-issued
    const record = persistent('did:key:z6MkNotYet', 49 * HOUR)
    const { result, sign } = run([record])
    expect(await result).toEqual({ reissued: [], failed: [] })
    expect(sign.sent).toEqual([])
  })
})
