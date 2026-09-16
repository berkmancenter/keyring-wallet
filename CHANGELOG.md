# Changelog

All notable changes to Keyring Wallet are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - Unreleased

First build from the public `berkmancenter/keyring-wallet` repository, shipped to
TestFlight internal testers and the Google Play internal testing track.

### Added

- Relationship exchange and witness ceremony carried as Trust Tasks, with TSP envelope carriage (#20, #27)
- The wallet answers `credential-exchange/query` Trust Tasks (#31)
- DIDComm v2 carriage and TSP over DIDComm v2, behind a developer setting; a DIDComm v2 mediator is provisioned beside the v1 one when the build carries `MEDIATOR_V2_URL` (#54)
- Witness-observed in-person co-presence over BLE on Android and iOS, with App Attest verification by the witness (#21, #38)
- Profile photo on R-Cards (#30)
- Reference-app demos: trading cards and the Approver (#34)

### Changed

- React Native 0.81, React 19; VC 2.0 credentials with `eddsa-rdfc-2022` Data Integrity proofs (#17)
- credo-ts 0.7 (the `0.7.1-pr-2704` snapshot that carries DIDComm v2) (#54)
- One OS authentication prompt per witnessed exchange (#46)
- Version is plain `MAJOR.MINOR.PATCH` — App Store Connect rejects a pre-release suffix
- Staging pipeline: Xcode 26 runner, credentials from the `internal` environment, build numbers continue above the previous repository's (from 201)

### Fixed

- A wallet whose first mediation provisioning was interrupted recovers instead of failing on every start (#50)
- Android: a single mediator pickup loop, and no volume-manager crash at startup (#43)

## [0.1.0-alpha.2] - 2026-06-28

### Added

- **Device passcode fallback for Secure Exchange** when biometrics are disabled in app settings (`useBiometry: false`)
- VRC hardware signing via device passcode on Android (passcode-only OS prompt) and iOS (Face ID with passcode fallback)
- `authMode` threaded from JS to native attestation for platform-appropriate authentication
- Confirmation modal: "Confirm Relationship" title, lock icon, and platform-specific security notes in passcode mode

### Changed

- Staging CI submodule URL updated from `berkmancenter/bifold` to `berkmancenter/keyring-bifold`

### Fixed

- Biometric confirmation modal and tests aligned with passcode UX
- iOS evidence records `DevicePasscode` when user opted out of biometrics (app policy)

### Known limitations

- iOS may show Face ID before passcode when biometrics are enrolled at the system level; user can tap "Enter Passcode"
- Embedded Google hardware attestation root CA expires May 2026 — cross-device Android verification update pending

## [0.1.0-alpha.1] - 2026-05-24

### Added

- Initial public alpha release of Keyring Wallet
- Verifiable Relationship Credentials (VRC) exchange
- Optional biometric hardware attestation (Secure Exchange)
- Witness verification support
