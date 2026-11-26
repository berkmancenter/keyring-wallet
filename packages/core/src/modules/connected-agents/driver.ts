/**
 * The connect driver (docs/plans/agent-connect-plan.md §7.7): the pairing machine of §7.2 over the carriage of §7.5,
 * with the owner's VTA as its ports, and what a confirmed pairing leaves in Keyring's store.
 *
 * - **P0 pairs by the fallback only.** No VTA serves `auth/oob` (step 7.1), so the `auth/oob` port answers
 *   `unsupportedType` ({@link unservedOob}) and an `auth/oob` link ends as "unsupported". When a VTA serves
 *   `deviceEnrol`, a port over its `TrustTaskHTTPS` endpoint replaces it; nothing else changes.
 * - **A confirmed pairing** is written as a `pairing` record, its one-context remainder is finished (§7.5), and its VDC
 *   grant is issued through `issueVdc` and stored; only then is it `active` (#1060 finding 19: until the chat carries
 *   the acceptance, step 7.9). A grant that cannot be issued leaves the record `pairing`, retried by
 *   {@link AgentConnectDriver.reconcilePairing}, and "Not finished" once the pairing's ten minutes are up.
 * - **What a failed, cancelled or unfinished pairing leaves at the VTA** (`cleanup` on the machine's state) is recorded
 *   here as a "Not finished" record (§3.10: listed "Not finished", offered "Remove", removed on its own after ten
 *   minutes), so nothing is forgotten. The removal itself is the actions' step (Remove, the not-finished sweep).
 *   **The one leftover that cannot be recorded:** an `auth/oob` grant refused after the VTA wrote an entry, when neither
 *   `prove` nor the grant named the subject. The machine then has no key to name (`pairing.ts`, the
 *   `TODO(§11 Q7(c), step 7.5)` in `checkEnrolment`), so there is no row for Remove or the sweep. P0 cannot reach it:
 *   the fallback knows its subject from the scanned `did:key`, and `auth/oob` is refused as unsupported. It opens with
 *   `auth/oob`, and closes when Q7(c) is answered.
 *
 * @module connected-agents/driver
 */

import { PairingCarriage, accessEntryReader, completeEnrolment } from './carriage'
import type { AgentAccessPort, AnswerVerifier, OobServicePort } from './carriage'
import type { AdministratorSigner } from './deviceEnrolDraft'
import { PairingLockout, type LockoutStore } from './lockout'
import {
  NOT_FINISHED_AFTER_MS,
  PairingMachine,
  type AgentConnectChoice,
  type ConfirmedAgent,
  type NumberEntry,
  type PairingCleanup,
  type PairingLink,
  type PairingState,
  type SpentRequestStore,
} from './pairing'
import type { AgentConnection } from './types'
import { buildVdcGrant, issueVdc, vdcScopeFor, vtaVdcSigner, type VdcSignPort } from './vdc'

/** The `auth/oob` service while no VTA serves it (step 7.1: `unsupportedType` on 0.79.0, 0.84.0 and 0.87.0). */
export const unservedOob: OobServicePort = {
  async send() {
    return { refused: 'auth/oob/claim:unsupportedType' }
  },
}

/** The connection records the driver reads and writes (`AgentConnectionStore`). */
export interface ConnectionRecords {
  list(): Promise<AgentConnection[]>
  get(id: string): Promise<AgentConnection | undefined>
  put(record: AgentConnection): Promise<void>
}

/** A persona's signing key, as minting and the DID list give it (`vdc.ts`, step 0.1(f)). */
export const personaSigningKeyId = (personaDid: string): string => `${personaDid}#key-0`

export type DriverPorts = {
  clock: () => number
  /** The VTA this phone administers. */
  vtaDid: string
  access: AgentAccessPort
  /** `keys/sign-document/0.1` on the owner's VTA, for the VDC (step 7.3). */
  vdcSign: VdcSignPort
  oob?: OobServicePort
  verify: AnswerVerifier
  administrator: AdministratorSigner
  connections: ConnectionRecords
  lockoutStore: LockoutStore
  spent: SpentRequestStore
  signingKeyIdOf?: (personaDid: string) => string
}

