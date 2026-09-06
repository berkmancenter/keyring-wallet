import { TOKENS, registerTrustTaskDisplay, trustTaskDisplayRegistry } from '@bifold/core'
import { DependencyContainer } from 'tsyringe'

import { DemoProfile } from '../types'

import ApproverHomeBanner from './ApproverHomeBanner'
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
 * DI-token note: this profile deliberately does NOT touch
 * `COMPONENT_CONTACT_CARD` — the trading-card profile already owns that
 * token, and "the last registered wins" (demo-profiles/README.md) means two
 * profiles wanting the same token silently collide. Both profiles are
 * always installed together (see `demo-profiles/index.ts`); this profile
 * surfaces its own trigger + inbox on `COMPONENT_CRED_LIST_FOOTER` instead —
 * the footer of the Wallet tab's credential list — which neither the
 * starter nor the trading-card profile registers.
 *
 * `COMPONENT_HOME_HEADER` was tried first and reverted: it renders on
 * `screens/Home.tsx` via `HomeStack`, but this fork's actual tab navigation
 * (`TabStack.tsx`, `initialRouteName={TabStacks.ContactStack}`) never routes
 * to that stack at all — `Home.tsx` is unreachable dead code in this build,
 * not a bug in this profile. The very first e2e run against it (see the
 * companion doc) hung waiting for a button that could never appear, which is
 * exactly how "read the code, don't assume" earned its place in this plan's
 * own running list of overestimates (2026-09-04-bm.md). `ListCredentials.tsx`
 * (the "Wallet" tab, reachable and always rendered) resolves
 * `COMPONENT_CRED_LIST_FOOTER` as a `FlatList` `ListFooterComponent` — real
 * navigation, confirmed by re-running the e2e to a pass (see the companion
 * doc) rather than assumed from reading the navigator files a second time.
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
    //    deny), embedded in the Wallet tab's credential-list footer rather
    //    than a new screen — see ApproverHomeBanner's own comment.
    container.registerInstance(TOKENS.COMPONENT_CRED_LIST_FOOTER, ApproverHomeBanner)
  },
}

export default approverProfile
