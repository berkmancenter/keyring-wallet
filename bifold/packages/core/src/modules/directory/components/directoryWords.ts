/**
 * The directory screens' words for what the hooks report: why there is nothing to show, who sees a value, and what
 * a failed save means. Each takes the community's name as the screens show it.
 *
 * @module directory/components/directoryWords
 */
import type { TFunction } from 'i18next'

import { DirectoryConflict, DirectoryRefused, type DirectoryAudience, type OperationStatus } from '../types'

/** Why a directory screen shows no list or card: one plain line, by the status's reason. */
export function directoryStatusText(t: TFunction, status: OperationStatus, community: string): string {
  const key =
    status.reason === 'communityDoesNotServe'
      ? 'Directory.StatusNotServed'
      : status.reason === 'noRight'
        ? 'Directory.StatusNoRight'
        : 'Directory.StatusUnreachable'
  return t(key, { community, interpolation: { escapeValue: false } }) as string
}

/** Whether "Try again" can help: only when the community didn't answer. */
export const directoryRetryable = (status: OperationStatus): boolean => status.reason === 'communityUnreachable'

/** Who sees a value, in the existing disclosure words ("all members of Keyring Lab"). */
export function audienceText(t: TFunction, audience: DirectoryAudience, community: string): string {
  return t(`Directory.Audience.${audience}`, { community, interpolation: { escapeValue: false } }) as string
}

/**
 * What a failed save says, and whether the card must be read again first. A conflict means the card changed
 * elsewhere (the portal, another phone): nothing was written, and the screen reads it again before asking again.
 */
export function saveFailureText(
  t: TFunction,
  error: unknown,
  community: string
): { text: string; reread: boolean; retryable: boolean } {
  const opts = { community, interpolation: { escapeValue: false } }
  if (error instanceof DirectoryConflict)
    return { text: t('Directory.CardConflict', opts) as string, reread: true, retryable: true }
  if (error instanceof DirectoryRefused && !error.retryable)
    return { text: t('Directory.CardRefused', opts) as string, reread: false, retryable: false }
  return { text: t('Directory.CardNotSaved', opts) as string, reread: false, retryable: true }
}

const ROLE_KEY: Record<string, string> = {
  admin: 'Community.RoleAdmin',
  member: 'Community.RoleMember',
  vetter: 'Community.RoleVetter',
}

/** A member's role: Keyring's word for the roles it knows, else the community's own word. */
export function memberRoleText(t: TFunction, role: string | undefined): string | undefined {
  if (!role) return undefined
  const key = ROLE_KEY[role.toLowerCase()]
  return key ? (t(key) as string) : role
}
