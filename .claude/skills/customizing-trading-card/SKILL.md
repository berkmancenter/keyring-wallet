---
name: customizing-trading-card
description: Use when someone wants the trading-card demo to look or behave differently — new colours, set name, card layout, shape/roundness ("make it round", "more circular", "pill-shaped"), what's printed on the card, rarity/grading rules, per-contact foil variation, or "make the cards look like X". Maps plain-language asks onto the actual style props and elements that own them, and names what must not change (e2e testIDs, the VRC exchange underneath).
---

# Customizing the trading-card demo

`app/src/demo-profiles/trading-card/` is a **render-layer** demo: two people run
Keyring's ordinary VRC exchange and each ends up holding the other's R-Card;
this profile only decides how that R-Card is drawn. Read
`app/src/demo-profiles/README.md` once before the first change.

## Map the ask to the file that owns it

| What they asked for | Change this |
| --- | --- |
| Colours, set name, issuer line | `ocaBundles.ts` — the `meta` and `branding` overlays |
| Layout, typography, what's printed on the card | `TradingCard.tsx` |
| Grading rules ("witnessed should be ULTRA RARE") | `rarityFor` in `TradingCard.tsx` |
| Per-contact colour variation — tune it or turn it off | `didColorVariant.ts`, or drop the `cardVariantForDid` call in `TradingCard.tsx` |
| Which tokens the profile takes over | `TradingCardProfile.ts` |
| A different use case entirely, not a reskin | Don't edit this profile. Copy `starter/StarterContainer.ts` into a new directory and add it to `installedDemoProfiles` in `demo-profiles/index.ts`. |

## Translating shape/roundness asks

"Round", "circular", "pill-shaped", "softer corners" all mean a `borderRadius`
change in `TradingCard.tsx`, but which element depends on which noun they
used — the file has three independent radii, not one:

| What they said | Style to change |
| --- | --- |
| "the photo/portrait" | `portrait.borderRadius` |
| "the name plate/name tag/pill under the photo" | `namePlate.borderRadius` |
| "the card", "the whole thing", "the background", "the frame" | `card.borderRadius` |
| "round the corners a bit" / "softer" | a modest bump (tens, not the `PILL` constant) on whichever of the above they meant |
| "as round/circular as possible", "almost perfectly round" | the `PILL` constant (see below) on whichever of the above they meant |

`PILL` (currently `999`, defined once near the top of the file) is a value
larger than half of any box it's applied to, so RN clamps it down to the
largest radius that box supports: a true circle on a square box (the
portrait), a true pill on a short wide box (the name plate). Reuse the
existing constant rather than inventing another magic number.

Pushing `card.borderRadius` to `PILL` is the case worth pausing on: the card
is a vertical stack (setName → portrait → namePlate → rarity), so it's
*taller than it is wide*. RN clamps the radius to half of the **shorter**
side (the width), and on a box like that, both top-left+top-right corners
and both bottom corners each hit that same radius — which means they meet
in the middle and the top/bottom edges become full semicircular caps (a
*stadium* shape), not just rounded corners. A semicircular cap only reaches
the box's full width at its equator; near the very top or bottom, anything
flush against the edge and spanning close to the full width gets clipped by
the curve. `setName` and `rarity` are exactly that — the two full-width
lines nearest the caps — so making the card `PILL`-round also requires
centering both (`textAlign: 'center'`) and giving the card more padding, or
they lose their outer edges. This is why the card's own padding is uneven
from the portrait/name-plate treatment; don't "simplify" it back down
without re-checking for clipping.

## The things that trip people up

1. **Authored colours are not the rendered colours.** `cardVariantForDid`
   hue-rotates `primary` and `secondary` by a hash of the contact's DID, so
   "make the card green" produces green *for one contact* and every other hue
   for the rest. If they want one fixed palette, remove the rotation; if they
   want variation within a range, clamp `hueRotationForDid`.
2. **A colour change lands in three places.** `ocaBundles.ts` (what the
   resolver serves), `DEFAULT_BRANDING` in `useTradingCardBranding.ts` (the
   fallback before the bundle resolves, and in apps whose resolver doesn't
   know the R-Card template), and the literal `#2B1B4A` asserted in
   `app/__tests__/demo-profiles/TradingCardProfile.test.tsx`. Update all three
   or the card flashes the old palette.
3. **The testIDs are load-bearing.** `TradingCard`, `TradingCardRarity` and
   `ContactAvatarImage` are asserted by `e2e/run-vrc-exchange-trading-card.js`
   and, as negatives, by `e2e/run-plain-build-smoke.js`. Restyle freely;
   renaming or removing these breaks e2e.
4. **Only R-Card data is on hand.** `ContactCardProps` gives
   `contact.issuer.{id,name,email,organization,photo}`,
   `hasWitnessCredentials`, `hasHardwareAttestation`, `hasLocalityConfirmed`
   (available, currently unused by the card — a free grading axis), and the
   verified `hardwareVerified` prop. Anything else means changing the
   exchange, which is out of scope for this demo — say so rather than reaching
   into `bifold/packages/core/src/modules/vrc/`.
