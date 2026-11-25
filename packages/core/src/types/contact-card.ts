import { ContactCredentialDetails } from './navigators'

/**
 * Props for the component that draws one contact in the contacts list.
 *
 * A contact here *is* an exchanged R-Card: the name, organisation and photo
 * are read out of the RelationshipCard credential the counterparty issued (see
 * `modules/vrc/utils/rcardDisplayUtils.ts`), and the two badge flags say what
 * the accompanying relationship credential proved.
 *
 * The component is injected via `TOKENS.COMPONENT_CONTACT_CARD`, so an app —
 * or a demo profile — can render that R-Card however it likes (a row, a
 * trading card) without forking the contacts screen.
 */
export interface ContactCardProps {
  contact: ContactCredentialDetails
  /** The contact's hardware attestation was checked and verified cryptographically. */
  hardwareVerified: boolean
  /**
   * The contact's credentials carry hardware evidence that is still being checked:
   * a renderer may hold the badge's place, so it fills in rather than popping in.
   * Optional; a renderer that ignores it shows the badge once verified, as before.
   */
  hardwareChecking?: boolean
  onPress: () => void
  /** Test id for the pressable card; the default renderer falls back to `ContactCard`. */
  testID?: string
}
