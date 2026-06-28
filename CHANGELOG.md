# Changelog

All notable changes to Keyring Wallet are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
