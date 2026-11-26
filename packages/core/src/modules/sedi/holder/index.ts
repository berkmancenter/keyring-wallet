/**
 * The state card (SEDI/KERI holder card): the person holding a state Guardian card sees it in Credentials, behind the
 * Developer switch "State card (demo)" (./stateCardFlag), off by default, with STATE_CARD_REMOTE_OFF and
 * SEDI_KERI_REMOTE_OFF.
 *
 * Everything it needs is in this folder. It reaches the app at one place, ListCredentials, which loads this module
 * lazily; the switch is exported from the package index for the app's Developer settings.
 *
 * @module sedi/holder
 */
export { STATE_CARD_REMOTE_OFF, isStateCardEnabled, setStateCardEnabled } from './stateCardFlag'
export { StateCardPass } from './StateCardPass'
export { useHeldStateCard } from './useHeldStateCard'
export type { StateCardView } from './stateCard'
