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
  <img src="https://img.shields.io/badge/React_Native-0.73-61DAFB?logo=react" alt="React Native" />
</p>

---

**Keyring** gives individuals full ownership and control of their digital identity. Create decentralized identifiers, store verifiable credentials on-device, and exchange relationship credentials with others — no centralized intermediaries required.

Developed at the [Applied Social Media Lab](https://asml.cyber.harvard.edu/) at Harvard's [Berkman Klein Center for Internet & Society](https://cyber.harvard.edu/).

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
├── keyring-bifold/         # Git submodule — core wallet framework
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

The `app/` directory contains the Keyring-specific experience — themes, custom screens, localization overrides, and agent configuration. The `keyring-bifold/` submodule contains reusable core logic shared across wallet implementations.

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

### Configuration

Copy the environment sample and configure your mediator:

```sh
cp app/.env.sample app/.env
```

Edit `app/.env` with your values:

```
MEDIATOR_URL=<your-mediator-invitation-url>
MEDIATOR_USE_PUSH_NOTIFICATIONS=<true|false>
PROOF_TEMPLATE_URL=<url>
REMOTE_LOGGING_URL=<url>
INDY_VDR_PROXY_URL=<url>
```

You will need a DIDComm mediator for the wallet to communicate with other agents. See the [Credo Mediator](https://github.com/openwallet-foundation/credo-ts-ext/tree/main/packages/rest#mediator) or [Aries Mediator](https://github.com/hyperledger/aries-mediator-service) for options.

### Run on iOS

```sh
cd app
yarn run ios:setup   # Install CocoaPods
yarn ios             # Build and launch
```

Or open `app/ios/AriesBifold.xcworkspace` in Xcode and run from there.

### Run on Android

Set up your Android environment (`~/.zshrc` or equivalent):

```sh
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export JAVA_HOME="/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home"
```

Then:

```sh
cd app
yarn android
```

### Start Metro Bundler

If Metro doesn't start automatically:

```sh
cd app
yarn start
```

### Witness Server

The witness server is a separate Node.js service. See the [keyring-bifold witness-server README](keyring-bifold/packages/witness-server/README.md) for complete documentation. Quick start:

```sh
cd keyring-bifold/packages/witness-server
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

The `keyring-bifold/` directory is a Git submodule pointing to our Bifold fork. To work on core changes:

1. Make changes in `keyring-bifold/packages/core/` (or other packages)
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
