# keyring-bifold

Core framework, shared packages, and witness server for [Keyring](https://github.com/berkmancenter/keyring-wallet).

⚠️ NOTE! This is a functional alpha release, but is not meant for production uses at this time. See [issues](https://github.com/berkmancenter/keyring-bifold/issues) for more information.

This is a fork of the [Bifold Wallet](https://github.com/openwallet-foundation/bifold-wallet) from the [OpenWallet Foundation](https://openwallet.foundation/), extended with support for Verifiable Relationship Credentials (VRCs), witnessed credential exchange, and biometric hardware attestation.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## What's Added

Beyond the upstream Bifold capabilities (AnonCreds, W3C VCs, DIDComm, mediation), this fork introduces:

- **VRC Module** — Peer-to-peer Verifiable Relationship Credential exchange using the Relationship Credential Exchange (RCE) protocol, including parallel issuance, relationship DIDs, and R-Card/jCard profile data
- **Witness Server** — A standalone Node.js service implementing the DTG Witnessed Exchange protocol, issuing Verifiable Witness Credentials (VWCs) over DIDComm
- **Biometric Hardware Attestation** — Device-backed cryptographic evidence using iOS Secure Enclave (App Attest) and Android StrongBox/KeyStore, embedded as VRC evidence
- **VRC Reference Implementations** - Standalone VRC and witnessed VRC exchange flows with automated tests, for reference and conformance.
- **VRC Contexts** — React contexts for VRC state management across the wallet UI
- **VRC Shared Utilities** - A package of server-side VRC utilities

## Packages

```
packages/
├── core/                       # Main UI, navigation, screens, VRC module, agent config
├── witness-server/             # Node.js witness service (DIDComm + web UI + REST API)
├── react-native-attestation/   # Native biometric hardware attestation (iOS + Android)
├── vrc-reference/              # VRC reference implementation with conformance tests
├── vrc-contexts/               # React contexts for VRC state
├── vrc-shared/                 # Shared VRC utilities for server side packages
├── oca/                        # Overlay Capture Architecture
├── verifier/                   # Verification utilities
└── remote-logs/                # Remote logging
```

### Core (`@bifold/core`)

The main package containing:

- **VRC Module** — Credential exchange, witness integration, VRC manager, hardware evidence
- **Screens** — Onboarding, settings, contacts, credential details, about
- **Navigation** — Tab stack, setting stack, onboarding flow
- **Hooks** — Biometry, notifications, unread messages, agent lifecycle
- **Agent Configuration** — Credo-TS setup with AnonCreds, Indy VDR, mediation, OpenID

### Witness Server

A full-featured witness service. See the dedicated [Witness Server README](packages/witness-server/README.md) for complete documentation including:

- DIDComm protocol and message types
- Session-based challenge verification
- Mediator configuration for mobile compatibility
- Docker deployment
- REST API and web interface
- Locality verification (BLE — coming soon)

### React Native Attestation (`@bifold/react-native-attestation`)

Native module providing biometric hardware attestation:

- **iOS**: App Attest API with Secure Enclave key generation and assertion signing
- **Android**: KeyStore/StrongBox with key attestation certificate chains
- Attestation evidence is embedded in VRCs for recipient-side verification

## Getting Started

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | `>=20.19.2 <21` |
| Yarn | `4.9.2` (via `corepack enable && corepack prepare yarn@4.9.2 --activate`) |
| Java | 17 (for Android) |

### Install Dependencies

```sh
git clone https://github.com/berkmancenter/keyring-bifold.git
cd keyring-bifold
yarn install
```

### Build All Packages

```sh
yarn build
```

### Run Tests

```sh
yarn test
```

### Run Individual Package Tests

```sh
cd packages/core
yarn test

cd packages/witness-server
yarn test
```

## Development

### Working With Keyring

This repository is used as a Git submodule in [Keyring](https://github.com/berkmancenter/keyring-wallet). The app resolves `@bifold/*` packages via Yarn portals, so changes here are reflected in the app without a build step during development.

For hot reload setup, see the [Hot Reload Dev Setup](../docs/HOT_RELOAD_BIFOLD_DEV_SETUP.md) guide in the main repo.

### Building for Production

```sh
yarn build
```

This transpiles all packages via their individual build scripts in topological order.

### Linting and Type Checking

```sh
yarn lint
yarn typecheck
```

## Protocols and Standards

| Protocol | Usage |
|----------|-------|
| [DIDComm](https://didcomm.org/) | All agent-to-agent communication |
| [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/) | VRCs, VWCs, standard credentials |
| [AnonCreds](https://www.hyperledger.org/projects/anoncreds) | Privacy-preserving credentials |
| [Decentralized Trust Graph](https://github.com/trustoverip/dtgwg-cred-tf) | Witnessed exchange credential spec |


## Attribution

This project builds on:

- [**Bifold Wallet**](https://github.com/openwallet-foundation/bifold-wallet) — The open-source wallet framework from the [OpenWallet Foundation](https://openwallet.foundation/)
- [**BC Wallet Mobile**](https://github.com/bcgov/bc-wallet-mobile) — Production wallet from the [Government of British Columbia](https://www2.gov.bc.ca/)
- [**Credo-TS**](https://github.com/openwallet-foundation/credo-ts) — The agent framework for DIDComm, credential exchange, and DID management

Developed at the [Applied Social Media Lab](https://asml.cyber.harvard.edu/) at Harvard's [Berkman Klein Center for Internet & Society](https://cyber.harvard.edu/).

## Contributing

We welcome contributions. Please open an issue or pull request. All contributions are subject to the Apache 2.0 license.

For upstream Bifold community discussion, join the [OpenWallet Foundation Discord](https://discord.gg/openwalletfoundation) `#bifold` channel.

## License

Apache 2.0 — see [LICENSE](../LICENSE) for details.
