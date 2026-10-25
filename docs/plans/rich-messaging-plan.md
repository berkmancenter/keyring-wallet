# Rich Messaging — Plan

**Status:** Proposed. Nothing here is built.
**Scope:** The smallest set of changes that makes one-to-one Keyring chat feel like a modern messenger:
- **reactions;**
- **quoted replies;**
- **an emoji picker;**
- **photos and GIFs small enough to travel inside a message;**
- **control over message history:** delete, clear, keep-for, and disappearing messages.

Nothing in this plan needs a server, a file store or new hosting of any kind. Large media (video, files, full-resolution photos) and group chat are **out of scope** (§2, §8).

**Companions:**
- [`rich-messaging-plan/2026-10-21-al.md`](./rich-messaging-plan/2026-10-21-al.md) — the research this plan is built on: current code, what the protocols allow, how Signal, WhatsApp and Matrix move media, and whether a VTA can host media.
- [`rich-messaging-plan/2026-10-24-al.md`](./rich-messaging-plan/2026-10-24-al.md) — the response to the review of 2026-10-22, point by point, and the evaluation of message history and disappearing messages.

**Related plans:**
- [`openvtc-rooms-plan/rooms_group_messaging_subtask.md`](./openvtc-rooms-plan/rooms_group_messaging_subtask.md) — group messaging on VTI data rooms. This plan reuses its event vocabulary.
- The mediator migration plan (wallet PR #530, in review) — moves Keyring↔Keyring mailboxes to the Affinidi mediator (M1 → M5, no date yet). It sets the 1 MiB message ceiling this plan designs against.
- [`rcard-profile-picture-plan.md`](./rcard-profile-picture-plan.md) — the existing image-over-DIDComm precedent.
- The community messaging plan (`community-messaging-plan.md`, draft, not yet in a PR) — owns the community layers: rooms through room offers, directory introductions, and the group-chat decision. **This plan owns one-to-one chat**, and that plan's one-to-one section points here.

**Baseline:** bifold `783cadfb`, wallet `origin/main` `e5a72c8`. The §3 facts and the history step were re-read at wallet `main` `fa53c341` and bifold `main` `f133052d`. Upstream is read from the pinned `external/` clones: affinidi-tdk-rs `a1611baa`, dtgwg-trust-tasks-tf `7b6bb488`, verifiable-trust-infrastructure `49f5f1be`.

---

## 1. Summary

Today a Keyring chat message is **one plain-text string** sent as a DIDComm BasicMessage. Emoji work because they are Unicode text; nothing else does. Credo's BasicMessage (1.0 and 2.0) has no attachment field in its API, message class or record, and no DIDComm standard defines reactions. Keyring also offers no way to delete a message or a chat, and no way to limit how long history is kept.

The plan adds five things, all carried by the messages we already send through the mediator we already use:

1. **A Keyring chat message type** (`keyring/chat/1.0`), built like `TrustTaskMessage`. It is the one protocol change, and everything else rides on it.
2. **Reactions and quoted replies**, as events in that message type.
3. **Our own emoji picker**, built from Unicode's emoji list, with no runtime dependency.
4. **Inline photos and GIFs up to 256 KiB.** Photos are resized and compressed on the phone, then sent inside the message itself. The DIDComm envelope already encrypts them end to end, exactly like text today. On the phone, they are stored with the platform's file protection and kept out of backups.
5. **Message history controls:**
   - delete a message for yourself;
   - clear a chat;
   - a "Keep messages" retention setting;
   - per-chat **disappearing messages**, synced between the two phones.

**What it deliberately does not do:** host media anywhere. Nothing is uploaded to a Keyring server, a cloud bucket or a VTA. Media exists only inside an encrypted message and on the two phones. That is why videos, documents and full-resolution photos wait (§8).

---

## 2. Goals and non-goals

**Goals**
- G1. React to any message with an emoji, change or remove the reaction, and see the peer's reactions.
- G2. Reply to a specific message, with the quoted original shown above the reply.
- G3. Pick emoji from a proper picker (categories, search, recent), in messages and reactions.
- G4. Send and receive photos and animated GIFs that fit in a message, between two Keyring wallets.
- G5. **No hosting:** no new server, store or infrastructure, and no new place where user media rests other than the two phones and the mediator's existing encrypted queue. On the phones, media is protected at rest and kept out of backups and device transfers.
- G6. Works on today's Credo mediator **and** after the Affinidi mediator migration.
- G7. Mixed fleets degrade cleanly: an older wallet still gets readable text.
- G8. A person controls how long their chat history lives:
  - delete a message for themselves;
  - clear a chat;
  - keep history for a set time;
  - turn on disappearing messages for a chat, which both phones honour.

**Non-goals**
- **Videos, documents and full-resolution photos.** They do not fit in a 1 MiB message, and every way to move them needs storage that someone hosts (§8).
- **Group chat.** It belongs to the rooms subtask.
- **Third-party GIF search** (Giphy, Tenor). It sends users' search terms to a third party and needs an API key in the app. GIFs come from the phone.
- **Edits, delete-for-everyone, read receipts and typing indicators.** The event format leaves room for them (§4.2), but they are not part of the minimum.
- **Preventing screenshots or copying.** Disappearing messages limit what stays on the two phones; they cannot stop a person from photographing a screen, and the app never claims otherwise.

---

## 3. Current state

All references are at bifold `main` `f133052d` unless marked. The first companion carries the full survey.

| Area | What exists | Where |
|---|---|---|
| Chat UI | `react-native-gifted-chat` ~3.3.2, fully custom-rendered bubbles; no image rendering; links are tappable | `packages/core/src/screens/Chat.tsx`, `components/chat/ChatMessage.tsx` |
| Send | Text only: `basicMessages.sendMessage(connectionId, messages[0].text)` | `Chat.tsx` |
| Storage | `DidCommBasicMessageRecord { content: string, … }`; our `seen` flag lives in metadata | `types/metadata.ts` |
| Display filter | Any `content` that parses as JSON with a `type` is **hidden** from chat and from the unread count, because VRC code sends protocol JSON through BasicMessage | `hooks/chat-messages.tsx`, `hooks/useUnreadMessages.ts` |
| Custom message precedent | `TrustTaskMessage` carries a JSON attachment and is registered through `DidCommMessageHandlerRegistry` | `packages/trust-tasks/src/TrustTaskMessage.ts`, `packages/core/src/modules/trust-tasks/module/TrustTasksModule.ts` |
| Wake and notifications | Contentless push, then pickup, then open the chat; listens for BasicMessage state changes only. The in-app toast shows the first 80 characters of a text message | `packages/core/src/utils/messageWake.ts`, `components/InAppMessageNotifier.tsx`, `utils/activeChatTracker.ts` (message-notifications work, bifold #452 and #462, merged 2026-10-21) |
| Deleting history | No delete for a message or a chat, and no retention setting. The only deletion is removing a contact (`useDeleteContact.ts`), which removes the contact's credentials, connection and relationship record but **leaves its chat messages in the store** | `modules/vrc/hooks/useDeleteContact.ts` |
| Animated images on Android | React Native's Fresco 3.6.0 is present without `animated-gif`, so GIFs do not animate on Android today | `app/android/app/gradle.lockfile` |

**Already in the app, so no new dependency is needed:**
- `expo-image-picker` and `expo-image-manipulator` (resize, compress, and re-encode to JPEG, PNG or WebP);
- `react-native-vision-camera`;
- `react-native-fs`, whose `writeFile` and `mkdir` accept an iOS file-protection class and a backup-exclusion flag;
- `react-native-gesture-handler` (pinch-zoom);
- `react-native-screenguard`, already wired through `hooks/screen-capture.ts`.

iOS already declares the camera and photo-library usage strings (`app/ios/AriesBifold/Info.plist`).

---

## 4. Protocol: `keyring/chat/1.0`

### 4.1 Message type and carriage

- **One DIDComm message type,** `https://keyring.berkmancenter.org/chat/1.0/event` *(exact URI: D3)*. It carries a **chat event** as a JSON attachment with id `chat-event`, copying the `TrustTaskMessage` pattern:
  - a `DidCommMessage` subclass with `static type = parseMessageType(...)`;
  - the payload in `DidCommAttachmentData({ json })`;
  - registration through `DidCommMessageHandlerRegistry`.

  A DIDComm v2 class mirrors it, the way `DidCommV2Carriage` does for Trust Tasks.
- **The event JSON is independent of how it is carried,** so it can later travel as a TSP payload unchanged.
- **Not JSON inside BasicMessage `content`.** The display filter in §3 hides exactly that shape, non-Keyring peers would show raw JSON, and BasicMessage records cannot be indexed by event type.
- **Not a Credo patch to BasicMessage.** Credo's base message class keeps `~attach` on the wire, but the BasicMessage handler and record drop it. Patching that gives Keyring-only behaviour to a standard type, which other peers would silently lose, and the patch would have to be carried through the Credo 0.7 upgrade.
- **Not Trust Tasks `chat/message 0.1`** (`external/dtgwg-trust-tasks-tf/specs/chat/`). That spec is for an AI agent talking to a messaging bridge: every message is signed and hash-chained to the previous one for audit. That is the wrong cost and the wrong semantics for person-to-person chat.

### 4.2 Event body

**Where the shape comes from.** The body follows the rooms subtask's `org.openvtc.msg/1` event (§5.3 there), so one-to-one and future group chat share one vocabulary.
- **Left out:** the fields that only make sense inside a room (`via`, record-key checks, `sig` inside the seal, padding buckets), because the pairwise envelope already authenticates the sender.
- **Matched, not depended on.** That subtask is itself a draft ("Nothing here is built, and it is not a commitment to implement"). The profile name is Keyring's own (D3), so if the rooms shape changes, one-to-one chat keeps working, and the two are reconciled when room chat is built.

```jsonc
{
  "profile": "keyring.chat/1",        // D3
  "type": "message",                  // message | reaction | redaction | timer
  "eventId": "01JB…",                 // ULID, generated by the sender
  "clientTs": "2026-10-21T14:03:00Z", // display only, never trusted
  "inReplyTo": "01JA…",               // optional: quoted reply
  "content": { "format": "text/plain", "text": "look at this 🐱" },
  "attachments": [ /* §4.3, type "message" only */ ],
  "target": "01JA…",                  // reaction and redaction only
  "emoji": "👍",                       // reaction only: one entry of the pinned emoji set (§5)
  "expiresIn": 604800,                // message only: seconds, 0 or absent = keep (§4.6)
  "timer": { "expiresIn": 604800, "version": 3 } // timer only (§4.6)
}
```

**Event types:**
- **Reaction:** a `reaction` event with `target` and `emoji`. Each person has at most one reaction per message, and a new one replaces the old one, as in WhatsApp and Signal.
- **Removing a reaction:** a `redaction` whose `target` is the reaction's `eventId`. This is the Matrix and rooms-subtask model.
- **Quoted reply:** a `message` with `inReplyTo`. If the quoted message is not on this device (deleted, expired, or from before the upgrade), the bubble shows "Original message not available".

**Authorization.** A `reaction` or a `redaction` is valid only when the receiver can check that its sender authored the event it targets. A reaction can come from either party, but a redaction only from the author of the reaction or message it removes. An event is **ignored** when:
- its `target` is unknown and expires from the held buffer (below);
- its `target` belongs to another connection;
- it fails the authorship check.

The sender is the authenticated DIDComm sender of the connection, never a field inside the event.

**Ordering.** Each sender's events are ordered by their ULID `eventId`. Later wins, per sender and target. `clientTs` is used only for display. That resolves "change, then remove" correctly even when the two arrive in different pickup batches.

**Events that arrive before their target.** A reaction, redaction or reply that arrives before its target (possible across pickup batches) is held, and applied when the target arrives. The held buffer is capped at 200 events per connection, and each held event expires after 7 days, the mediator's own retention. On either limit, the oldest held events are dropped.

**Notifications.**
- A reaction never produces a notification or toast of its own; it appears on the bubble the next time the chat is open.
- Whether a reaction's arrival wakes the phone at all is a mediator question. Today the mediator rings the push gateway for any queued message, and the gateway rings at most once every 30 seconds.
- Keeping non-content events (reactions, timer changes, and receipts if they are ever added) from waking the phone is an open question owned by the peer-message-notifications work, and this plan adopts its answer.

**Later types** (`edit`, delete-for-everyone as a `redaction` of a message, delivered and read receipts, typing indicators) slot into the same `type` field without changing what already exists.

**Interop note.** Affinidi Meeting Place's `meeting-place-chat/1.0` uses a different vocabulary (`message`, `delivered`, `reaction`, `chat-activity`). If Meeting Place interop is wanted later, it is a mapping between the two shapes, not a constraint on this one.

### 4.3 Inline attachment

```jsonc
{
  "id": "a1",
  "mediaType": "image/jpeg",          // checked against the bytes on receive, never trusted alone
  "filename": "IMG_0412.jpg",         // display only; never used as a file name on disk
  "byteCount": 184113,
  "width": 1600, "height": 1200,
  "data": { "base64": "<the image bytes>" }
}
```

- **No per-file key.** The DIDComm envelope already encrypts the whole message end to end, the same protection text has today. A separate key only becomes necessary when bytes travel outside the envelope, and this plan never does that.
- **Shape.** The descriptor follows the `data.base64` shape of the Aries attachments decorator (RFC 0017, attachments 1.0). A future link-based variant would add a different `data` form and a `cipher` field. That is an additive change, not a breaking one.
- **The receiver checks the descriptor against the bytes, and rejects the attachment on any mismatch.** It checks that:
  - `byteCount` equals the decoded length;
  - the magic bytes match `mediaType`, which must be one of JPEG, PNG, GIF or WebP;
  - `width` and `height` equal the dimensions read from the image header (§5, "Safety").

### 4.4 Size limit

**One message, including its attachments, stays under 256 KiB of raw bytes.**
- **The ceiling that matters** is the Affinidi mediator's `message_size = 1_048_576` (`external/affinidi-tdk-rs/…/affinidi-messaging-mediator/src/common/config/limits.rs`; `deploy/keyring-messaging/mediator/mediator.toml` on `origin/main`). Today's 5 MB Credo HTTP limit (`@credo-ts/node/.../DidCommHttpInboundTransport.mjs`) is not.
- **Why 256 KiB.** The image is base64'd into the attachment, then base64url'd again inside the JWE, so 1 MiB holds about 560 KiB of raw bytes before JSON and forwarding overhead. 256 KiB leaves headroom, and it keeps the pickup batches of up to 10 messages light on mobile networks.
- **This figure is an estimate until Step 0 measures it.**

**Effect on the mediator's queue.** The queue limits count messages, not bytes. On Affinidi they are `queued_send_messages_per_peer = 50` and `queued_receive_messages_soft/hard = 200/1000` (`deploy/keyring-messaging/mediator/mediator.toml`, enforced through `limits.queue.peer` / `PEER_Q`; see `docs/VTI_UPSTREAM_FINDINGS.md`).
- **Message counts.** Photos reach those gates no sooner than text does. A burst of photos counts one message each against the 50-per-peer cap.
- **Bytes held.** This is what grows. At the hard cap, 1,000 queued messages of 256 KiB is about 256 MiB for one recipient, against a few hundred KiB for text. On the Affinidi mediator that sits in its store until pickup or the 7-day expiry.
- **Pickup batches.** A batch of 10 such messages is about 2.5 MiB raw (roughly 4.5 MiB on the wire), inside the 10 MiB `ws_size`/`http_size` frame limits.
- **The contentless push wake** is unaffected by size.

Step 0 measures queue memory per queued photo on both mediators, and the mediator operator signs off on the worst case before Step 3 ships (D2).

**What fits:**
- **Photos:** resized to 1600 px on the long edge and re-encoded as JPEG with `expo-image-manipulator`, stepping quality down (0.8 → 0.6 → 0.4) until the result fits. A typical phone photo lands at 150–250 KiB. If a photo still does not fit at the lowest step, it is resized further. The re-encode is expected to drop EXIF, including GPS, and Step 3 tests that it does.
- **GIFs:** sent as they are, because re-encoding would lose the animation. A GIF over the limit is refused with "This GIF is too large to send". Many reaction GIFs fit; long ones do not.
  - **GIFs keep their metadata.** A GIF is forwarded unchanged, so any metadata blocks it carries travel with it. The send sheet says so.
- **Several photos** in one send become several messages.

### 4.5 Capability check and fallback

- **Advertising support.** Each wallet advertises `keyring/chat/1.0` through Discover Features (Aries RFC 0031, discover-features 1.0, and RFC 0557, discover-features 2.0, both already in Credo).
- **Caching the answer.** It is cached per connection, and re-queried when:
  - it is missing;
  - it was recorded by an older app version;
  - it is more than 7 days old.

  It is also re-queried **before anything is dropped** because of an "unsupported" answer more than 24 hours old.
- **Peer supports it:** send `chat/1.0/event`.
- **Peer does not:** send a plain BasicMessage. Text goes as it is. A photo goes as "📷 Photo — update Keyring to see it". A reply goes as its text. Reactions are **not sent**, because a stream of "reacted 👍" messages is worse than nothing.
- **Receivers accept both,** and existing BasicMessages keep rendering exactly as today.
- **Disappearing messages need both sides on `chat/1.0`.** A fallback BasicMessage carries no timer, so an older peer cannot honour one. The timer cannot be turned on for a peer that does not advertise `chat/1.0` ("Ask <name> to update Keyring to use disappearing messages"). If the peer stops advertising it while a timer is on, the next send asks before going out as a plain message.

**Delivery to an offline peer.** There are no delivery receipts in this plan. A message, including a photo, that waits in the mediator queue for longer than its 7-day expiry is dropped there, and the sender is not told. That matches text today and is accepted for this plan. Delivered receipts are a later type (§4.2), and they would close the gap.

### 4.6 Message history and disappearing messages

**Local controls.** These never send anything, and each deletes the record together with its folded reactions, its quote snippets and its media file:
- **Delete for me:** removes one message from this phone.
- **Clear chat:** removes every message in one chat from this phone. The contact stays.
- **Keep messages:** a global setting (Forever, 1 year, 6 months, 30 days), as in Signal. A sweep deletes older messages.
- **Removing a contact** also removes that contact's chat history and media folder. Today it leaves the messages behind (§3).

**Disappearing messages, per chat, synced between the two phones:**
- **Setting the timer.** Either person can set or change the chat's timer: Off, 1 hour, 1 day, 1 week or 4 weeks.
  - The change is a `timer` event carrying `expiresIn` and a `version`. The highest `version` wins, with ties broken by `eventId`, the race Signal's `expireTimerVersion` exists to settle.
  - It shows as a system line in both timelines: "<name> set messages to disappear after 1 week".
- **Every message carries the `expiresIn` it was sent with.** So a missed `timer` event does not leave the two phones disagreeing about that message. A timer change applies to new messages only.
- **When the clock starts** follows Signal: the sender's copy at send, the recipient's copy when it is first shown on screen (D4). An unread message therefore stays until it is read, or until the mediator's 7-day expiry drops it undelivered.
- **The sweep** runs at startup, when the app comes to the foreground, and on a timer while a chat is open. It deletes the record, its folded reactions and redactions, quote snippets that show its text, and its media file. A reply whose target has expired shows "Original message expired".
- **Notifications in a chat with a timer** show "New message" with no preview, both in the in-app toast and in any system notification. That way a preview cannot outlive the message.
- **What the setting says:** "New messages in this chat disappear from both phones after they've been seen for 1 week. Either of you can change this. People can still screenshot or copy messages, and this only works when you both have a current Keyring."
- **The mediator queue is not shortened** for timed messages (D5). It holds only ciphertext, for at most 7 days, and shortening it would drop undelivered messages rather than expire read ones.

---

## 5. Client changes

- **Module** `packages/core/src/modules/chat/` (new), containing:
  - the message classes (v1, v2) and the handler;
  - a `ChatEventRecord` and its repository;
  - a `ChatService` that sends and receives, applies §4.2's authorization and ordering, folds reactions into their targets, chooses the fallback, runs the §4.6 sweeps, and tracks the per-chat timer.
- **Record:** `ChatEventRecord { eventId, connectionId, role, type, content?, attachments?, target?, emoji?, inReplyTo?, expiresIn?, expiresAt?, sentTime }`, tagged by `connectionId`, `type`, `target` and `expiresAt`.
  - The record keeps only an attachment's file path. Large base64 strings never stay in the wallet store or in React state.
- **Media files on disk:**
  - **Name and grouping.** Each file is named by `eventId`, never by the peer-supplied `filename`, in one folder per connection. It is deleted with its record (§4.6).
  - **iOS:** `Library/Application Support/chat-media/<connectionId>/`, not `Documents`, which iOS backs up by default. The folder is created with `NSURLIsExcludedFromBackupKey`, and each file is written with the file-protection class `NSFileProtectionCompleteUnlessOpen`. A closed file is then unreadable until the next unlock, while a photo can still arrive and be written in the background while the phone is locked. The app-wide default protection class is left unchanged.

    Both settings are `react-native-fs` options, so no new native code is needed. Pass the protection class as its string value (`'NSFileProtectionCompleteUnlessOpen'`); `RNFS.FileProtectionKeys` is undefined at runtime in 2.20.
  - **Android:** `filesDir/chat-media/<connectionId>/`, which is app-private, credential-encrypted storage. A `data_extraction_rules.xml` (`android:dataExtractionRules`) excludes it from both `<cloud-backup>` and `<device-transfer>`.
- **Unread and previews:**
  - **What counts as unread:** a `ChatEventRecord` of type `message` counts toward `useUnreadMessages` exactly as a BasicMessage does, with `seen` tracked in the record's metadata. A `reaction`, `redaction` or `timer` event never counts.
  - **Chat-list preview:** shows the last `message` ("📷 Photo" for an image, the text otherwise). In a chat with a timer it shows "Message" with no text.
- **Unified timeline:** `useChatMessagesByConnection` merges `BasicMessageRecord`s and `ChatEventRecord`s into one ordered list. Reactions, redactions and timer changes are folded in; only the timer change shows, as a system line.
- **Bubbles** (inside the existing gifted-chat custom renderers):
  - **Reactions:** a chip row under the bubble ("👍 2"). Long-press opens a quick bar of six emoji, a "+" that opens the picker, and **Reply**, **Copy** and **Delete for me**.
  - **Replies:** a quoted strip above the bubble; tapping it scrolls to the original.
  - **Images and GIFs:** React Native `<Image>` from the local file, with `resizeMethod="auto"`, and a full-screen viewer that supports pinch-zoom.
    - iOS animates GIFs natively.
    - Android needs Fresco's `animated-gif` artefact (version-matched to the Fresco already present) added in the app's Gradle file. That is part of React Native's own image stack, not a new JavaScript dependency.
- **Emoji picker:** our own component, reached from the composer and from "+" on the reaction bar.
  - **Data.** A script turns Unicode's `emoji-test.txt` (fully-qualified entries, grouped by category, Unicode version pinned) and the CLDR short names into a JSON data file checked into the repo. Each entry keeps the emoji version from its `E` field.
  - **Layout.** A sectioned grid with search and a "recent" row.
  - **What the picker offers.** It hides entries newer than what the operating system can draw, using a conservative table from OS version to maximum emoji version, keyed on `Platform.Version`.
- **Emoji validation:** a received `emoji` is valid only if it is an entry of the pinned set, compared after a length cap (32 UTF-16 code units) and after normalising minimally-qualified or unqualified forms to the fully-qualified one. An invalid reaction is dropped.
  - **Why exact membership.** Hermes on React Native 0.81 has no `Intl.Segmenter` and no RegExp `v` flag, and `\p{Extended_Pictographic}` matches single code points without checking sequences.
  - **Newer than the device can draw.** A valid reaction that is newer than the device can draw still shows as a chip, with its CLDR name as the accessible label and on long-press.
- **Composer:** the "+" action button gains **Camera** and **Photo library** next to the verifier's "Send proof request". Each chat's menu gains **Disappearing messages** and **Clear chat**. Settings gains **Keep messages**.
- **Safety:**
  - **Header checks before anything is written or rendered.** A received image's dimensions are read from its header in JavaScript: PNG IHDR, the GIF logical screen descriptor and frame count, JPEG SOF markers, and WebP `VP8`/`VP8L`/`VP8X`. That happens before the bytes are written or rendered. Images over 4096 px on a side or 16 megapixels are rejected, as are GIFs over a frames-by-area budget.
  - **What is accepted.** Only JPEG, PNG, GIF and WebP are accepted. HEIC is not, since senders produce only those four. Anything else, or any descriptor mismatch (§4.3), becomes "Unsupported attachment".
  - **Notifications and the in-app toast** show "📷 Photo", never image data.
- **Wake:** `messageWake.ts` and `InAppMessageNotifier` also listen for the new record's state-change event, and suppress previews in chats with a timer. These files belong to the message-notifications work (bifold #452 and #462), so the change is made together with it.

---

## 6. Steps

Each step ends with `cd bifold/packages/core && yarn test` and the root `yarn typecheck` green. From Step 1 on, it also ends with a two-device run in the e2e harness.

**Step 0 — Measure** (no app code)
- Send v1 and v2 messages with growing inline attachments, and record the largest raw attachment that round-trips through each of:
  - (a) the production Credo mediator;
  - (b) a local Affinidi mediator running the `deploy/keyring-messaging` config.
- Record what a wallet on today's release does when it receives `chat/1.0/event`, an unknown message type: problem report, silent drop or error. This decides how much the fallback (§4.5) leans on Discover Features being current.
- *Done when:* a dated companion records:
  - both ceilings;
  - the per-photo queue memory on both mediators;
  - the unknown-type behaviour;
  - §4.4's 256 KiB, confirmed or replaced.

**Step 1 — Message type, reactions and replies**
- **The protocol side:** the `chat/1.0` classes and handler, `ChatEventRecord`, the Discover Features advertisement, and the BasicMessage fallback with §4.5's re-query rule.
- **The chat screen:** the unified timeline, the long-press bar with six fixed emoji, quoted replies, Copy, and Delete for me.
- **Around the chat:** unread counting and the chat-list preview (§5), and the wake listener (§5, with the message-notifications work).
- *Done when:*
  - unit tests cover send, receive and folding for `message`, `reaction` and `redaction`, including:
    - a reaction that arrives before its target;
    - the held-buffer cap and expiry;
    - "change, then remove" delivered in reverse batches, resolving to removed;
    - a redaction from the wrong author, ignored;
    - a target from another connection, ignored;
  - unread tests show that a message counts and a reaction does not;
  - a Keyring↔Keyring two-device run sends text, adds a reaction, changes it, removes it and replies. It runs once over DIDComm v1 and once over DIDComm v2;
  - a build with the feature and a build without it exchange readable text both ways, with no raw JSON shown on either.

**Step 2 — Emoji picker**
- The build script, the data file, the picker component with the OS-version filter, and validation by membership, wired into the composer and the reaction bar.
- *Done when:*
  - the generated data file holds every fully-qualified emoji in the pinned Unicode version, with its version (a unit test compares the count against `emoji-test.txt`);
  - search finds 🐱 for "cat";
  - "❤" normalises to "❤️", and a two-emoji string is rejected;
  - on an Android 11 emulator, no entry newer than its table row is offered;
  - a reaction chosen from the picker reaches the peer.

**Step 3 — Inline photos and GIFs**
- **Sending:** camera and library pick, the resize-and-compress loop, and the GIF size check.
- **Storing:** attachment files on disk with §5's protection and backup settings.
- **Showing:** the header checks, image bubbles, the full-screen viewer, and Android animated-GIF support.
- *Done when:*
  - a photo taken on device A shows on device B, through the production Credo mediator. The run through the Affinidi mediator is added once #530's M1 is live; Step 3 is done without it, and the plan records which mediators were covered;
  - a GIF animates on iOS and on Android;
  - a unit test asserts that a photo carrying GPS EXIF comes out of the encoder with no EXIF;
  - an attachment of exactly the limit is sent, and one byte over is refused on the sender, never sent;
  - a descriptor whose `byteCount`, `width`, `height` or `mediaType` does not match the bytes is rejected;
  - an image declaring dimensions over the cap is rejected;
  - a non-image is shown as "Unsupported attachment";
  - a check on each platform shows the media folder's protection and backup exclusion are in place:
    - iOS: the protection class and the backup-exclusion flag on a written file;
    - Android: the extraction rules, with an `adb` backup or transfer test showing the folder is absent.

**Step 4 — Message history and disappearing messages**
- **Local controls:** Clear chat, Keep messages and its sweep, and removing a contact deleting its chat history and media.
- **Disappearing messages:** the `timer` event and per-message `expiresIn`, the expiry sweep, preview suppression, the `chat/1.0` requirement and its prompt, and the setting's wording (§4.6).
- *Done when:*
  - unit tests cover:
    - timer races resolved by `version` then `eventId`;
    - a message keeping the `expiresIn` it was sent with after a later timer change;
    - the recipient's clock starting at first display;
    - a reply showing "Original message expired";
  - the sweep deletes the record, its reactions and its media file, shown by a test that the file is gone;
  - a two-device run sets a timer on one phone; the other phone shows the system line, and a read message disappears on both phones after the interval;
  - the timer cannot be turned on for a build without `chat/1.0`, and removing a contact leaves no chat records or media behind.

Steps 1 and 2 are useful on their own and can ship before Step 3. Step 4's local controls (Clear chat, Keep messages, contact removal) do not depend on Step 3 and can ship earlier.

---

## 7. Decisions and blockers

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Is this minimum (reactions, replies, emoji picker, inline photos/GIFs, history controls) the target? | Yes | Step 1 |
| D2 | Is it acceptable for compressed photos to pass through the mediator's encrypted queue, as text already does? The mediator holds ciphertext it cannot read, for at most 7 days until pickup, and the bytes it holds per queued message grow up to 256 KiB (§4.4). | Yes, once the mediator operator accepts the measured worst case; this is the same position the app is in for every text message today | Step 3 |
| D3 | Namespace and profile name: Keyring's own (`keyring.chat/1`), or adopt the rooms name (`org.openvtc.msg/1`)? | Keyring's own, shaped to match, offered upstream once Step 1 proves it | Step 1 |
| D4 | When does a disappearing message's clock start? | As in Signal: the sender's copy at send, the recipient's at first display, so nothing disappears unread | Step 4 |
| D5 | Should timed messages also shorten the mediator queue (the DIDComm v2 `expires_time` header)? | No. The queue holds only ciphertext for at most 7 days; shortening it would drop undelivered messages instead of expiring read ones | Step 4 |

**Blocked on:**

| What | Owner | Effect |
|---|---|---|
| The worst-case queue size for photos (D2) | The mediator operator | Step 3 does not ship until the measured worst case is accepted |
| The wake and preview changes (§5, "Wake") | The message-notifications work | Made together with it; it does not block Steps 1–2 |
| The Affinidi mediator run in Step 3 | The mediator migration (#530, M1 → M5, no date) | Step 3 can be done on the Credo mediator alone, with the Affinidi run added when M1 is live |
| Keeping non-content events from waking the phone (§4.2) | The peer-message-notifications work | This plan adopts its answer; it does not block any step |

---

## 8. Large media: the future path, and what rules out the alternatives

Videos, documents and full-resolution photos need bytes to live **outside** the message, which means someone stores them. These options exist, and none is taken now:

- **A Keyring-run file store or cloud bucket** (the Signal/WhatsApp model) is ruled out by the no-hosting goal (G5). Running one brings storage cost, retention, abuse handling and legal duties, even though it would only ever see ciphertext.
- **Hosting on the sender's own VTA** is not possible with what VTAs offer today (pin `49f5f1be`):
  - VTA app-state is JSON only, capped at 64 KiB per record (`MAX_VALUE_BYTES = 65_536`, `vta-service/src/operations/app_state.rs`), and has **no blob member by design**: "1.0 has no blob member at all … [the cap] is what keeps a consumer from quietly treating `value` as a blob store" (`docs/05-design-notes/appstate-store.md`).
  - No grant scoped to a peer exists. Giving a peer read access means an admin adding them to the ACL for a whole context, with write access too, since "a namespace in 1.0 is collision avoidance, **not** a trust boundary" (`appstate-store.md`). There is no share link.
  - Not every Keyring user has a VTA. The Farm path is "optional and additive" (`docs/plans/keyring-on-the-vta-farm.md` on `origin/main`).
- **Data rooms** are hosted by a VTC or the `room-host` binary, and the room host "is not part of the VTA, on purpose" (`docs/02-vta/data-rooms.md`). Their blob layer is a design in Keyring's own rooms subtask that "**does** need an upstream spec" (`rooms_group_messaging_subtask.md` §1). Bytes would still sit with whoever runs the host.
- **Splitting media into many messages** through the mediator would let a video arrive in pieces. It turns the mediator into a file store by the back door, fills the queue caps (200 soft, 1,000 hard per DID on Affinidi) and costs every pickup. Rejected.

**The path that fits the no-hosting goal** is upstream: an app-state `blobRef` (a MINOR addition the VTI design note leaves open, `appstate-store.md`) together with a peer-scoped read grant, or the rooms blob layer. Either one would put a user's media on infrastructure the *user* chose, at the cost and under the terms of that operator. Keyring would then add a link-based attachment variant (§4.3). Until one of those exists upstream, large media stays out of scope.
