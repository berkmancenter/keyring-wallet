import { TOKENS, useServices } from '@bifold/core'
import { BrandingOverlay } from '@bifold/oca'
import { useEffect, useState } from 'react'

import { RCARD_TEMPLATE_ID } from './ocaBundles'

export interface TradingCardBranding {
  /** The card face. */
  primary: string
  /** The frame and the foil accents. */
  secondary: string
  /** What the card set is called, shown on the frame. */
  setName: string
}

/**
 * Fallback used until the bundle resolves, and if the running app's resolver
 * has no bundle for the R-Card template — a `RemoteOCABundleResolver` pointed
 * at someone else's tree, say. `DefaultOCABundleResolver` invents a bundle for
 * anything it does not know, so the card always draws.
 */
const DEFAULT_BRANDING: TradingCardBranding = {
  primary: '#2B1B4A',
  secondary: '#C9A227',
  setName: 'Trading Card',
}

/**
 * Read the trading card's palette out of the OCA bundle the profile ships.
 *
 * This is the point of R3 in situ: the branding is a plain object registered
 * on `TOKENS.UTIL_OCA_RESOLVER`, resolved from memory, with no `OCA_URL`, no
 * hosting and no network round trip to fail while someone is watching.
 */
export const useTradingCardBranding = (): TradingCardBranding => {
  const [bundleResolver] = useServices([TOKENS.UTIL_OCA_RESOLVER])
  const [branding, setBranding] = useState<TradingCardBranding>(DEFAULT_BRANDING)

  useEffect(() => {
    let cancelled = false

    const resolve = async () => {
      const bundle = await bundleResolver.resolve({ identifiers: { templateId: RCARD_TEMPLATE_ID } })
      if (cancelled || !bundle) {
        return
      }

      const overlay = bundle.brandingOverlay as BrandingOverlay | undefined
      setBranding({
        primary: overlay?.primaryBackgroundColor ?? DEFAULT_BRANDING.primary,
        secondary: overlay?.secondaryBackgroundColor ?? DEFAULT_BRANDING.secondary,
        setName: bundle.metaOverlay?.name ?? DEFAULT_BRANDING.setName,
      })
    }

    resolve()

    return () => {
      cancelled = true
    }
  }, [bundleResolver])

  return branding
}
