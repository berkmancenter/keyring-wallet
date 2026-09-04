import { join } from 'path'

/**
 * Everything the mediator needs to boot, resolved from the environment.
 *
 * `publicUrl` is the address a *wallet on a phone* uses to reach this
 * process — not the address the process listens on. Those are different
 * whenever a tunnel is in front (which is the normal case: the app blocks
 * cleartext http, so a local mediator needs an https front door, exactly as
 * the witness does — see `e2e/lib/witness.js`'s `startTunnel`).
 */
export interface MediatorConfig {
  /** Port this process binds locally. */
  port: number
  /** The https endpoint baked into the invitation and the mediator's DID document. */
  publicUrl: string
  /** Shown to the wallet as the mediator's name. */
  label: string
  /** Askar store id; also names the sqlite file. */
  walletId: string
  walletKey: string
  /** Directory holding the askar sqlite file. */
  storagePath: string
  /** If set, the invitation URL is written here on boot for a harness to read. */
  invitationPath?: string
  verbose: boolean
}

export const DEFAULT_PORT = 3010
export const DEFAULT_LABEL = 'Keyring Local Mediator'
export const DEFAULT_WALLET_ID = 'keyring-local-mediator'

const packageRoot = join(__dirname, '..')

/**
 * Resolve config from an environment map. Pure — takes the environment rather
 * than reading `process.env` — so the failure modes below are unit-testable
 * and fail at boot with a message that names the fix, instead of surfacing
 * later as an unroutable invitation.
 */
export function resolveConfig(env: NodeJS.ProcessEnv): MediatorConfig {
  const publicUrl = (env.MEDIATOR_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
  if (!publicUrl) {
    throw new Error(
      'MEDIATOR_PUBLIC_URL is required: the https address a phone uses to reach this mediator. ' +
        'Use `yarn mediator` at the repo root, which starts a tunnel and sets it for you.'
    )
  }
  if (!/^https?:\/\//.test(publicUrl)) {
    throw new Error(`MEDIATOR_PUBLIC_URL must start with http:// or https://, got "${publicUrl}"`)
  }

  const port = env.MEDIATOR_PORT ? Number(env.MEDIATOR_PORT) : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MEDIATOR_PORT must be an integer between 1 and 65535, got "${env.MEDIATOR_PORT}"`)
  }

  const walletId = env.MEDIATOR_WALLET_ID?.trim() || DEFAULT_WALLET_ID

  return {
    port,
    publicUrl,
    label: env.MEDIATOR_LABEL?.trim() || DEFAULT_LABEL,
    walletId,
    walletKey: env.MEDIATOR_WALLET_KEY?.trim() || `${walletId}-key`,
    storagePath: env.MEDIATOR_WALLET_PATH?.trim() || join(packageRoot, '.wallet'),
    invitationPath: env.MEDIATOR_INVITATION_PATH?.trim() || undefined,
    verbose: env.MEDIATOR_VERBOSE === 'true',
  }
}

/** Absolute path of the askar sqlite file for a resolved config. */
export function walletFilePath(config: MediatorConfig): string {
  return join(config.storagePath, `${config.walletId}.db`)
}