5. **"Nothing changed" can mean the profile isn't active, not that the edit
   was wrong — but check what "unset" actually does before assuming this.**
   `selectDemoProfiles` (`demo-profiles/index.ts`) registers *every*
   installed profile, trading-card included, when `ACTIVE_DEMO_PROFILE` is
   unset — that's the default and it does claim `COMPONENT_CONTACT_CARD`, so
   an unset var is fine. What actually leaves the app drawing bifold's stock
   `ContactCard` instead of this file: `ACTIVE_DEMO_PROFILE=none`;
   `ACTIVE_DEMO_PROFILE=approver` (narrows to *only* approver, which
   deliberately doesn't claim `COMPONENT_CONTACT_CARD`, so nothing overrides
   the default); or any value that was changed in `.env` without a native
   rebuild afterward, since it's baked in at build time (see "Seeing it on
   screen" below). Check the actual value and build history before
   re-deriving the styling logic — don't assume unset is the problem.

Attribute overlays are also a dead end: `capture_base.attributes` is empty on
purpose because an R-Card's payload is a jCard, so only the meta and branding
overlays reach the card.

## Verify

```sh
cd app
yarn test __tests__/demo-profiles/          # TradingCardProfile + didColorVariant
yarn lint && yarn typecheck                 # both run from app/
```

Use `yarn test` rather than a bare `yarn jest` — only the script passes
`--config ./jest.config.js`.

## Seeing it on screen without an exchange

There is no lightweight preview for this component today — no Storybook, no
Ladle, no react-native-web, no snapshot image. (`app/indexStorybook.js`
references a `./storybook` directory that doesn't exist — dead scaffolding
inherited from upstream Bifold; don't go looking for it.) The only way to see
a card is the real app, on a real device or emulator. One device is enough —
no second phone, no exchange partner needed.

The good news for someone who isn't a mobile developer: this is **one-time
setup, then a fast loop.** Most of the setup can be driven for them; a couple
of steps genuinely can't.

**Do this part for them** (an agent with shell access should just run it,
rather than describing it):

1. Start a mediator: `yarn mediator` at the repo root, left running in the
   background. It writes a working `MEDIATOR_URL` into `app/.env`
   automatically. Physical phone → no flags needed, it opens a cloudflared
   tunnel (takes a few seconds longer). Android emulator →
   `yarn mediator --endpoint http://10.0.2.2:3010`. iOS simulator →
   `--endpoint http://localhost:3010`. Don't guess which target based on what
   was used last time — check `adb devices` / simulator state first, since a
   physical phone given an emulator-only endpoint (`10.0.2.2`) will never
   connect and fail silently.
2. Set `ACTIVE_DEMO_PROFILE=trading-card` in `app/.env` (unset also works —
   see gotcha 5 — but setting it explicitly removes any doubt).
3. Build and install once: `cd app && yarn ios:setup && yarn ios` or
   `yarn android`. **This step is baked at build time** — if `.env` changes
   after this, it needs another install, not just a reload. Run `yarn start`
   too if Metro doesn't come up on its own.
4. On a physical Android device specifically, port 8081 (Metro) needs
   `adb reverse tcp:8081 tcp:8081` for the app to reach the dev server over
   USB — do this before the first launch, or the app will sit on a native
   splash screen waiting for a bundle that can't arrive. If it's already
   showing that splash, force-stop and relaunch the app
   (`adb shell am force-stop <applicationId>` then relaunch) after adding the
   reverse tunnel, rather than waiting.

**This part is theirs, not yours** — don't try to do it for them, even with
device/shell access:

5. **Onboarding and the wallet PIN.** A fresh install lands on Keyring's
   onboarding flow; an existing install lands on a PIN-unlock screen. Both
   involve the person's own choices (their PIN, biometric prompts, terms
   screens) — hand it back with "unlock/finish setup on your device, then
   tell me when you're at Home or Contacts" rather than attempting PINs or
   tapping through it yourself.
6. Once past that: Settings → tap the version footer 11 times to unlock
   Developer → **Seed test contacts**. That writes six R-Card credentials
   straight into the wallet (`bifold/packages/core/src/utils/seedTestCredentials.ts`),
   and Contacts draws each one through whatever `COMPONENT_CONTACT_CARD` is
   registered — six trading cards. **Clear test contacts** removes exactly
   those (they carry an `isTestData` tag). This one is easy to talk someone
   through, but it's still their tap.

**Then the actual iteration loop, which is the whole point:** once the six
cards are on screen, edits to `TradingCard.tsx` and `ocaBundles.ts` are
JS-only, so Metro hot-reloads them against the seeded cards with no rebuild
and no re-onboarding. This is the loop a non-developer actually uses to see
their design change — steps 1-6 happen once per device, not once per idea.

Six distinct DIDs means six different foil hues, which is the fastest way to
see gotcha 1 for real; four of the six carry an `organization` and two don't,
so the name plate gets exercised both ways; and each carries a portrait
(`fixtures/testContactPhotos.ts` — drawn animal avatars, not photographs of
real people), sized to the same budget an exchanged photo has to fit.

Each contact is seeded as TWO credentials, which is what a real exchange
leaves behind: the DTG relationship credential lists them in Contacts, and a
received RelationshipCard carries the name, organisation and photo. Only the
second can carry a photo — `resolveContactDisplayInfo`'s legacy
issuer-object branch has nowhere to put one — so a fixture that writes just a
DTG credential renders the `?` placeholder no matter what it sets.

One thing the seeded set still does *not* show: **every card grades COMMON.**
The fixtures write no witness credential and no hardware attestation
evidence, so `hasWitnessCredentials` and `hardwareVerified` are both false and
`rarityFor` never reaches its other three branches. Judging those means a real
exchange (`yarn e2e:vrc:devices` for the attested path) or extending the
fixtures further.
