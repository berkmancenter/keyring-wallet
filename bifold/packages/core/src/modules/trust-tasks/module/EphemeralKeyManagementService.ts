/**
 * Persona keys held in memory only (#10, plan part C).
 *
 * The agent holds every persona's keys; this phone fetches a copy of each when
 * a session with the agent opens, and must not keep it past that. The agent
 * cannot sign a persona's proofs for the phone — `keys/sign/0.1` frames a
 * caller's bytes under its opaque-signing domain — so the copy has to be here,
 * and the custody rule is that it lives only in memory, as openvtc keeps it
 * (openvtc-core `config/keys.rs:276-296`: fetched at load into the TDK's
 * in-memory secrets resolver).
 *
 * A second KMS backend, `ephemeral`: Credo's own Askar KMS run against a
 * private in-memory Askar store instead of the wallet's, so every operation —
 * signing, key agreement, DIDComm encryption — is exactly the one the wallet
 * uses.
 *
 * It goes FIRST in the agent's backends AND is the default backend, and claims
 * only operations that name one of its own keys (ids from `inMemoryKeyId`,
 * prefix `vta-copy:`). Credo never routes an encrypt or decrypt whose key is a
 * key agreement by the key's id: it goes to the default backend if that one
 * supports it, else to the first that does (credo-ts 0.7.1-pr-2704 as bundled
 * in the app, `KeyManagementApi.getKms`; 0.6.3 skips the default and takes the
 * first). With askar the default, a persona's DIDComm v2 session asked the
 * wallet's store for an in-memory key and never reached its mediator (lab,
 * 2026-09-28). Everything that does not name an in-memory key — creating keys,
 * importing the wallet's own, deleting, random bytes — it declines, so it
 * falls through to the wallet's store as before. Signing is routed by key id
 * already (Credo asks each backend for the key), and finds it here.
 *
 * {@link dropInMemoryKeys} empties it; the app does so whenever it locks.
 *
 * A copy not held when an operation needs it — after a restart, before the
 * session that fetches it, or for an identity under a linked agent that is not
 * the current one — is fetched first through the fetcher the agent controller
 * sets ({@link EphemeralKeyManagementService.setMissingKeyFetcher}). Without
 * it, such an operation failed with "Key with key id 'vta-copy:…' not found in
 * backend 'ephemeral'" (TestFlight 239, an identity of another linked agent).
 *
 * @module trust-tasks/module/EphemeralKeyManagementService
 */
import { AskarKeyManagementService } from '@credo-ts/askar'
import { Kms, type Agent, type AgentContext } from '@credo-ts/core'
import { KdfMethod, Store, StoreKeyMethod, type Key, type Session } from '@openwallet-foundation/askar-shared'

import { EPHEMERAL_KMS_BACKEND, isInMemoryKeyId } from './vtaKeys'

export { EPHEMERAL_KMS_BACKEND }

/**
 * The parts of Credo's Askar KMS this backend redirects. They are private in
 * its types, so they are set on the instance: its every store access goes
 * through `withSession`, and `backend` names it in errors (credo-ts/askar
 * 0.6.3 `kms/AskarKeyManagementService`).
 */
type AskarKmsInternals = {
  backend: string
  withSession: <T>(agentContext: AgentContext, callback: (session: Session) => Promise<T>) => Promise<T>
  fetchAskarKey: (agentContext: AgentContext, keyId: string) => Promise<{ key: Key } | null>
}

export class EphemeralKeyManagementService implements Kms.KeyManagementService {
  public static readonly backend = EPHEMERAL_KMS_BACKEND
  public readonly backend = EPHEMERAL_KMS_BACKEND

  private readonly askar = new AskarKeyManagementService()
  /** The wallet's store, read for keys this backend does not hold. */
  private readonly wallet = new AskarKeyManagementService()
  private store?: Promise<Store>
  /** Fetches an in-memory copy this backend does not hold, set by the agent controller. */
  private fetchMissing?: (keyId: string) => Promise<void>
  /** Fetches under way, one per key, so concurrent uses wait on one fetch. */
  private readonly fetching = new Map<string, Promise<void>>()
  /** When a fetch last failed, so a key the agent will not give is not asked for on every use. */
  private readonly failedAt = new Map<string, number>()

