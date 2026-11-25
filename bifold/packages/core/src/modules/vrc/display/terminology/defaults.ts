/**
 * Default terminology for standard credentials
 *
 * This provides the baseline "credential" terminology that is used
 * when no custom handler provides its own terminology.
 */

import { CredentialTerminology } from '../types'

/**
 * Default terminology using "credential" language
 * All values are translation keys
 */
export const defaultCredentialTerminology: CredentialTerminology = {
  // Nouns
  singular: 'Credentials.Credential',
  plural: 'Credentials.Credentials',

  // Screen titles
  offerScreenTitle: 'Screens.CredentialOffer',
  detailScreenTitle: 'Screens.CredentialDetails',

  // Offer flow
  isOfferingYou: 'CredentialOffer.IsOfferingYouACredential',
  declineTitle: 'CredentialOffer.DeclineTitle',
  confirmDecline: 'CredentialOffer.ConfirmDecline',
  addedToWallet: 'CredentialOffer.CredentialAddedToYourWallet',
  onTheWay: 'CredentialOffer.CredentialOnTheWay',

  // Detail/remove flow
  issuedByLabel: 'CredentialDetails.IssuedBy',
  removeTitle: 'CredentialDetails.RemoveTitle',
  removeButtonLabel: 'CredentialDetails.RemoveFromWallet',
  removeCaption: 'CredentialDetails.RemoveCaption',
  removedConfirmation: 'CredentialDetails.CredentialRemoved',

  // Empty state
  emptyListMessage: 'Credentials.EmptyList',
  addItemButton: 'Home.AddCredentials',

  // Tour steps
  tourAddTitle: 'Tour.AddCredentials',
  tourAddDescription: 'Tour.AddCredentialsDescription',

  // Chat message text
  chatOfferTitle: 'Chat.CredentialOfferTitle',
  chatReceivedTitle: 'Chat.CredentialReceivedTitle',
}

/**
 * Contact terminology for RelationshipCredentials
 * All values are translation keys
 */
export const contactTerminology: CredentialTerminology = {
  // Nouns
  singular: 'Contacts.Contact',
  plural: 'Contacts.Contacts',

  // Screen titles
  offerScreenTitle: 'Contacts.OfferScreenTitle',
  detailScreenTitle: 'Contacts.DetailScreenTitle',

  // Offer flow
  isOfferingYou: 'Contacts.IsOfferingYouAContact',
  declineTitle: 'Contacts.DeclineTitle',
  confirmDecline: 'Contacts.ConfirmDecline',
  addedToWallet: 'Contacts.ContactAddedToYourWallet',
  onTheWay: 'Contacts.ContactOnTheWay',

  // Detail/remove flow
  issuedByLabel: 'Contacts.ConnectedWith',
  removeTitle: 'Contacts.RemoveTitle',
  removeButtonLabel: 'Contacts.RemoveFromWallet',
  removeCaption: 'Contacts.RemoveCaption',
  removedConfirmation: 'Contacts.ContactRemoved',

  // Empty state
  emptyListMessage: 'Contacts.YouDoNotHaveAnyContacts',
  addItemButton: 'Contacts.InviteContact',

  // Tour steps
  tourAddTitle: 'Contacts.TourAddTitle',
  tourAddDescription: 'Contacts.TourAddDescription',

  // Chat message text
  chatOfferTitle: 'Chat.ContactOfferTitle',
  chatReceivedTitle: 'Chat.ContactReceivedTitle',
}
