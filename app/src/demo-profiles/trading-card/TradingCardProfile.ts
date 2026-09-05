import { TOKENS } from '@bifold/core'
import { BrandingOverlayType, DefaultOCABundleResolver } from '@bifold/oca/build/legacy'
import { DependencyContainer } from 'tsyringe'

import { DemoProfile } from '../types'

import { tradingCardOCABundles } from './ocaBundles'
import TradingCard from './TradingCard'

/**
 * Trading cards, as a demo profile.
 *
 * The exchange underneath is Keyring's, unchanged: two people scan each
 * other, the VRC protocol runs, and each ends up holding the other's R-Card —
 * with the photo, name and organisation that R-Card carries, and whatever the
 * exchange proved (hardware attestation, a witness). This profile changes one
 * thing: how that R-Card is drawn.
 *
 * Both registrations are additive. Nothing shared is edited, no build flag is
 * set, and no `.env` value is needed — the branding travels inside the app.
 */
export const tradingCardProfile: DemoProfile = {
  id: 'trading-card',
  title: 'Trading cards',
  description: 'Exchanged R-Cards become collectable cards, photo and all.',

  register(container: DependencyContainer): void {
    // 1. How an exchanged R-Card is drawn. The contacts list resolves this
    //    token per contact, so replacing it replaces the card — the screen
    //    itself is untouched.
    container.registerInstance(TOKENS.COMPONENT_CONTACT_CARD, TradingCard)

    // 2. The card's colours and set name, shipped as an OCA bundle inside the
    //    app. DefaultOCABundleResolver resolves from memory, so there is no
    //    OCA hosting to stand up and no network call to fail mid-demo.
    container.registerInstance(
      TOKENS.UTIL_OCA_RESOLVER,
      new DefaultOCABundleResolver(tradingCardOCABundles, { brandingOverlayType: BrandingOverlayType.Branding10 })
    )
  },
}

export default tradingCardProfile
