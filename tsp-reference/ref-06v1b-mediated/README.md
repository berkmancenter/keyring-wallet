# ref-06v1b — the binding through the real Keyring mediator

Escalation of [ref-06v1](../ref-06v1-didcomm-v1-binding/): same document, same
binding, but the network is back. Two Credo 0.6.3 agents each **enrol with the
production Keyring mediator** (`credo-mediator.asml.berkmancenter.org`), the
connection between them is mediator-routed, and the Trust Task document rides
the full real path: sender → HTTPS/WSS to the mediator → store-and-forward →
receiver's implicit-pickup session. 7 checks.

Run:

```sh
npm install
npm start                       # against the production mediator
MEDIATOR_URL=… npm start        # any other Credo/Aries mediator invitation URL
npm run check                   # quiet pass/fail
```

## What it proves (beyond ref-06v1)

- **The mediator is transparent to the binding.** Forward-wrapping,
  store-and-forward and pickup do not disturb the `~attach` decorator: the
  document arrives byte-identical, `~thread` intact, `content` still the
  human-readable summary. This is the exact production topology of a
  wallet-to-wallet VRC exchange today.
- **Mediator-routed invitations work unchanged** — alice's invitation advertises
  the mediator's endpoint and routing keys, and the DIDExchange handshake itself
  crosses the mediator.
- **The urn:uuid refusal reproduces identically.** It is client-side validation
  in Credo (`MessageIdRegExp` on the `~thread` fields), so no mediator can fix
  it — confirming the remedy belongs in the binding spec, not in infrastructure.

## What it does NOT prove

- **Nothing about the Affinidi/OpenVTC mediator.** This mediator is
  Credo/Aries-native, v1 is its mother tongue. The cross-vendor leg — their
  mediator with the DIDComm v1 compile-time feature flag — is a separate rung
  that waits for Cypress RC-1 (upstream is mid-realignment and the editor asked
  for no full-stack testing until the re-tag).
- Still Node-only (Hermes is ref-08), still carriage-only (no task semantics,
  no proofs), and each run enrols two fresh ephemeral mediation records on the
  mediator — harmless, but worth knowing.

Pinned against: the same coordinates as ref-06v1 (`dtgwg-trust-tasks-tf`
@ `fbe196a`, `@credo-ts/*` 0.6.3). The embedded invitation URL is the mediator's
public invitation endpoint; override with `MEDIATOR_URL` to point elsewhere.
