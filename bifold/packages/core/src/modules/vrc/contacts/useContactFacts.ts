/**
 * What this phone knows about a contact, read once and kept: the name and photo
 * from their contact card (or a legacy VRC's issuer), and whether their hardware
 * evidence verifies. Every screen reads the same facts, and each fact is
 * `Known`: not read yet is not "no name" or "not verified" (UI-smoothness plan,
 * Phase 4). A contact's name read as absent may say "Unnamed contact"; one not
 * read yet says nothing until it is.
 *
 * The name and photo come from one read of the relationship records, beside the
 * wallet's credentials; the name cache read them once per relationship. Hardware
 * evidence is verified once per credential and shared: the Contacts list and the
 * contact's page each verified it again, and the badge appeared late on both.
 *
 * @module vrc/contacts/useContactFacts
 */
import type { Agent, W3cCredentialRecord } from '@credo-ts/core'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import { verifyVrcHardwareEvidence } from '../services/BiometricSignatureVerifier'
import { resolveContactDisplayInfo } from '../utils/rcardDisplayUtils'
import { getVrcCredentialJsonForSubject, hasVrcHardwareAttestation } from '../utils/witnessCredentialUtils'

/** A fact not read yet (`known: false`), or read (`known: true`), whatever it turned out to be. */
export type Known<T> = { known: false } | { known: true; value: T }

/** A connection's facts, for the chat list and the chat screen. */
export interface ConnectionFacts {
  name: Known<string | undefined>
  photo: Known<string | undefined>
}

/** A contact's facts, over every relationship it groups, for the Contacts list and the contact's page. */
export interface ContactFacts extends ConnectionFacts {
  hwVerified: Known<boolean>
}

const UNKNOWN: Known<never> = Object.freeze({ known: false }) as Known<never>
const ABSENT: Known<undefined> = Object.freeze({ known: true, value: undefined }) as Known<undefined>
const known = <T>(value: T): Known<T> => (value === undefined ? (ABSENT as Known<T>) : { known: true, value })

const NOT_READ: ConnectionFacts = Object.freeze({ name: UNKNOWN, photo: UNKNOWN })
const NOTHING: ConnectionFacts = Object.freeze({ name: ABSENT, photo: ABSENT })

/**
 * The name to show or match on: undefined when it is not read yet and when it was
 * read as absent. A name not read yet must never match another (two contacts not
 * yet loaded are not namesakes).
 */
export function knownName(fact: Known<string | undefined>): string | undefined {
  return fact.known ? fact.value : undefined
}

class ContactFactsStore {
  /** Display facts per connection and per relationship DID, once read. */
  private byConnection = new Map<string, ConnectionFacts>()
  private byRelationship = new Map<string, ConnectionFacts>()
  /** Each connection's relationship DID (the counterparty's), read with the rest; never stored anywhere else. */
  private relationshipOfConnection: ReadonlyMap<string, string> = new Map()
  private loaded = false
  private seq = 0
  private records: W3cCredentialRecord[] = []
  /** Hardware verification per relationship DID, and the credential it was verified for. */
  private hw = new Map<string, { credentialId: string; verified: Known<boolean> }>()
  private verifying = new Set<string>()
  private listeners = new Set<() => void>()
  private version = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private changed() {
    this.version++
    this.listeners.forEach((l) => l())
  }

  /** Whether the first read has landed. */
  get isLoaded(): boolean {
    return this.loaded
  }

  /** What has changed since: a number for snapshots that combine several facts. */
  get changes(): number {
    return this.version
  }

  /**
   * Read every relationship once, with the wallet's credentials, and keep each
   * contact's name and photo. Only the newest read lands. Hardware results for a
   * credential that is still the same are kept.
   */
  async load(agent: Agent, records: W3cCredentialRecord[]): Promise<void> {
    const seq = ++this.seq
    const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
    const relationships = await repository.getAll(agent.context)
    if (seq !== this.seq) return
    const byConnection = new Map<string, ConnectionFacts>()
    const byRelationship = new Map<string, ConnectionFacts>()
    const relationshipOfConnection = new Map<string, string>()
    for (const r of relationships) {
      const did = r.counterpartyRelationshipDid
      if (!did) continue
      if (r.connectionId) relationshipOfConnection.set(r.connectionId, did)
      const info = resolveContactDisplayInfo(records, did)
      const name = info.name || undefined
      const photo = info.photo || undefined
      // Unchanged, the same object: every credential change re-reads, and a screen re-renders only for a contact
      // whose name or photo moved (the chat list is long).
      const before = this.byRelationship.get(did)
      const facts: ConnectionFacts =
        before && sameValue(before.name, name) && sameValue(before.photo, photo)
          ? before
          : { name: known(name), photo: known(photo) }
      byRelationship.set(did, facts)
      if (r.connectionId) byConnection.set(r.connectionId, facts)
    }
    this.records = records
    this.byConnection = byConnection
    this.byRelationship = byRelationship
    // The same map while nothing moved, so a list grouped by it does not regroup on every credential change.
    if (!sameEntries(this.relationshipOfConnection, relationshipOfConnection)) {
      this.relationshipOfConnection = relationshipOfConnection
    }
    this.loaded = true
    this.changed()
  }

  /** A connection's facts: not read yet until the first read lands; nothing, if it has no relationship. */
  connection(connectionId: string | undefined): ConnectionFacts {
    if (!connectionId || !this.loaded) return NOT_READ
    return this.byConnection.get(connectionId) ?? NOTHING
  }

