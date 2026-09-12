import { TOKENS, registerTrustTaskDisplay, trustTaskDisplayRegistry } from '@bifold/core'
import { DependencyContainer } from 'tsyringe'

import { DemoProfile } from '../types'

import ApproverContactSection from './ApproverContactSection'
import ApproverGlobalListener from './ApproverGlobalListener'
import { registerApproverTaskType } from './ceremony'
import { accessRequestDisplayHandler } from './display'

/**
 * The Approver, as a demo profile.
 *
 * R5's registry proven end to end on a genuinely new Trust Task type: one
 * wallet asks a connected contact for access to something concrete, the
 * other wallet renders the request and answers, and the signed decision
 * travels back over the same connection — riding an EXISTING VRC
 * relationship rather than a new identity mechanism. See the companion doc
 * (docs/plans/reference-app-sdk-packaging/2026-09-06-agent.md) for why this
 * scenario and this Type URI.
 *
 * UI placement: the demo's trigger + inbox render per-contact, on that
 * contact's Contact Details screen, via
 * `TOKENS.COMPONENT_CONTACT_DETAILS_FOOTER` — a natural home now that the
 * ceremony itself is scoped to one contact's established VRC relationship.
 * This replaced an earlier placement on `TOKENS.COMPONENT_CRED_LIST_FOOTER`
 * (the Wallet tab's credential-list footer): that surface showed whichever
 * single request was pending across ALL contacts at once, with no way to
 * tell which contact it was from without opening the card, and no home for
 * a per-contact "waiting"/cancel state. `COMPONENT_CONTACT_DETAILS_FOOTER`
 * didn't exist yet — it was added to `@bifold/core` alongside this change,
 * mirroring `COMPONENT_CRED_LIST_FOOTER`'s own no-op-default pattern.
 *
 * `COMPONENT_CONTACT_DETAILS_FOOTER` doesn't collide with
 * `COMPONENT_CONTACT_CARD` (the trading-card profile's own token, per "the
 * last registered wins" — demo-profiles/README.md): the card token draws one
 * row in the CONTACTS LIST, this one draws extra content on a single
 * contact's DETAILS screen. Both profiles remain always installed together
 * (see `demo-profiles/index.ts`) without fighting over a token.
 *
 * `COMPONENT_HOME_HEADER` was tried first, for the original Wallet-tab-footer
 * placement, and reverted: it renders on `screens/Home.tsx` via `HomeStack`,
 * but this fork's actual tab navigation (`TabStack.tsx`,
 * `initialRouteName={TabStacks.ContactStack}`) never routes to that stack at
 * all — `Home.tsx` is unreachable dead code in this build, not a bug in this
 * profile. The very first e2e run against it (see the companion doc) hung
 * waiting for a button that could never appear, which is exactly how "read
 * the code, don't assume" earned its place in this plan's own running list of
 * overestimates (2026-09-04-bm.md). Because `Home.tsx` stays unreachable, a
 * person elsewhere in the app has no organic way to learn an access request
 * arrived once the trigger+inbox moved off the always-visible Wallet tab —
 * `ApproverGlobalListener`, registered on the new
 * `TOKENS.COMPONENT_APP_GLOBAL_LISTENER` seam, covers that with a toast
 * instead (see its own comment).
 *
 * When BOTH profiles are installed and a build needs to demo just one of
 * them, the `ACTIVE_DEMO_PROFILE` env var (wired in `demo-profiles/index.ts`
 * / `App.tsx`) selects a single active profile rather than registering all
 * of them — this is the "at least a minimal way to choose which is active"
 * requirement D asked for.
 */
export const approverProfile: DemoProfile = {
  id: 'approver',
  title: 'The Approver',
  description: 'Ask a contact for access to something; they approve or deny, signed.',

  register(container: DependencyContainer): void {
    // 1. The UI-side display registry (mirrors ICredentialDisplayRegistry) —
    //    registered here because this profile is the first (and, in this
    //    build, only) consumer of it. A second Approver-shaped profile would
    //    find it already registered and just add its own handler.
    registerTrustTaskDisplay(container)
    trustTaskDisplayRegistry.register(accessRequestDisplayHandler)

    // 2. The engine-side registration (R5): registerTrustTask({ spec,
    //    orchestration, renderer }) — here split into registerApproverTaskType
    //    (engine) and the display registration above, called together at
    //    profile-registration time. See ceremony.ts for why they aren't one
    //    call: the renderer registration happens via the generic
    //    ITrustTaskDisplayRegistry token above rather than being passed
    //    through registerTrustTask's own `renderer` option, since this demo
    //    also needs registerTrustTaskDisplay's one-time container wiring.
    registerApproverTaskType()

    // 3. The demo's own trigger ("Request access") + inbox (render + approve/
    //    deny), embedded in this contact's own details screen rather than a
    //    new screen — see ApproverContactSection's own comment.
    container.registerInstance(TOKENS.COMPONENT_CONTACT_DETAILS_FOOTER, ApproverContactSection)

    // 4. The app-wide toast so a person not currently viewing this contact
    //    still learns a request arrived — see ApproverGlobalListener's own
    //    comment.
    container.registerInstance(TOKENS.COMPONENT_APP_GLOBAL_LISTENER, ApproverGlobalListener)
  },
}

export default approverProfile
