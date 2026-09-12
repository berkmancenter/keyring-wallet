import { IBrandingOverlayData, IMetaOverlayData, IOverlayBundleData } from '@bifold/oca'

/**
 * The template id every R-Card is built from (`RCardTemplate`'s
 * `DEFAULT_TEMPLATE_ID` in `bifold/packages/core/src/modules/vrc/types/rcard.ts`).
 *
 * `DefaultOCABundleResolver.resolve` looks a bundle up by credential
 * definition id, then schema id, then *template id* — and an R-Card has no
 * AnonCreds identifiers at all, so the template id is the key that reaches it.
 */
export const RCARD_TEMPLATE_ID = 'rcard-basic-1'

/** What the card set is called, and who it says issued it. */
const meta: IMetaOverlayData = {
  type: 'spec/overlays/meta/1.0',
  capture_base: '',
  language: 'en',
  name: 'Collector Card',
  description: 'A card someone handed you in person',
  issuer: 'Keyring Trading Cards',
  issuer_description: '',
  issuer_url: '',
  credential_help_text: '',
  credential_support_url: '',
}

/** The card face and its frame. Change these two and the card changes. */
const branding: IBrandingOverlayData = {
  type: 'aries/overlays/branding/1.0',
  capture_base: '',
  primary_background_color: '#2B1B4A',
  secondary_background_color: '#C9A227',
}

/**
 * Branding for the trading card, shipped inside the app.
 *
 * There is no OCA hosting here and no `OCA_URL`: `DefaultOCABundleResolver`
 * takes bundles as plain objects and resolves them from memory. That is the
 * whole "skin your credential" hook, with nothing to deploy.
 *
 * The capture base is empty on purpose. Overlays describe *attributes*, and an
 * R-Card's payload is a jCard rather than a flat attribute set, so only the
 * meta and branding overlays carry anything a trading card can use.
 */
export const tradingCardOCABundles: Record<string, IOverlayBundleData> = {
  [RCARD_TEMPLATE_ID]: {
    capture_base: {
      type: 'spec/capture_base/1.0',
      classification: '',
      attributes: {},
      flagged_attributes: [],
    },
    overlays: [meta, branding],
  },
}
