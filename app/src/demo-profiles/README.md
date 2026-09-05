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

To turn it on, register the installed profiles on the container in `App.tsx`:

```ts
import { installedDemoProfiles, registerDemoProfiles } from './src/demo-profiles'

const bcwContainer = new AppContainer(bifoldContainer, ...).init()
registerDemoProfiles(bcwContainer, installedDemoProfiles)
```

Nothing in `app/.env` changes, and no branding is fetched over the network.

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
