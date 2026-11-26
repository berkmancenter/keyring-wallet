/**
 * An existing install's persona keys move into memory (#10, plan part E):
 * nothing stored is deleted until the agent has handed the keys over, a move
 * interrupted anywhere finishes next time, and a stored copy is deleted only
 * at a later run than the one that switched away from it.
 */
import type { VtiPersona } from '../module/VtiIdentityStore'
import { migratePersonaKeys, needsKeyMigration } from '../module/vtaKeyMigration'
import { inMemoryKeyId } from '../module/vtaKeys'

const VTA = 'did:webvh:QmAgent:agent.example'
const OTHER = 'did:webvh:QmOther:other.example'

const persona = (did: string, over: Partial<VtiPersona> = {}): VtiPersona => ({
  communityDid: `did:c:${did}`,
  vtaDid: VTA,
  did,
  contextId: 'ctx',
  vtaKeyIds: { signing: `${did}#key-0`, keyAgreement: `${did}#key-1` },
  kmsKeyIds: { signing: `stored-s-${did}`, keyAgreement: `stored-ka-${did}` },
  createdAt: 't0',
  ...over,
})

function world(personas: VtiPersona[], opts: { agentDown?: boolean } = {}) {
  const records = new Map(personas.map((p) => [p.did, p]))
  const deleted: string[] = []
  const saves: VtiPersona[] = []
  let agentDown = opts.agentDown ?? false
  const port = {
    borrowKey: async (vtaKeyId: string) => {
      if (agentDown) throw new Error('agent unreachable')
      return { keyId: inMemoryKeyId(VTA, vtaKeyId) }
    },
    forgetKeyCopy: async (keyId: string) => void deleted.push(keyId),
  }
  const store = {
    listPersonas: async () => [...records.values()],
    setPersona: async (p: VtiPersona) => {
      saves.push(p)
      records.set(p.did, p)
    },
  }
  return { port, store, records, deleted, saves, agentUp: () => (agentDown = false) }
}

describe("moving an existing install's persona keys into memory", () => {
  it('switches to in-memory copies first, and deletes the stored ones only at a later run', async () => {
    const w = world([persona('did:p:a')])
    const first = await migratePersonaKeys(w.port, w.store, VTA, new Set())
    expect(first).toMatchObject({ switched: ['did:p:a'], moved: [] })
    expect(w.deleted).toEqual([])
    const switched = w.records.get('did:p:a')!
    expect(switched.kmsKeyIds).toEqual({
      signing: inMemoryKeyId(VTA, 'did:p:a#key-0'),
      keyAgreement: inMemoryKeyId(VTA, 'did:p:a#key-1'),
    })
    expect(switched.legacyKmsKeyIds).toEqual({ signing: 'stored-s-did:p:a', keyAgreement: 'stored-ka-did:p:a' })

    const next = await migratePersonaKeys(w.port, w.store, VTA, new Set())
    expect(next).toMatchObject({ switched: [], moved: ['did:p:a'] })
    expect(next.removed.sort()).toEqual(['stored-ka-did:p:a', 'stored-s-did:p:a'])
    expect(w.deleted.sort()).toEqual(['stored-ka-did:p:a', 'stored-s-did:p:a'])
    expect(w.records.get('did:p:a')!.legacyKmsKeyIds).toBeUndefined()
    expect(needsKeyMigration(w.records.get('did:p:a')!)).toBe(false)
  })

  it('does not delete in the same run, even when the session reopens and it runs again', async () => {
    const w = world([persona('did:p:a')])
    const thisRun = new Set<string>()
    await migratePersonaKeys(w.port, w.store, VTA, thisRun)
    await migratePersonaKeys(w.port, w.store, VTA, thisRun)
    expect(w.deleted).toEqual([])
  })

  it('keeps the stored copy, and signing with it, while the agent will not hand the keys over', async () => {
    const w = world([persona('did:p:a')], { agentDown: true })
    const outcome = await migratePersonaKeys(w.port, w.store, VTA, new Set())
    expect(outcome.waiting.map((x) => x.did)).toEqual(['did:p:a'])
    expect(w.deleted).toEqual([])
    expect(w.records.get('did:p:a')!.kmsKeyIds).toEqual({ signing: 'stored-s-did:p:a', keyAgreement: 'stored-ka-did:p:a' })

    w.agentUp()
    const later = await migratePersonaKeys(w.port, w.store, VTA, new Set())
    expect(later.switched).toEqual(['did:p:a'])
    expect(w.deleted).toEqual([])
  })

  it('finishes a move interrupted after the stored copies were switched away from', async () => {
    const interrupted = persona('did:p:a', {
      kmsKeyIds: { signing: inMemoryKeyId(VTA, 'did:p:a#key-0'), keyAgreement: inMemoryKeyId(VTA, 'did:p:a#key-1') },
      legacyKmsKeyIds: { signing: 'stored-s-did:p:a', keyAgreement: 'stored-ka-did:p:a' },
    })
    const w = world([interrupted])
    const outcome = await migratePersonaKeys(w.port, w.store, VTA, new Set())
    expect(outcome.moved).toEqual(['did:p:a'])
    expect(w.deleted.sort()).toEqual(['stored-ka-did:p:a', 'stored-s-did:p:a'])
  })

  it('leaves identities of another agent, and ones already in memory, alone', async () => {
    const inMemory = persona('did:p:m', {
      kmsKeyIds: { signing: inMemoryKeyId(VTA, 'did:p:m#key-0'), keyAgreement: inMemoryKeyId(VTA, 'did:p:m#key-1') },
    })
    const w = world([persona('did:p:x', { vtaDid: OTHER }), inMemory])
    const outcome = await migratePersonaKeys(w.port, w.store, VTA, new Set())
    expect(outcome).toEqual({ switched: [], moved: [], removed: [], waiting: [] })
    expect(w.saves).toEqual([])
  })
})