  public constructor() {
    const inner = this.askar as unknown as AskarKmsInternals
    inner.backend = EPHEMERAL_KMS_BACKEND
    inner.withSession = (_agentContext, callback) => this.withSession(callback)
    // An operation claimed here can need a key that lives in the wallet's
    // store: DIDComm v2 authcrypt (ECDH-1PU) derives from the persona's key AND
    // a one-off key the envelope created with an unnamed createKey, which the
    // wallet's store took; Askar reads both from the backend doing the
    // encrypt. So a key not held here is read from the wallet's store — never
    // one of ours, which is either here or not loaded yet.
    const walletFetch = (this.wallet as unknown as AskarKmsInternals).fetchAskarKey.bind(this.wallet)
    const memoryFetch = inner.fetchAskarKey.bind(inner)
    inner.fetchAskarKey = async (agentContext, keyId) =>
      (this.store ? await memoryFetch(agentContext, keyId) : null) ??
      (isInMemoryKeyId(keyId) ? null : await walletFetch(agentContext, keyId))
  }

  public isOperationSupported(agentContext: AgentContext, operation: Kms.KmsOperation): boolean {
    switch (operation.operation) {
      case 'importKey':
        // Only a copy named for memory; the wallet's own imports go past.
        if (!isInMemoryKeyId(String((operation.privateJwk as { kid?: unknown }).kid ?? ''))) return false
        break
      case 'encrypt':
      case 'decrypt':
        // Credo routes these by backend order, not key id: claim only our keys.
        if (!isInMemoryKeyId(String((operation.keyAgreement as { keyId?: unknown } | undefined)?.keyId ?? ''))) return false
        break
      case 'sign':
      case 'verify':
        // Routed by key id: Credo asks for the key, and only ours are here.
        break
      default:
        // createKey, deleteKey, randomBytes: the wallet's.
        return false
    }
    return this.askar.isOperationSupported(agentContext, operation)
  }

  public async getPublicKey(agentContext: AgentContext, keyId: string) {
    // Only our own keys are found here — a wallet key is the wallet's to
    // answer. Credo routes a signature by asking each backend for the key, so
    // a copy not held yet is fetched here first. Not while that key's fetch is
    // itself running: the fetch asks whether the key is held, and must hear
    // "not yet" rather than wait on itself.
    if (!isInMemoryKeyId(keyId)) return null
    if (!this.fetching.has(keyId)) await this.ensureHeld(keyId)
    if (!this.store) return null
    return this.askar.getPublicKey(agentContext, keyId)
  }

  public importKey<Jwk extends Kms.KmsJwkPrivate>(agentContext: AgentContext, options: Kms.KmsImportKeyOptions<Jwk>) {
    return this.askar.importKey(agentContext, options)
  }

  public deleteKey(agentContext: AgentContext, options: Kms.KmsDeleteKeyOptions) {
    if (!this.store) return Promise.resolve(false)
    return this.askar.deleteKey(agentContext, options)
  }

  public createKey<Type extends Kms.KmsCreateKeyType>(agentContext: AgentContext, options: Kms.KmsCreateKeyOptions<Type>) {
    return this.askar.createKey(agentContext, options)
  }

  public async sign(agentContext: AgentContext, options: Kms.KmsSignOptions) {
    await this.ensureHeld(options.keyId)
    return this.askar.sign(agentContext, options)
  }

  public verify(agentContext: AgentContext, options: Kms.KmsVerifyOptions) {
    return this.askar.verify(agentContext, options)
  }

  public async encrypt(agentContext: AgentContext, options: Kms.KmsEncryptOptions) {
    await this.ensureHeld(keyAgreementKeyId(options))
    return this.askar.encrypt(agentContext, options)
  }

  public async decrypt(agentContext: AgentContext, options: Kms.KmsDecryptOptions) {
    await this.ensureHeld(keyAgreementKeyId(options))
    return this.askar.decrypt(agentContext, options)
  }

  public randomBytes(agentContext: AgentContext, options: Kms.KmsRandomBytesOptions) {
    return this.askar.randomBytes(agentContext, options)
  }