  /**
   * Each connection's relationship DID, or undefined until the first read lands. A connection missing from it has no
   * relationship record: it is its own contact, never hidden.
   */
  relationships(): ReadonlyMap<string, string> | undefined {
    return this.loaded ? this.relationshipOfConnection : undefined
  }

  /** A relationship's display facts. */
  relationship(relationshipDid: string): ConnectionFacts {
    if (!this.loaded) return NOT_READ
    return this.byRelationship.get(relationshipDid) ?? NOTHING
  }

  /** Whether a relationship's hardware evidence verifies: not read yet until it has been checked. */
  hardware(relationshipDid: string): Known<boolean> {
    if (!this.loaded) return UNKNOWN
    const credential = getVrcCredentialJsonForSubject(this.records, relationshipDid)
    const credentialId = String(credential?.id ?? '')
    const entry = this.hw.get(relationshipDid)
    return entry && entry.credentialId === credentialId ? entry.verified : UNKNOWN
  }

  /**
   * Verify each relationship's hardware evidence that is not verified yet for
   * its current credential. One at a time per relationship: a second screen
   * asking meanwhile shares the first answer. No evidence is "not verified" at
   * once, with nothing to check.
   */
  verify(relationshipDids: string[]): void {
    if (!this.loaded) return
    for (const did of relationshipDids) {
      if (this.hardware(did).known || this.verifying.has(did)) continue
      const credential = getVrcCredentialJsonForSubject(this.records, did)
      const credentialId = String(credential?.id ?? '')
      if (!credential || !hasVrcHardwareAttestation(this.records, did)) {
        this.hw.set(did, { credentialId, verified: known(false) })
        this.changed()
        continue
      }
      this.verifying.add(did)
      void verifyVrcHardwareEvidence(credential as never)
        .then(
          (result) => result?.valid === true,
          () => false
        )
        .then((valid) => {
          this.verifying.delete(did)
          this.hw.set(did, { credentialId, verified: known(valid) })
          this.changed()
        })
    }
  }

  /** For tests: forget everything read. */
  forget(): void {
    this.relationshipOfConnection = new Map()
    this.byConnection = new Map()
    this.byRelationship = new Map()
    this.hw = new Map()
    this.verifying = new Set()
    this.records = []
    this.loaded = false
    this.seq++
    this.changed()
  }
}

export const contactFacts = new ContactFactsStore()

const sameEntries = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([key, value]) => b.get(key) === value)

/** Each connection's relationship DID, for grouping the chat list by contact: undefined until read. */
export function useConnectionRelationships(): ReadonlyMap<string, string> | undefined {
  return useSyncExternalStore(contactFacts.subscribe, () => contactFacts.relationships())
}

/** A connection's name and photo, for the chat list and the chat screen. */
export function useConnectionFacts(connectionId: string | undefined): ConnectionFacts {
  return useSyncExternalStore(contactFacts.subscribe, () => contactFacts.connection(connectionId))
}

/**
 * A contact's name, photo and hardware verification, over the relationships it
 * groups: the name and photo of the first, and verified when any one verifies,
 * not verified when every one is known not to, else not read yet. Asks for the
 * verification of any relationship not verified yet.
 */
export function useContactFacts(relationshipDids: string[]): ContactFacts {
  const key = relationshipDids.join('|')
  const last = useRef<{ key: string; changes: number; facts: ContactFacts }>(undefined)
  const facts = useSyncExternalStore(contactFacts.subscribe, () => {
    const before = last.current
    if (before && before.key === key && before.changes === contactFacts.changes) return before.facts
    const first = relationshipDids[0]
    const display = first ? contactFacts.relationship(first) : NOT_READ
    const each = relationshipDids.map((did) => contactFacts.hardware(did))
    const hwVerified: Known<boolean> = each.some((v) => v.known && v.value)
      ? known(true)
      : each.length > 0 && each.every((v) => v.known)
        ? known(false)
        : UNKNOWN
    const next = { name: display.name, photo: display.photo, hwVerified }
    // The same facts are the same object, so a screen re-renders only when one of them changed.
    if (
      before &&
      before.key === key &&
      before.facts.name === next.name &&
      before.facts.photo === next.photo &&
      sameKnown(before.facts.hwVerified, next.hwVerified)
    ) {
      last.current = { ...before, changes: contactFacts.changes }
      return before.facts
    }
    last.current = { key, changes: contactFacts.changes, facts: next }
    return next
  })
  // Asked when the list changes (its key), and again once the first read lands.
  const loaded = contactFacts.relationship(relationshipDids[0] ?? '') !== NOT_READ
  const dids = useRef(relationshipDids)
  dids.current = relationshipDids
  // And whenever the verification is owed again: a credential re-issued while the screen is open makes it unknown
  // (the frozen UNKNOWN), and asking then re-checks it; once known, verify() asks for nothing, so no loop.
  useEffect(() => {
    contactFacts.verify(dids.current)
  }, [key, loaded, facts.hwVerified])
  return facts
}

const sameKnown = (a: Known<boolean>, b: Known<boolean>) =>
  a.known === b.known && (!a.known || !b.known || a.value === b.value)

const sameValue = (fact: Known<string | undefined>, value: string | undefined) => fact.known && fact.value === value
