import { ContactCredentialDetails } from './navigators'

/**
 * Props for extra per-contact content injected at the bottom of the contact
 * details screen. `connectionId` is the DIDComm connection on file for this
 * contact, or `null` when the screen hasn't resolved one — an implementation
 * that requires an established relationship on that connection should render
 * nothing in that case rather than assume one exists.
 *
 * Injected via `TOKENS.COMPONENT_CONTACT_DETAILS_FOOTER`; the default is a
 * no-op, mirroring `TOKENS.COMPONENT_CRED_LIST_FOOTER`.
 */
export interface ContactDetailsFooterProps {
  contact: ContactCredentialDetails
  connectionId: string | null
}