  /**
   * Run `use` with the raw Askar key held under `keyId`, for code that needs
   * the key itself rather than a KMS operation (the TSP adapter's key
   * agreement). Undefined when this backend does not hold it.
   */
  public async withKey<T>(keyId: string, use: (key: Key) => T | Promise<T>): Promise<T | undefined> {
    await this.ensureHeld(keyId)
    if (!this.store) return undefined
    return this.withSession(async (session) => {
      const entry = await session.fetchKey({ name: keyId })
      return entry ? use(entry.key) : undefined
    })
  }

  /**
   * How a copy this backend does not hold is fetched (the agent controller's,
   * through that identity's own agent). Undefined stops fetching.
   */
  public setMissingKeyFetcher(fetch: ((keyId: string) => Promise<void>) | undefined): void {
    this.fetchMissing = fetch
    this.failedAt.clear()
  }

  /**
   * Make sure an in-memory copy is held before it is used: fetch it if not,
   * once at a time per key. A failed fetch is not retried for
   * {@link FETCH_RETRY_MS}; the operation then fails as it would have.
   * Never throws.
   */
  private async ensureHeld(keyId: string | undefined): Promise<void> {
    if (!keyId || !isInMemoryKeyId(keyId) || !this.fetchMissing) return
    const running = this.fetching.get(keyId)
    if (running) return running
    if (await this.isHeld(keyId)) return
    // Another use may have started the fetch while this one looked.
    const started = this.fetching.get(keyId)
    if (started) return started
    const failed = this.failedAt.get(keyId)
    if (failed !== undefined && Date.now() - failed < FETCH_RETRY_MS) return
    const fetch = this.fetchMissing
    // Marked as fetching before the fetcher starts: it asks whether the key is
    // held as its first step, synchronously, and must find the mark there.
    const work = Promise.resolve()
      .then(() => fetch(keyId))
      .then(
        () => void this.failedAt.delete(keyId),
        () => void this.failedAt.set(keyId, Date.now())
      )
      .finally(() => this.fetching.delete(keyId))
    this.fetching.set(keyId, work)
    return work
  }

  /** Whether this backend holds `keyId` now, without fetching it. */
  public async isHeld(keyId: string): Promise<boolean> {
    if (!this.store) return false
    return this.withSession(async (session) => Boolean(await session.fetchKey({ name: keyId })))
  }

  /** Forget every key held. The next import starts a fresh store. */
  public async clear(): Promise<void> {
    const store = this.store
    this.store = undefined
    if (store) await (await store).close(true).catch(() => undefined)
  }

  private async withSession<T>(callback: (session: Session) => Promise<T>): Promise<T> {
    this.store ??= Store.provision({
      uri: 'sqlite://:memory:',
      keyMethod: new StoreKeyMethod(KdfMethod.None),
      recreate: true,
    })
    const session = await (await this.store).session().open()
    try {
      return await callback(session)
    } finally {
      await session.close()
    }
  }
}

/**
 * How long a key whose fetch failed is left before it is asked for again.
 * Shorter than the persona inbox's 30 s look, so its next look asks again.
 */
export const FETCH_RETRY_MS = 20_000

/**
 * The key an encrypt or decrypt names, in either Credo's shape: 0.7.1 (the
 * app's) passes `key: { keyId }` or `key: { keyAgreement: { keyId } }`, 0.6.3 a
 * top-level `keyAgreement: { keyId }`.
 */
function keyAgreementKeyId(options: unknown): string | undefined {
  type Named = { keyId?: unknown }
  const o = options as { key?: Named & { keyAgreement?: Named }; keyAgreement?: Named } | undefined
  const id = o?.key?.keyId ?? o?.key?.keyAgreement?.keyId ?? o?.keyAgreement?.keyId
  return typeof id === 'string' ? id : undefined
}

/** This agent's in-memory backend, when it has one. */
export function ephemeralKms(agent: Agent): EphemeralKeyManagementService | undefined {
  if (!agent.dependencyManager.isRegistered(Kms.KeyManagementModuleConfig)) return undefined
  const config = agent.dependencyManager.resolve(Kms.KeyManagementModuleConfig)
  return config.backends.find((b): b is EphemeralKeyManagementService => b instanceof EphemeralKeyManagementService)
}

/** Drop every persona key this phone holds in memory. Never throws. */
export async function dropInMemoryKeys(agent: Agent): Promise<void> {
  await ephemeralKms(agent)
    ?.clear()
    .catch(() => undefined)
}
