# `demo-profiles/`

Where a use case lives. One directory per demo; adding one should not require
editing anything shared.

## Start here: `starter/`

`starter/StarterContainer.ts` is the file to copy. It is a complete, working
container in about 60 lines, and every registration in it is an example of a
kind rather than something Keyring needs:

| Line                    | Shows you how to                                          |
| ----------------------- | --------------------------------------------------------- |
| `COMPONENT_HOME_HEADER` | replace any component or screen                           |
| `UTIL_OCA_RESOLVER`     | control how credentials look, with no network             |
| `LOAD_STATE`            | rehydrate your own persisted state on boot                |
| `initializeVrcModule`   | turn on relationship credentials and the witness ceremony |

The real container, `app/container-imp.ts`, is 421 lines. Roughly fifteen of
them are the container mechanism; the rest is Keyring's own product — BC
Government credential-definition caches, a PersonCredential notification flow,
ledger configuration, help-action overrides. All correct for Keyring, all
noise if you are standing up your own use case, and you would have to read the
whole file to find the lines that matter. That is why this exists alongside it
rather than as a rewrite of it: `container-imp.ts` is untouched and still ships
Keyring.

To run the app on the starter instead, change one line in `App.tsx`:

```ts
const container = new StarterContainer(bifoldContainer).init()
```

## Skinning credentials without hosting anything

`starter/ocaBundles.ts` ships OCA bundles _inside the app_.
`DefaultOCABundleResolver` takes them as plain objects keyed by credential
definition id, schema id or template id, and resolves with no network at all.

Keyring itself uses `RemoteOCABundleResolver` against a git-hosted tree, which
is right in production and an avoidable failure point in a demo: a public URL
that has to stay up, and a round trip that can fail while someone is watching.
Credentials with no bundle still render — the resolver generates one, deriving
a background colour from the credential name — so a partial set is fine.

## A worked demo: `trading-card/`

An exchanged R-Card, drawn as a collectable card — photo, name plate, and a
rarity grade taken from what the exchange actually proved (hardware-signed,
witnessed, both). The exchange itself is untouched: this is Keyring's VRC
flow, with the R-Card's photo (`modules/vrc/utils/rcardPhoto.ts`) rendered
differently.

Two registrations, both additive:

| Token                    | What the profile puts there                             |
| ------------------------ | ------------------------------------------------------- |
| `COMPONENT_CONTACT_CARD` | `TradingCard` — how one exchanged R-Card is drawn       |
| `UTIL_OCA_RESOLVER`      | the card's colours and set name, bundled inside the app |

`COMPONENT_CONTACT_CARD` is resolved per contact by the contacts list, so a
profile changes the card without touching the screen. The colours come from an
OCA branding overlay in `trading-card/ocaBundles.ts`, keyed by the R-Card
template id — the identifier `DefaultOCABundleResolver` falls back to when a
credential has no AnonCreds schema or credential-definition id.

`App.tsx` already registers every installed profile on the container:

```ts
import { registerDemoProfiles, selectDemoProfiles } from './src/demo-profiles'

const bcwContainer = new AppContainer(bifoldContainer, ...).init()
registerDemoProfiles(bcwContainer, selectDemoProfiles(Config.ACTIVE_DEMO_PROFILE))
```

Nothing in `app/.env` has to change for this, and no branding is fetched over
the network — but `app/.env`'s `ACTIVE_DEMO_PROFILE` is how you pick which
profiles that registers:

| `ACTIVE_DEMO_PROFILE`                          | Result                                                    |
| ---------------------------------------------- | --------------------------------------------------------- |
| unset (the default)                            | every installed profile, all at once                      |
| a profile's `id` (`trading-card`, `approver`)  | only that one                                             |
| an id that doesn't match any installed profile | every installed profile (a typo isn't a request for zero) |
| `none`                                         | no demo profiles at all — a plain Keyring build           |

`none` is the one to reach for if you want to build and run Keyring itself,
with none of this directory's demos active — see "Stripping demos from a
build" below for what `none` does beyond the runtime table above.

## A worked demo: `approver/`

A new Trust Task type proven end to end, not just the VRC exchange skinned
differently the way `trading-card/` is: one contact asks another — over an
already-established VRC relationship — for access to something concrete
("may I see your shared photo album"), the other side approves or denies,
and the signed decision travels back over the same connection. No new
credential and no new identity mechanism: proof rides the VRC relationship
DID the two wallets already hold (see `approver/accessRequestSpec.ts`'s own
comment on why, and
`docs/plans/reference-app-sdk-packaging/2026-09-06-agent.md` for the fuller
narrative behind the scenario).

