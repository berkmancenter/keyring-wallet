/**
 * An invitation this phone has taken before, scanned, pasted or tapped again.
 *
 * Credo refuses to receive an out-of-band invitation a second time ("An out of
 * band record with invitation … has already been received"), and that refusal
 * used to reach the person as the generic "Unable to handle deeplink" (1039) or
 * "Invalid QR code" (1031). It is not a fault: the person is usually already
 * connected through that very invitation. So it is said as what it is, and the
 * contact the first use made is opened, when there is one.
 */
import type { Agent, W3cCredentialRecord } from '@credo-ts/core'
import type { TFunction } from 'i18next'
import type { ToastShowParams } from 'react-native-toast-message'

import { ToastType } from '../components/toast/BaseToast'
import { getContactCredentialDetailsForConnection } from '../modules/vrc/utils/vrcNameHelper'
import { Screens, Stacks } from '../types/navigators'

/** Credo's refusal, which carries no type of its own: its text, with the invitation's id. */
const ALREADY_RECEIVED = /An out of band record with invitation (\S+) has already been received/

/** The id of the invitation Credo refused as already received, or undefined for any other error. */
export function usedInvitationId(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
  return message ? ALREADY_RECEIVED.exec(message)?.[1] : undefined
}

export interface UsedInvitation {
  invitationId: string
  /** The connection the first use of the invitation made (or reused), if it is still there. */
  connectionId?: string
  /** That contact's name, as Contacts shows it. */
  name?: string
  /** Where tapping through goes: the contact's page for a relationship, else its chat. */
  open?: { stack: Stacks.ContactStack; screen: Screens.ContactDetails | Screens.Chat; params: object }
}

interface DidcommApis {
  oob?: { findByReceivedInvitationId?: (id: string) => Promise<{ id: string; reuseConnectionId?: string } | null> }
  connections?: {
    findAllByOutOfBandId?: (id: string) => Promise<{ id: string; alias?: string; theirLabel?: string }[]>
    findById?: (id: string) => Promise<{ id: string; alias?: string; theirLabel?: string } | null>
  }
}

/**
 * Undefined when the error is not Credo's already-received refusal. Otherwise the
 * invitation, with the contact it made when one can be found; a lookup that fails
 * leaves the contact out rather than hiding the refusal.
 */
export async function findUsedInvitation(
  agent: Agent | undefined,
  error: unknown
): Promise<UsedInvitation | undefined> {
  const invitationId = usedInvitationId(error)
  if (!invitationId) return undefined
  const didcomm = (agent as unknown as { modules?: { didcomm?: DidcommApis } } | undefined)?.modules?.didcomm
  try {
    const oob = await didcomm?.oob?.findByReceivedInvitationId?.(invitationId)
    if (!oob) return { invitationId }
    const connection = oob.reuseConnectionId
      ? await didcomm?.connections?.findById?.(oob.reuseConnectionId)
      : (await didcomm?.connections?.findAllByOutOfBandId?.(oob.id))?.[0]
    if (!connection) return { invitationId }

    const w3c = await (
      agent as unknown as { w3cCredentials?: { getAll(): Promise<W3cCredentialRecord[]> } }
    ).w3cCredentials
      ?.getAll()
      .catch(() => [])
    const contact = agent ? await getContactCredentialDetailsForConnection(agent, connection.id, w3c ?? []) : null
    if (contact) {
      return {
        invitationId,
        connectionId: connection.id,
        name: contact.issuer.name,
        open: { stack: Stacks.ContactStack, screen: Screens.ContactDetails, params: { contact } },
      }
    }
    return {
      invitationId,
      connectionId: connection.id,
      name: connection.alias || connection.theirLabel,
      open: { stack: Stacks.ContactStack, screen: Screens.Chat, params: { connectionId: connection.id } },
    }
  } catch {
    return { invitationId }
  }
}

/** Opens the contact a used invitation made, through the main stack so it comes to the top. */
export function openUsedInvitation(
  used: UsedInvitation,
  navigation: { navigate: (name: string, params?: object) => void } | undefined
): boolean {
  if (!used.open || !navigation) return false
  navigation.navigate(used.open.stack, { screen: used.open.screen, params: used.open.params })
  return true
}

/** What the person is told: the contact it opened, or that a new invitation is needed. */
export function usedInvitationToast(used: UsedInvitation, t: TFunction, bottomOffset?: number): ToastShowParams {
  const opened = !!used.open
  return {
    type: opened ? ToastType.Info : ToastType.Warn,
    text1: t('Scan.InvitationAlreadyUsed'),
    text2: opened
      ? t('Scan.InvitationAlreadyUsedConnected', { name: used.name || t('ContactDetails.UnnamedContact') })
      : t('Scan.InvitationAlreadyUsedAskNew'),
    position: 'bottom',
    bottomOffset,
  }
}
