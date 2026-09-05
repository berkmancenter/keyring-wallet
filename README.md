<p align="center">
  <img src="keyring-store-icon-512x512.png" alt="Keyring" width="128" style="border-radius: 22%;" />
</p>

<h1 align="center">Keyring</h1>

<p align="center">
  An open-source digital wallet for decentralized identity, verifiable credentials, and peer-to-peer trust.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/Platform-iOS%20%7C%20Android-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react" alt="React Native" />
</p>

---

**Keyring** gives individuals full ownership and control of their digital identity. Create decentralized identifiers, store verifiable credentials on-device, and exchange relationship credentials with others — no centralized intermediaries required.

Developed at the [Applied Social Media Lab](https://asml.cyber.harvard.edu/) at Harvard's [Berkman Klein Center for Internet & Society](https://cyber.harvard.edu/).

**Want to see it running?** [`docs/DEMO_QUICKSTART.md`](docs/DEMO_QUICKSTART.md) takes you from an empty machine to two wallets exchanging a credential — no prior mobile-development experience assumed, and nothing to configure.

⚠️ NOTE! This is a functional alpha release, but is not meant for production uses at this time. See [issues](https://github.com/berkmancenter/keyring-wallet/issues) for more information.

## Core Capabilities

### Verifiable Relationship Credentials (VRCs)

Exchange cryptographically signed relationship credentials directly with peers using the Relationship Credential Exchange (RCE) protocol. Credentials are issued, stored, and selectively disclosed without relying on a centralized authority. Standalone reference VRC exchange and witnessed VRC exchange flows, with automated conformance tests, are included.

### Witness Verification

A witness service can attest that a credential exchange occurred in person. The witness creates sessions, verifies that both participants submitted valid credentials, and issues Verifiable Witness Credentials (VWCs) — all without seeing private information.

### Biometric Hardware Attestation

Optional device-backed security using the Secure Enclave (iOS) or StrongBox/KeyStore (Android). Biometric verification confirms the legitimate wallet owner is initiating an exchange, with attestation evidence embedded directly in credentials.

### Standard Verifiable Credentials

Full support for AnonCreds and W3C Verifiable Credentials, Hyperledger Indy VDR, `did:peer`, and other DID methods, with credential and proof protocols via the [Credo-TS](https://github.com/openwallet-foundation/credo-ts) agent.

### DIDComm Messaging

All communication is end-to-end encrypted using DIDComm, with mediated messaging over WebSocket for reliable mobile delivery.

## Standards Alignment

- [DIDComm](https://didcomm.org/) — Secure, authenticated messaging
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/) — Standard credential format
- [Decentralized Trust Graph (DTG)](https://github.com/trustoverip/dtgwg-cred-tf) — Witnessed exchange protocol
- [AnonCreds](https://www.hyperledger.org/projects/anoncreds) — Privacy-preserving credentials


## Architecture

This is a monorepo with the following structure:

```
keyring-wallet/
├── app/                    # React Native mobile application
│   ├── src/                # App-specific screens, hooks, themes, localization
│   ├── android/            # Android native project
│   └── ios/                # iOS native project
├── bifold/         # Git submodule — core wallet framework
│   └── packages/
│       ├── core/           # UI, navigation, VRC module, hooks, agent config
│       ├── witness-server/ # Node.js witness service (DIDComm + web UI)
│       ├── react-native-attestation/  # Biometric hardware attestation
│       ├── oca/            # Overlay Capture Architecture
│       ├── verifier/       # Verification utilities
|       ├── vrc-reference/              # VRC reference implementation with conformance tests
|       ├── vrc-contexts/               # React contexts for VRC state
|       ├── vrc-shared/                 # Shared VRC utilities for server side packages
│       └── remote-logs/    # Remote logging
└── packages/
    └── react-native-argon2/  # Argon2 key derivation
```

The `app/` directory contains the Keyring-specific experience — themes, custom screens, localization overrides, and agent configuration. The `bifold/` submodule contains reusable core logic shared across wallet implementations.

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org) | `>=20.19.2 <21` | Use [nvm](https://github.com/nvm-sh/nvm) |
| [Yarn](https://yarnpkg.com/) | `4.9.2` | Via `corepack enable && corepack prepare yarn@4.9.2 --activate` |
| [Git](https://git-scm.com/) | Latest | |
| [JDK](https://www.azul.com/downloads/?package=jdk#zulu) | 17 | Zulu OpenJDK recommended |
| [Ruby](https://www.ruby-lang.org/) | 2.x | For CocoaPods (iOS) |
| [Python](https://www.python.org/) | 3.11.x | Build tooling |
| [Android Studio](https://developer.android.com/studio) | Latest | Android SDK 33 |
| [Xcode](https://developer.apple.com/xcode/) | Latest | iOS development (macOS only) |

### Clone and Install

```sh
git clone https://github.com/berkmancenter/keyring-wallet.git
cd keyring-wallet

# Initialize the keyring-bifold submodule
git submodule update --init --recursive

# Install dependencies
yarn install
```

### Run a demo

One command starts a local mediator, points the app at it, and builds and
launches the wallet. There is nothing to configure:

```sh
yarn demo:android    # Android emulator
yarn demo:ios        # iOS simulator (macOS)
```

Leave that terminal open — it is running your mediator. The first build takes
5-10 minutes.

**New to mobile development?** [`docs/DEMO_QUICKSTART.md`](docs/DEMO_QUICKSTART.md)
walks the whole path from an empty machine: installing the SDK, creating an
emulator, running the demo, exchanging a credential between two wallets, and
what to do when something fails.

Useful flags: `--device <id>` to pick one of several attached devices,
`--metro-port <n>` when another checkout already holds port 8081, `--tunnel`
for physical phones, `--fresh` to wipe the mediator's state.

### The mediator on its own

If you would rather build the app yourself, `yarn mediator` runs just the
mediator and writes its invitation into `app/.env`. See
[`bifold/packages/mediator-server/README.md`](bifold/packages/mediator-server/README.md)
for endpoint options and when a tunnel is needed.

### Configuration

`yarn demo:*` and `yarn mediator` create `app/.env` from `app/.env.sample` and
keep `MEDIATOR_URL` current, so a basic demo needs no hand-editing. The
remaining values are optional:

```
MEDIATOR_USE_PUSH_NOTIFICATIONS=<true|false>
PROOF_TEMPLATE_URL=<url>
REMOTE_LOGGING_URL=<url>
INDY_VDR_PROXY_URL=<url>
```

To point at a mediator you host yourself instead, set `MEDIATOR_URL` to its
invitation URL and skip `yarn mediator`.

### Building manually

```sh
cd app
yarn ios:setup && yarn ios   # iOS: install CocoaPods, then build and launch
yarn android                 # Android
yarn start                   # Metro, if it does not start on its own
```

On Android, set your SDK location first (`~/.zshrc` or equivalent):

```sh
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export JAVA_HOME="/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home"
```

### Witness Server

The witness server is a separate Node.js service. See the [witness-server README](bifold/packages/witness-server/README.md) for complete documentation. Quick start:

```sh
cd bifold/packages/witness-server
cp .env.sample .env   # Configure mediator and ports
yarn install
yarn start
```

Default ports: DIDComm on `9002`, web UI on `9003`.

### End-to-end tests

Appium-driven two-device tests (fresh install → onboarding → VRC exchange)
live in [`e2e/`](e2e/README.md). From the repo root:

```sh
yarn e2e:vrc            # Android emulator + iOS simulator, unattended
yarn e2e:vrc:devices    # physical phones — proves hardware attestation (attended)
yarn e2e:migration      # Askar store-migration upgrade test
yarn e2e:smoke          # single-device onboarding smoke test
```

Setup, app-build commands, and the real-device operator guide: [`e2e/README.md`](e2e/README.md).

## Developing in keyring-bifold

The `bifold/` directory is a Git submodule pointing to our Bifold fork. To work on core changes:

1. Make changes in `bifold/packages/core/` (or other packages)
2. Changes are picked up via Yarn portals — no build step needed in dev
3. For hot reload of keyring-bifold source, see `docs/HOT_RELOAD_BIFOLD_DEV_SETUP.md`

To build keyring-bifold packages for production:

```sh
cd keyring-bifold
yarn install
yarn build
```

## Troubleshooting

**Metro cache issues:**
```sh
cd app && yarn start --reset-cache
```

**Android emulator not connecting:**
```sh
adb reverse tcp:8081 tcp:8081
```

**Dependency or native module issues:**
```sh
rm -rf app/node_modules
yarn install
cd app/android && ./gradlew clean && cd ../..
```

**iOS pod issues:**
```sh
cd app/ios && pod install --repo-update && cd ../..
```

## Attribution

Keyring builds on proven open-source foundations:

- [**Bifold Wallet**](https://github.com/openwallet-foundation/bifold-wallet) — from the [OpenWallet Foundation](https://openwallet.foundation/), the core wallet framework for verifiable credentials on mobile
- [**BC Wallet Mobile**](https://github.com/bcgov/bc-wallet-mobile) — from the [Government of British Columbia](https://www2.gov.bc.ca/), the original production deployment that proved the architecture
- [**Credo-TS**](https://github.com/openwallet-foundation/credo-ts) — the agent framework powering DIDComm, credential exchange, and DID management

Our contributions to this ecosystem include:

- Drafting the initial [Decentralized Trust Graph credential specification](https://github.com/trustoverip/dtgwg-cred-tf) with the [DTG Working Group](https://lf-toip.atlassian.net/wiki/spaces/HOME/pages/257785857/Decentralized+Trust+Graph+Working+Group) at Linux Foundation Decentralized Trust
- Adding peer-to-peer relationship credential exchange to the wallet
- Developing and implementing the witnessed exchange protocol
- Creating a reusable module for local biometric attestation and verification on iOS and Android

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

## Links

- [Applied Social Media Lab](https://asml.cyber.harvard.edu/)
- [Advanced Digital Identity Project](https://asml.cyber.harvard.edu/advanced-digital-identity/)
- [Keyring Bifold (core fork)](https://github.com/berkmancenter/keyring-bifold)
