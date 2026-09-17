---
name: customizing-trading-card
description: Use when someone wants the trading-card demo to look or behave differently — new colours, set name, card layout, what's printed on the card, rarity/grading rules, per-contact foil variation, or "make the cards look like X". Maps the ask onto the four files that own it, and names what must not change (e2e testIDs, the VRC exchange underneath).
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

## The four things that trip people up

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

One device, no second phone, no mediator. Set
`ACTIVE_DEMO_PROFILE=trading-card` in `app/.env`, then **restart Metro and
rebuild the native app** — that value is baked at build time, so editing
`.env` alone changes nothing. In the running app: Settings → tap the version
footer 11 times to unlock Developer → **Seed test contacts**. That writes six
R-Card credentials straight into the wallet
(`bifold/packages/core/src/utils/seedTestCredentials.ts`), and Contacts draws
each one through whatever `COMPONENT_CONTACT_CARD` is registered — six trading
cards. **Clear test contacts** removes exactly those (they carry an
`isTestData` tag).

After that, edits to `TradingCard.tsx` and `ocaBundles.ts` are JS-only, so
Metro hot-reloads them against the seeded cards with no rebuild.

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
