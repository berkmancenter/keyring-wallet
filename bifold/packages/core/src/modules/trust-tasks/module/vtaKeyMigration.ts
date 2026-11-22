/**
 * Moving an existing install's persona keys into memory (#10, plan part E).
 *
 * Phones installed before persona keys were held in memory only keep a copy of
 * each persona's keys in the wallet's store. On upgrade each copy moves: the
 * keys are fetched from the agent into memory, the persona is switched to them,
 * and only then are the stored copies deleted. Nothing is deleted until the
 * agent has handed the keys over, so a phone whose agent is out of reach keeps
 * signing with its stored copy and moves at the next session.
 *
 * Every step can be repeated. The stored copies' ids are recorded on the
 * persona before anything moves and cleared once they are gone, so a move
 * interrupted at any point — the app killed, the agent dropping mid-way —
 * finishes next time instead of losing track of a copy.
 *
 * A persona switched to its in-memory copies keeps its stored ones until a
 * later run: a messaging session opened earlier in this run may still name the
 * stored key, and deleting it under that session would cut it off. The next
 * run starts every session from the switched record, so the delete is safe
 * there.
 *
 * @module trust-tasks/module/vtaKeyMigration
 */
import type { VtiPersona } from './VtiIdentityStore'
import { isInMemoryKeyId } from './vtaKeys'

export interface KeyMigrationPort {
  /** Fetch the agent's key into memory; answers the in-memory KMS id. */
  borrowKey(vtaKeyId: string): Promise<{ keyId: string }>
  /** Delete a stored copy. Never throws. */
  forgetKeyCopy(keyId: string): Promise<void>
}

export interface KeyMigrationStore {
  listPersonas(): Promise<VtiPersona[]>
  setPersona(persona: VtiPersona): Promise<void>
}

/**
 * `switched` now use in-memory copies, their stored ones deleted at a later
 * run; `moved` are finished, and `removed` names the stored copies deleted (ids
 * only — never key material); `waiting` could not fetch from the agent and keep
 * their stored copies until the next try.
 */
export type KeyMigrationOutcome = {
  switched: string[]
  moved: string[]
  removed: string[]
  waiting: { did: string; error: unknown }[]
}

const storedCopies = (ids: VtiPersona['kmsKeyIds']) =>
  Object.values(ids ?? {}).filter((id): id is string => !!id && !isInMemoryKeyId(id))

/** Whether a persona still has a stored copy to move or delete. */
export function needsKeyMigration(persona: VtiPersona): boolean {
  return storedCopies(persona.kmsKeyIds).length > 0 || storedCopies(persona.legacyKmsKeyIds).length > 0
}

/**
 * Move every persona of the agent `vtaDid` whose keys are still stored, one at
 * a time. `switchedThisRun` is kept by the caller for the life of the app
 * process: a persona switched earlier in this run — a session reopening after a
 * drop runs this again — keeps its stored copies until the next run.
 */
export async function migratePersonaKeys(
  port: KeyMigrationPort,
  store: KeyMigrationStore,
  vtaDid: string,
  switchedThisRun: Set<string> = new Set()
): Promise<KeyMigrationOutcome> {
  const outcome: KeyMigrationOutcome = { switched: [], moved: [], removed: [], waiting: [] }
  const personas = (await store.listPersonas()).filter((p) => p.vtaDid === vtaDid && needsKeyMigration(p))
  for (let persona of personas) {
    try {
      // 1. Record the stored copies before anything moves.
      if (storedCopies(persona.kmsKeyIds).length > 0 && !persona.legacyKmsKeyIds) {
        persona = { ...persona, legacyKmsKeyIds: { ...persona.kmsKeyIds } }
        await store.setPersona(persona)
      }
      // 2. Fetch into memory and switch the persona to the in-memory copies.
      if (storedCopies(persona.kmsKeyIds).length > 0) {
        const signing = await port.borrowKey(persona.vtaKeyIds.signing)
        const keyAgreement = await port.borrowKey(persona.vtaKeyIds.keyAgreement)
        persona = { ...persona, kmsKeyIds: { signing: signing.keyId, keyAgreement: keyAgreement.keyId } }
        await store.setPersona(persona)
        outcome.switched.push(persona.did)
        switchedThisRun.add(persona.did)
        continue
      }
      if (switchedThisRun.has(persona.did)) continue
      // 3. At a later run, delete the stored copies, then forget them.
      for (const keyId of storedCopies(persona.legacyKmsKeyIds)) {
        await port.forgetKeyCopy(keyId)
        outcome.removed.push(keyId)
      }
      const done = { ...persona }
      delete done.legacyKmsKeyIds
      await store.setPersona(done)
      outcome.moved.push(persona.did)
    } catch (error) {
      outcome.waiting.push({ did: persona.did, error })
    }
  }
  return outcome
}