The UI lives per-contact, on that contact's own Contact Details screen
(`ApproverContactSection`) rather than on a shared screen — a sent request
shows a "waiting for a response" state with a local-only cancel (it clears
this wallet's own display; it does not tell the counterparty), and the
answer, once it lands, names what was actually decided rather than just
approved/denied in the abstract. A contact not currently on screen still
learns a request arrived via `ApproverGlobalListener`'s toast, which
navigates straight to that contact's own Contact Details screen.

Three registrations:

| Token                              | What the profile puts there                                           |
| ---------------------------------- | --------------------------------------------------------------------- |
| the open Trust Task registry       | `approver/access-request/0.1`, this profile's own task type           |
| `COMPONENT_CONTACT_DETAILS_FOOTER` | `ApproverContactSection` — the trigger + inbox, scoped to one contact |
| `COMPONENT_APP_GLOBAL_LISTENER`    | `ApproverGlobalListener` — the app-wide toast for a request elsewhere |

The latter two tokens are generic `@bifold/core` extension seams (their
default is a no-op, same as `COMPONENT_CRED_LIST_FOOTER`) — `approver/` is
their first consumer, not something baked into core for this demo
specifically. See `ApproverProfile.ts`'s own comment for the fuller
reasoning, including why the UI moved off an earlier Wallet-tab placement.

## The `DemoProfile` shape

`types.ts` defines it: an `id`, a `title` and `description` for the picker, and
a `register(container)` that adds what the profile needs.

Registration is additive on purpose. One build carries every installed
profile, and switching between them is a few taps rather than a rebuild —
which is what "enable another demo with a few clicks" has to mean for someone
sitting with a funder. It is also the same shape as the SDK's eventual
`registerTrustTask({ spec, orchestration, renderer })` surface, so the demos
exercise that design before any outside developer sees it.

A profile should register what it owns — its own credential renderer, its own
Trust Task type — and leave shared app chrome alone: two profiles registering
the same token means the last one wins.

## Stripping demos from a build

`ACTIVE_DEMO_PROFILE=none` drives two independent levers, one for RUNTIME
behaviour and one for the BUNDLE — both keyed off the same value on purpose,
so there is no way for "runtime says no demos" and "the bundle still ships
them" to drift apart:

- **Runtime** (the table above): `none` makes `selectDemoProfiles` return
  `[]`, so `registerDemoProfiles` registers nothing — no demo UI renders, no
  extra Trust Task type is registered. Every installed profile's CODE still
  ships in the JS bundle, just unregistered and inert. Proven by
  `e2e/run-plain-build-smoke.js`, which fails if any trace of either demo
  leaks into a `none` build.

- **Bundle**: `app/metro.config.js`'s `resolveRequest` also checks
  `ACTIVE_DEMO_PROFILE`. When it's `none`, any import of the demo-profiles
  barrel (`./src/demo-profiles` — `App.tsx` is the only file that imports
  it; nothing else reaches into this directory, which is exactly what makes
  intercepting that one specifier sufficient) is swapped for
  `app/metro/demoProfilesStub.ts`: a zero-dependency stand-in with the same
  public shape (`registerDemoProfiles`, `selectDemoProfiles`,
  `installedDemoProfiles`, the `DemoProfile` type) but no code inside it —
  the `DemoProfile` shape is duplicated rather than imported from `types.ts`,
  so the stub has no dependency edge back into this directory of any kind.
  Metro's dependency graph then never has a reason to walk into `approver/`,
  `trading-card/`, or `starter/` from `App.tsx` — none of those files are
  read, transformed, or included in the bundle, not just unregistered at
  runtime.
  - `app/metro/isDemoProfilesImport.js` holds the matching predicate, pulled
    out of `metro.config.js` itself purely so it is unit-testable without
    booting Metro's whole async config pipeline in a jest run.
  - `app/__tests__/metro/` covers both that predicate (including that it does
    NOT match a deep import into one profile's own internals, or an
    unrelated module that merely contains the substring `demo-profiles`) and
    that the stub's exported names stay in sync with the real module's.

**This is a build-time decision, not a runtime one** — the same rule
`MEDIATOR_URL` and every other baked `app/.env` value already follows (see
the repo root `CLAUDE.md`). Metro's own read of `.env` happens once, when its
dev server starts (`require('dotenv').config()` at the top of
`metro.config.js`); `Config.ACTIVE_DEMO_PROFILE`, which `App.tsx` reads via
`react-native-config`, is baked into the native binary at compile time.
Editing `.env` and expecting an already-running Metro or an already-built APK
to pick up the change will not work — restart Metro for the bundle-time
effect, and rebuild the native app for `Config` to read the new value.
