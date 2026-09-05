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