/** What persisting a pairing's end came to. */
export type PersistOutcome =
  | { state: 'active' }
  | { state: 'pairing'; reason: 'vdc' }
  | { state: 'notFinished'; subject: string }
  | { state: 'kept'; subject: string }

const iso = (ms: number) => new Date(ms).toISOString()

/** The record a confirmed pairing becomes, before its VDC (§3.11). */
export function recordFor(agent: ConfirmedAgent, now: number): AgentConnection {
  return {
    id: agent.agentDid,
    name: agent.name,
    handle: agent.handle,
    agentDid: agent.agentDid,
    deviceId: agent.deviceId,
    ownerPersonaDid: agent.ownerPersonaDid,
    vtaDid: agent.vtaDid,
    contexts: [...agent.contexts],
    memoryContexts: [...agent.memoryContexts],
    pendingContexts: [...agent.contextsToAdd],
    capabilities: agent.capabilities.scope === 'listed' ? [...agent.capabilities.listed] : [],
    purposes: [...agent.purposes],
    expiresAt: agent.expiresAt,
    grantType: agent.grantType,
    answersOthers: false,
    state: 'pairing',
    keyChanged: false,
    createdAt: iso(now),
    lastReconciledAt: iso(now),
  }
}

/**
 * The record of what an unfinished pairing left at the VTA (§3.10): "Not finished", keyed by the entry's subject, with
 * its `deviceId` when the agent registered. Never a contact and never connected; Remove and the sweep act on it.
 */
export function leftoverRecordFor(
  cleanup: PairingCleanup,
  choice: AgentConnectChoice | undefined,
  now: number
): AgentConnection {
  return {
    id: cleanup.subject,
    name: choice?.name ?? '',
    handle: '',
    agentDid: cleanup.subject,
    deviceId: cleanup.deviceId ?? '',
    ownerPersonaDid: choice?.ownerPersonaDid ?? '',
    vtaDid: cleanup.vtaDid,
    contexts: [],
    memoryContexts: choice ? [...choice.memoryContexts] : [],
    pendingContexts: [],
    capabilities: [],
    purposes: choice ? [...choice.purposes] : [],
    grantType: 'temporary',
    answersOthers: false,
    state: 'notFinished',
    keyChanged: false,
    createdAt: iso(now),
    lastReconciledAt: iso(now),
  }
}

/** The machine, wired to the owner's VTA, and the store a confirmed pairing lands in. */
export class AgentConnectDriver {
  private readonly machine: PairingMachine
  private handles: string[] = []
  private choice: AgentConnectChoice | undefined
  private persisting: Promise<PersistOutcome | undefined> = Promise.resolve(undefined)

  private constructor(
    private readonly ports: DriverPorts,
    private readonly onState?: (state: PairingState) => void
  ) {
    const carriage = new PairingCarriage({
      oob: ports.oob ?? unservedOob,
      verify: ports.verify,
      administrator: ports.administrator,
      access: ports.access,
    })
    this.machine = new PairingMachine({
      clock: ports.clock,
      resolver: { administers: (did) => did === ports.vtaDid, ownVta: () => ports.vtaDid },
      transport: carriage,
      entries: accessEntryReader(ports.access),
      spent: ports.spent,
      lockout: new PairingLockout(ports.lockoutStore, ports.clock),
      takenHandles: () => this.handles,
      onTransition: (state) => this.transition(state),
    })
  }

  /** A driver whose handle check knows the owner's other agents. */
  public static async create(ports: DriverPorts, onState?: (state: PairingState) => void): Promise<AgentConnectDriver> {
    const driver = new AgentConnectDriver(ports, onState)
    driver.handles = (await ports.connections.list()).map((r) => r.handle)
    return driver
  }

  public get state(): PairingState {
    return this.machine.state
  }

  public start(choice: AgentConnectChoice): Promise<PairingState> {
    this.choice = choice
    return this.machine.start(choice)
  }

  public scan(link: PairingLink): Promise<PairingState> {
    return this.machine.scan(link)
  }

  public enterNumber(digits: string): Promise<NumberEntry> {
    return this.machine.enterNumber(digits)
  }

  /** The screen calls this only after the phone's face or fingerprint check passed (§6, Approve). */
  public approve(): Promise<PairingState> {
    return this.machine.approve()
  }

  public cancel(): Promise<PairingState> {
    return this.machine.cancel()
  }

