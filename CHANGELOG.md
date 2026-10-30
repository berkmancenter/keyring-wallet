# Changelog

What changed in each Keyring release, in plain words.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Keyring's version is 0.2.0 for every build listed here. Testers know each
release by its build number (for example 276). Over-the-air updates to a build
add a second number (276.1, 276.2, ...).

## Build 276 and its updates — 2026-10-29

### Added

- **Rooms.** A community's shared spaces, through your agent: see your rooms,
  accept or hide offers, read and post in a room's chat, attach files up to
  25 MB, and read a room's notes, files and members.
- 276.2: post in open rooms, see new posts while a room is open, and write titled
  notes.
- 276.5 and 276.6: the room chat shows the newest post at the bottom, a cleaner
  room header with your own name, and your own names for other members.
- 276.8: posting and notes in rooms where posts carry your name; a list of a
  room's files; notices for a new offer, being let in, and a post that didn't
  send; older posts load as you scroll; authors shown by their directory name;
  "ask again" when a room says your admission is pending.
- 276.8: the new Messages list, with one row per conversation and a New
  message button.

### Fixed

- 276.1: the rooms list no longer waits behind a slow agent.
- 276.3: unlinking another agent shows on its row; room tabs scroll at large
  text sizes.
- 276.4: room tabs fade at their edges and scroll into view.
- 276.7: a sent message no longer comes back into the composer.
- 276.8: after the phone locks, Keyring returns to the room you had open.

## Builds 272–275 — 2026-10-25 to 2026-10-26

### Added

- **Chat that feels like a messenger:** reactions, replies, an emoji picker,
  photos inside the message, copy, delete for me, and clear chat.
- Disappearing messages, and a setting for how long chat stays on your phone.
- Drafts that stay when you leave a chat.
- Contact photos in the Messages list and the chat header.
- Contact details: one page per person, with how you know them, one entry per
  day.
- Community cards in the wallet show as a stack of passes, and open in place.
- With Reduce Motion on, cards fade in instead of moving.

### Changed

- The app checks for new messages every 5 seconds when idle, and every second
  while a chat, the scanner or an exchange is open.

## Builds 266–271 — 2026-10-21 to 2026-10-24

### Added

- **Over-the-air updates**, from build 267: small fixes reach testers without a
  new store build. A downloaded update is applied when you come back to the app
  after some time away.
- Contacts are grouped by person. "Same person?" merges two entries, confirmed
  with the other person's phone, and can be undone.
- Keyring talks to agents and communities in TSP 1.0 as well as the earlier TSP
  version, and picks what each one understands.

### Changed

- Smoother screens while data loads.

## Builds 242–265 — 2026-10-09 to 2026-10-21

### Added

- **Private vetting.** In communities that use it, you can apply and vouch with
  the usual vetting steps, and your vetters stay private.
- **Sign in to a community's website** by scanning its QR code or opening its
  link, then approving on your phone. You can sign in as any identity your agent
  holds for that community.
- A community's directory statement shows before you send a join request.
- Message notifications: a contact's message can wake the phone, and tapping the
  notification opens Messages.
- Relationship and witness credentials use the new Decentralized Trust Graph
  formats. Existing contacts keep working.

### Fixed

- After an update, a community identity gets its key back from your agent, or
  Keyring asks you to reconnect, instead of failing to sign in.

## Builds 226–241 — 2026-09-28 to 2026-10-07

### Added

- **Notifications** (if you allow them, asked during onboarding): your phone
  wakes when your agent needs an approval, and a tap opens it.
- Link more than one agent, switch between them, and unlink one.
- Name your devices, and rename or remove them.
- Answer your agent's step-up checks from the phone, with the reason shown
  first. Choose what your agent asks you about.
- The Join screen lists a community's ways in and what follows each one.
- An onboarding page about your own agent.

### Changed

- "Your agent" puts communities first, with Join in the corner and the rest
  under Agent settings.

## Builds 201–225 — up to 2026-09-26

First builds from the public repository, sent to TestFlight and Google Play
testers.

### Added

- **My Agent:** link your phone to your agent by QR code or link, take ownership
  of an existing agent from your phone, and add a backup phone.
- **Communities:** join by invitation or link, as the profile you choose; be
  vetted, or vet others at the vetting desk, one step per screen with a match
  code on both phones; leave a community.
- Edit your R-Card after onboarding, keep more than one profile, and add a photo.
- Links, codes and credential offers open Keyring from the phone's camera.
- Send a problem report, with the recent log, from Settings.
- Errors in plain words, with the details behind "Details".
- Relationship exchanges and the witness ceremony carried as Trust Tasks, with
  TSP envelopes.
- In-person evidence over Bluetooth, observed by a witness, on iPhone and
  Android.
- Answers to credential queries from other wallets.

### Changed

- React Native 0.81 and React 19; Credo 0.7.
- Relationship credentials use W3C Verifiable Credentials 2.0 with Data Integrity
  proofs.
- One system authentication prompt per witnessed exchange.

### Fixed

- A wallet whose first mediator setup was interrupted recovers instead of
  failing on every start.

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
