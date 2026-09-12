import { IOverlayBundleData } from '@bifold/oca'

/**
 * OCA bundles shipped inside the app — R3, and it needs no new resolver.
 *
 * The walkthrough in the packaging plan assumed skinning a credential meant
 * standing up OCA hosting: fork `bcgov/aries-oca-bundles`, or publish your own
 * raw-JSON tree on GitHub, and point `OCA_URL` at it. That is what
 * `RemoteOCABundleResolver` does and it is the right thing in production. For
 * a demo it is a public URL that has to stay up, and a network round trip that
 * can fail while a funder is watching.
 *
 * `DefaultOCABundleResolver` — which `RemoteOCABundleResolver` already extends
 * — takes bundles as plain objects keyed by credential definition id, schema
 * id, or template id, and resolves them with no network at all. So "ship the
 * branding with the app" was already supported; nothing had to be built for
 * it.
 *
 * To skin a credential: add an entry keyed by its identifier. Anything absent
 * still renders — the resolver generates a default bundle, deriving a
 * background colour from the credential name — so a partial set is fine.
 */
export const demoOCABundles: Record<string, IOverlayBundleData> = {
  // Worked example. Replace the key with your credential definition id (or
  // schema id) and the overlays with your own branding.
  //
  // 'YourDid:3:CL:1234:your-credential': {
  //   capture_base: {
  //     type: 'spec/capture_base/1.0',
  //     classification: '',
  //     attributes: { given_names: 'Text', family_name: 'Text' },
  //     flagged_attributes: [],
  //   },
  //   overlays: [
  //     {
  //       type: 'spec/overlays/meta/1.0',
  //       capture_base: '',
  //       language: 'en',
  //       name: 'Your Credential',
  //       issuer: 'Your Organisation',
  //       description: 'What this credential says about its holder',
  //     },
  //     {
  //       type: 'aries/overlays/branding/1.0',
  //       capture_base: '',
  //       primary_background_color: '#2E4A62',
  //       secondary_background_color: '#1B2B3A',
  //     },
  //   ],
  // },
}