  /** While a pairing waits for the agent's registration and rotation, re-list its entry (#1060 finding 11). */
  public async poll(): Promise<PairingState> {
    if (this.machine.state.phase === 'awaitingEnrolment') return this.machine.checkEnrolment()
    return this.machine.tick()
  }

  /** Settles once the last confirmed pairing has been written (for callers and tests that need its outcome). */
  public settled(): Promise<PersistOutcome | undefined> {
    return this.persisting
  }

  private transition(state: PairingState): void {
    if (state.phase === 'confirmed') {
      const agent = state.agent
      this.persisting = this.persisting.then(() => this.persist(agent))
    } else if ('cleanup' in state && state.cleanup) {
      const cleanup = state.cleanup
      const choice = this.choice
      this.persisting = this.persisting.then(() => this.recordLeftover(cleanup, choice))
    }
    this.onState?.(state)
  }

  private async persist(agent: ConfirmedAgent): Promise<PersistOutcome> {
    const { connections, access, clock } = this.ports
    let record = recordFor(agent, clock())
    await connections.put(record)
    this.handles = [...this.handles, record.handle]
    if (record.pendingContexts.length > 0) {
      const done = await completeEnrolment(access, agent, record.memoryContexts)
      record = { ...record, pendingContexts: done.complete ? [] : done.missing }
      await connections.put(record)
    }
    return this.issueGrant(record)
  }

  /**
   * Record what an ended pairing left at the VTA as "Not finished". A record already there for that subject that is
   * neither pairing nor unfinished (a connected agent's) is kept as it is: the leftover is never written over it.
   */
  private async recordLeftover(
    cleanup: PairingCleanup,
    choice: AgentConnectChoice | undefined
  ): Promise<PersistOutcome> {
    const existing = await this.ports.connections.get(cleanup.subject)
    // A `pairing` record may be written over: it is written only after `confirmed`, and every cleanup-carrying phase
    // comes before confirmation, so a cleanup for a subject already at `pairing` would come from a new pairing of that
    // key. Anything further along (a connected, expired, revoking or revoked agent) is kept as it is.
    if (existing && existing.state !== 'pairing' && existing.state !== 'notFinished') {
      return { state: 'kept', subject: cleanup.subject }
    }
    await this.ports.connections.put(leftoverRecordFor(cleanup, choice, this.ports.clock()))
    return { state: 'notFinished', subject: cleanup.subject }
  }

  /** Issue and store the VDC grant (step 7.3, §3.4); `active` only once it is stored (#1060 finding 19). */
  private async issueGrant(record: AgentConnection): Promise<PersistOutcome> {
    const { clock, vdcSign, connections } = this.ports
    const keyId = (this.ports.signingKeyIdOf ?? personaSigningKeyId)(record.ownerPersonaDid)
    try {
      const unsigned = buildVdcGrant({
        personaDid: record.ownerPersonaDid,
        agentDid: record.agentDid,
        scope: vdcScopeFor({ memory: record.memoryContexts.length > 0, roomAdded: false }),
        now: clock(),
        ...(record.expiresAt ? { entryExpiresAt: record.expiresAt } : {}),
      })
      const grant = await issueVdc(unsigned, vtaVdcSigner(vdcSign, keyId))
      await connections.put({
        ...record,
        state: 'active',
        vdcGrant: grant as unknown as Record<string, unknown>,
        lastReconciledAt: new Date(clock()).toISOString(),
      })
      return { state: 'active' }
    } catch {
      return { state: 'pairing', reason: 'vdc' }
    }
  }

  /**
   * Records still `pairing` (their grant was not issued): issue it now, or, ten minutes after the pairing, mark them
   * "Not finished" (§3.10). Asked where the VDC policy is asked: app start, opening the list or the details (§3.4).
   */
  public async reconcilePairing(): Promise<void> {
    const now = this.ports.clock()
    for (const record of await this.ports.connections.list()) {
      if (record.state !== 'pairing' || record.vdcGrant) continue
      const outcome = await this.issueGrant(record)
      if (outcome.state === 'active') continue
      if (now - Date.parse(record.createdAt) >= NOT_FINISHED_AFTER_MS) {
        await this.ports.connections.put({ ...record, state: 'notFinished', lastReconciledAt: iso(now) })
      }
    }
  }
}
