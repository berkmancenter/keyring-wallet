# Rich Messaging — Plan

**Status:** Proposed. Nothing here is built.
**Scope:** The smallest set of changes that makes one-to-one Keyring chat feel like a modern messenger: **reactions, quoted replies, an emoji picker, and photos and GIFs small enough to travel inside a message**. Nothing in this plan needs a server, a file store or new hosting of any kind. Large media (video, files, full-resolution photos) and group chat are **out of scope** (§2, §8).
**Companions:** [`rich-messaging-plan/2026-10-21-al.md`](./rich-messaging-plan/2026-10-21-al.md) — research findings (current code, what the protocols allow, how Signal/WhatsApp/Matrix move media, whether a VTA can host media) and the options weighed, including the hosted design this plan replaced.
**Related plans:** [`openvtc-rooms-plan/rooms_group_messaging_subtask.md`](./openvtc-rooms-plan/rooms_group_messaging_subtask.md) (on `origin/main`) — group messaging on VTI data rooms; this plan reuses its event vocabulary. The mediator migration plan (wallet PR #530, in review) — moves Keyring↔Keyring mailboxes to the Affinidi mediator (M1 → M5, no date yet), which sets the 1 MiB message ceiling this plan designs against. [`rcard-profile-picture-plan.md`](./rcard-profile-picture-plan.md) — the existing image-over-DIDComm precedent. The community messaging plan (`community-messaging-plan.md`, draft, not yet in a PR) — owns the community layers (rooms through room offers, directory introductions, the group-chat decision); **this plan owns one-to-one chat**, and that plan's one-to-one section points here.
**Baseline:** bifold `783cadfb`, wallet `origin/main` `e5a72c8`. Upstream is read from the pinned `external/` clones: affinidi-tdk-rs `a1611baa`, dtgwg-trust-tasks-tf `7b6bb488`, verifiable-trust-infrastructure `49f5f1be`.

---

## 1. Summary

Today a Keyring chat message is **one plain-text string** sent as a DIDComm BasicMessage. Emoji work because they are Unicode text; nothing else does. Credo's BasicMessage (1.0 and 2.0) has no attachment field in its API, message class or record, and no DIDComm standard defines reactions.

The plan adds four things, all carried by the messages we already send through the mediator we already use:

1. **A Keyring chat message type** (`keyring/chat/1.0`), built like `TrustTaskMessage`. It is the one protocol change, and everything else rides on it.
2. **Reactions and quoted replies**, as events in that message type.
3. **Our own emoji picker**, built from Unicode's emoji list, with no runtime dependency.
4. **Inline photos and GIFs up to 256 KiB.** Photos are resized and compressed on the phone, then sent inside the message itself. The DIDComm envelope already encrypts them end to end, exactly like text today.

**What it deliberately does not do:** host media anywhere. Nothing is uploaded to a Keyring server, a cloud bucket or a VTA. Media exists only inside an encrypted message and on the two phones. That is why videos, documents and full-resolution photos wait (§8).

---

## 2. Goals and non-goals

**Goals**
- G1. React to any message with an emoji, change or remove the reaction, and see the peer's reactions.
- G2. Reply to a specific message, with the quoted original shown above the reply.
- G3. Pick emoji from a proper picker (categories, search, recent), in messages and reactions.
- G4. Send and receive photos and animated GIFs that fit in a message, between two Keyring wallets.
- G5. **No hosting:** no new server, store or infrastructure, and no new place where user media rests other than the two phones and the mediator's existing encrypted queue.
- G6. Works on today's Credo mediator **and** after the Affinidi mediator migration.
- G7. Mixed fleets degrade cleanly: an older wallet still gets readable text.

**Non-goals**
- **Videos, documents and full-resolution photos.** They do not fit in a 1 MiB message, and every way to move them needs storage that someone hosts (§8).
- **Group chat.** It belongs to the rooms subtask.
- **Third-party GIF search** (Giphy, Tenor). It sends users' search terms to a third party and needs an API key in the app. GIFs come from the phone.
- **Edits, delete-for-everyone, read receipts and typing indicators.** The event format leaves room for them (§4.2), but they are not part of the minimum.

---

## 3. Current state

All references are at bifold `783cadfb` unless marked. The companion carries the full survey.

| Area | What exists | Where |
|---|---|---|
| Chat UI | `react-native-gifted-chat` ~3.3.2, fully custom-rendered bubbles; no image rendering; links are tappable | `packages/core/src/screens/Chat.tsx:216-238`, `components/chat/ChatMessage.tsx:294-316` |
| Send | Text only: `basicMessages.sendMessage(connectionId, messages[0].text)` | `Chat.tsx:160` |
| Storage | `DidCommBasicMessageRecord { content: string, … }`; our `seen` flag lives in metadata | `types/metadata.ts:10-16` |
| Display filter | Any `content` that parses as JSON with a `type` is **hidden** from chat and from the unread count, because VRC code sends protocol JSON through BasicMessage | `hooks/chat-messages.tsx:677-743`, `hooks/useUnreadMessages.ts:8-28` |
| Custom message precedent | `TrustTaskMessage` carries a JSON attachment and is registered through `DidCommMessageHandlerRegistry` | `packages/trust-tasks/src/TrustTaskMessage.ts:58-77`, `packages/core/src/modules/trust-tasks/module/TrustTasksModule.ts:46-53` |
| Wake and notifications | Contentless push, then pickup, then open the chat; listens for BasicMessage state changes only. Owned by the message-notifications work (bifold #452, #462); changes here are coordinated with it | `packages/core/src/utils/messageWake.ts`, `components/InAppMessageNotifier.tsx`, `utils/activeChatTracker.ts` |

**Already in the app, so no new dependency is needed:** `expo-image-picker`, `expo-image-manipulator` (resize, compress and strip EXIF), `react-native-vision-camera`, `react-native-fs`, and `react-native-gesture-handler` (pinch-zoom). iOS already declares the camera and photo-library usage strings (`app/ios/AriesBifold/Info.plist:93-103`).

---

## 4. Protocol: `keyring/chat/1.0`

### 4.1 Message type and carriage

- One DIDComm message type, `https://keyring.berkmancenter.org/chat/1.0/event` *(exact URI: D3)*, carrying a **chat event** as a JSON attachment with id `chat-event`. It copies the `TrustTaskMessage` pattern: a `DidCommMessage` subclass, `static type = parseMessageType(...)`, `DidCommAttachmentData({ json })`, registered through `DidCommMessageHandlerRegistry`. A DIDComm v2 class mirrors it the way `DidCommV2Carriage` does for Trust Tasks.
- The event JSON is independent of how it is carried, so it can later travel as a TSP payload unchanged.
- **Not JSON inside BasicMessage `content`.** The display filter in §3 hides exactly that shape, non-Keyring peers would show raw JSON, and BasicMessage records cannot be indexed by event type.
- **Not a Credo patch to BasicMessage.** Credo's base message class keeps `~attach` on the wire, but the BasicMessage handler and record drop it. Patching that gives Keyring-only behaviour to a standard type, which other peers would silently lose, and the patch would have to be carried through the Credo 0.7 upgrade.
- **Not Trust Tasks `chat/message 0.1`** (`external/dtgwg-trust-tasks-tf/specs/chat/`). That spec is for an AI agent talking to a messaging bridge: every message is signed and hash-chained to the previous one for audit. That is the wrong cost and the wrong semantics for person-to-person chat.

### 4.2 Event body

The body follows the rooms subtask's `org.openvtc.msg/1` event (§5.3 there), so one-to-one and future group chat share one vocabulary. The fields that only make sense inside a room (`via`, record-key checks, `sig` inside the seal, padding buckets) are left out, because the pairwise envelope already authenticates the sender. **That subtask is itself a draft** ("Nothing here is built, and it is not a commitment to implement"). This plan matches its shape but does not depend on it: the profile name is Keyring's own (D3), so if the rooms shape changes, one-to-one chat keeps working and the two are reconciled when room chat is built.

```jsonc
{
  "profile": "keyring.chat/1",        // D3
  "type": "message",                  // message | reaction | redaction
  "eventId": "01JB…",                 // ULID, generated by the sender
  "clientTs": "2026-10-21T14:03:00Z", // display only, never trusted
  "inReplyTo": "01JA…",               // optional: quoted reply
  "content": { "format": "text/plain", "text": "look at this 🐱" },
  "attachments": [ /* §4.3, type "message" only */ ],
  "target": "01JA…",                  // reaction and redaction only
  "emoji": "👍"                        // reaction only: exactly one grapheme cluster
}
```

- **Reaction** = a `reaction` event with `target` and `emoji`. Each person has at most one reaction per message, and a new one replaces the old one, as in WhatsApp and Signal.
- **Removing a reaction** = a `redaction` whose `target` is the reaction's `eventId`. This is the Matrix and rooms-subtask model.
- **Quoted reply** = a `message` with `inReplyTo`. If the quoted message is not on this device (deleted, or from before the upgrade), the bubble shows "Original message not available".
- **Notifications.** A reaction never produces a notification or toast of its own; it appears on the bubble the next time the chat is open. Whether a reaction's arrival wakes the phone at all is a mediator question: today the mediator rings the push gateway for any queued message, and the gateway rings at most once every 30 seconds. Keeping non-content events (reactions, and receipts if they are ever added) from waking the phone is an open question owned by the peer-message-notifications work, and this plan adopts its answer.
- **Ordering** follows local receive order, with `clientTs` used only for display. A reaction or redaction that arrives before its target (possible across pickup batches) is held and applied when the target arrives.
- **Later types** (`edit`, delete-for-everyone as a `redaction` of a message, delivered and read receipts, typing indicators) slot into the same `type` field without changing what already exists.
- **Interop note.** Affinidi Meeting Place's `meeting-place-chat/1.0` uses a different vocabulary (`message`, `delivered`, `reaction`, `chat-activity`). If Meeting Place interop is wanted later, it is a mapping between the two shapes, not a constraint on this one.

### 4.3 Inline attachment

```jsonc
{
  "id": "a1",
  "mediaType": "image/jpeg",          // checked against the bytes on receive, never trusted alone
  "filename": "IMG_0412.jpg",
  "byteCount": 184113,
  "width": 1600, "height": 1200,
  "data": { "base64": "<the image bytes>" }
}
```

- **No per-file key.** The DIDComm envelope already encrypts the whole message end to end, the same protection text has today. A separate key only becomes necessary when bytes travel outside the envelope, and this plan never does that.
- The descriptor follows RFC 0017's `data.base64` shape. A future link-based variant would add a different `data` form and a `cipher` field. That is an additive change, not a breaking one.

### 4.4 Size limit

**One message, including its attachments, stays under 256 KiB of raw bytes.** The ceiling that matters is the Affinidi mediator's `message_size = 1_048_576` (`external/affinidi-tdk-rs/…/affinidi-messaging-mediator/src/common/config/limits.rs`; `deploy/keyring-messaging/mediator/mediator.toml:117-134` on `origin/main`), not today's 5 MB Credo HTTP limit (`@credo-ts/node/.../DidCommHttpInboundTransport.mjs:19`). The image is base64'd into the attachment and then base64url'd again inside the JWE, so 1 MiB holds about 560 KiB of raw bytes before JSON and forwarding overhead. 256 KiB leaves headroom, and it keeps the pickup batches of up to 10 messages light on mobile networks. **This figure is an estimate until Step 0 measures it.**

**Effect on the mediator's queue.** The mediator's queue limits count messages, not bytes: on Affinidi, `queued_send_messages_per_peer = 50` and `queued_receive_messages_soft/hard = 200/1000` (`deploy/keyring-messaging/mediator/mediator.toml:127-131`, enforced through `limits.queue.peer` / `PEER_Q`, see `docs/VTI_UPSTREAM_FINDINGS.md`). Photos therefore reach those gates no sooner than text does, though a burst of photos counts one message each against the 50-per-peer cap. What grows is **bytes held**: at the hard cap, 1,000 queued messages of 256 KiB is about 256 MiB for one recipient, against a few hundred KiB for text. On the Affinidi mediator that sits in its store until pickup or the 7-day expiry. A pickup batch of 10 such messages is about 2.5 MiB raw (roughly 4.5 MiB on the wire), inside the 10 MiB `ws_size`/`http_size` frame limits. The contentless push wake is unaffected by size. Step 0 measures queue memory per queued photo on both mediators, and the mediator operator signs off on the worst case before Step 3 ships (D2).

**What fits:**
- **Photos:** resized to 1600 px on the long edge and re-encoded as JPEG with `expo-image-manipulator`, stepping quality down (0.8 → 0.6 → 0.4) until the result fits. A typical phone photo lands at 150–250 KiB. Re-encoding also strips EXIF, including GPS. If a photo still does not fit at the lowest step, it is resized further.
- **GIFs:** sent as they are, because re-encoding would lose the animation. A GIF over the limit is refused with "This GIF is too large to send". Many reaction GIFs fit; long ones do not.
- **Several photos** in one send become several messages.

### 4.5 Capability check and fallback

- Each wallet advertises `keyring/chat/1.0` through Discover Features (Aries RFC 0031 / 0557, already in Credo). The answer is cached per connection and re-queried when it is missing or older than the app version.
- **Peer supports it:** send `chat/1.0/event`.
- **Peer does not:** send a plain BasicMessage. Text goes as it is. A photo goes as "📷 Photo — update Keyring to see it". A reply goes as its text. Reactions are **not sent**, because a stream of "reacted 👍" messages is worse than nothing.
- Receivers accept both, and existing BasicMessages keep rendering exactly as today.

---

## 5. Client changes

- **Module** `packages/core/src/modules/chat/` (new): the message classes (v1, v2), the handler, a `ChatEventRecord` and its repository, and a `ChatService` that sends, receives, folds reactions into their targets and chooses the fallback.
- **Record:** `ChatEventRecord { eventId, connectionId, role, type, content?, attachments?, target?, emoji?, inReplyTo?, sentTime }`, tagged by `connectionId`, `type` and `target`. Image bytes are written to a file under the app's documents directory, one folder per connection and deleted with the connection, and the record keeps only the path. Large base64 strings never stay in the wallet store or in React state.
- **Unified timeline:** `useChatMessagesByConnection` merges `BasicMessageRecord`s and `ChatEventRecord`s into one ordered list. Reactions and redactions are folded into their targets, never shown as bubbles.
- **Bubbles** (inside the existing gifted-chat custom renderers):
  - **Reactions:** a chip row under the bubble ("👍 2"). Long-press opens a quick bar of six emoji, a "+" that opens the picker, and **Reply** and **Copy**.
  - **Replies:** a quoted strip above the bubble; tapping it scrolls to the original.
  - **Images and GIFs:** React Native `<Image>` from the local file, with a full-screen viewer that supports pinch-zoom. iOS animates GIFs natively. Android needs Fresco's animated-GIF support turned on in the app's Gradle file; that is part of React Native's own image stack, not a new JavaScript dependency.
- **Emoji picker:** our own component. A script turns Unicode's `emoji-test.txt` (fully-qualified entries, grouped by category) and the CLDR short names into a JSON data file checked into the repo. The component is a sectioned grid with search and a "recent" row. It is reached from the composer and from "+" on the reaction bar.
- **Composer:** the "+" action button gains **Camera** and **Photo library** next to the verifier's "Send proof request".
- **Safety:** a received image is only rendered after its first bytes match JPEG, PNG, GIF, HEIC or WebP. Anything else becomes "Unsupported attachment". Notifications and the in-app toast show "📷 Photo", never image data.
- **Wake:** `messageWake.ts` and `InAppMessageNotifier` also listen for the new record's state-change event. These files belong to the message-notifications work (bifold #452, #462), so that change is made together with it.

---

## 6. Steps

Each step ends with `cd bifold/packages/core && yarn test` and the root `yarn typecheck` green. From Step 1 on, it also ends with a two-device run in the e2e harness.

**Step 0 — Measure** (no app code)
- Send v1 and v2 messages with growing inline attachments through (a) the production Credo mediator and (b) a local Affinidi mediator running the `deploy/keyring-messaging` config, and record the largest raw attachment that round-trips.
- Record what a wallet on today's release does when it receives `chat/1.0/event`, an unknown message type: problem report, silent drop or error. This decides how much the fallback (§4.5) leans on Discover Features being current.
- *Done when:* a dated companion records both ceilings, the per-photo queue memory on both mediators, and the unknown-type behaviour, and §4.4's 256 KiB is confirmed or replaced.

**Step 1 — Message type, reactions and replies**
- `chat/1.0` classes, handler, `ChatEventRecord`, Discover Features advertisement, BasicMessage fallback, unified timeline, the long-press bar with six fixed emoji, quoted replies, and Copy.
- *Done when:*
  - unit tests cover send, receive and folding for `message`, `reaction` and `redaction`, including a reaction that arrives before its target;
  - a Keyring↔Keyring two-device run sends text, adds a reaction, changes it, removes it and replies;
  - a build with the feature and a build without it exchange readable text both ways, with no raw JSON shown on either.

**Step 2 — Emoji picker**
- The build script, the data file and the picker component, wired into the composer and the reaction bar.
- *Done when:* the generated data file holds every fully-qualified emoji in the pinned Unicode version (a unit test compares the count against `emoji-test.txt`); search finds 🐱 for "cat"; a reaction chosen from the picker reaches the peer.

**Step 3 — Inline photos and GIFs**
- Camera and library pick, the resize-and-compress loop, the GIF size check, attachment files on disk, image bubbles, the full-screen viewer, and Android animated-GIF support.
- *Done when:*
  - a photo taken on device A shows on device B, through both mediators;
  - a GIF animates on iOS and on Android;
  - a unit test asserts that a photo carrying GPS EXIF comes out of the encoder with no EXIF;
  - a message whose attachment is over the limit is refused on the sender, never sent;
  - a received attachment whose bytes are not an image renders as "Unsupported attachment".

Steps 1 and 2 are useful on their own and can ship before Step 3.

---

## 7. Decisions needed

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Is this minimum (reactions, replies, emoji picker, inline photos/GIFs) the target? | Yes | Step 1 |
| D2 | Is it acceptable for compressed photos to pass through the mediator's encrypted queue, as text already does? The mediator holds ciphertext it cannot read, for at most 7 days until pickup, and the bytes it holds per queued message grow up to 256 KiB (§4.4). | Yes, once the mediator operator accepts the measured worst case; this is the same position the app is in for every text message today | Step 3 |
| D3 | Namespace and profile name: Keyring's own (`keyring.chat/1`), or adopt the rooms name (`org.openvtc.msg/1`)? | Keyring's own, shaped to match, offered upstream once Step 1 proves it | Step 1 |

Nothing is blocked on anyone outside the project.

---

## 8. Large media: the future path, and what rules out the alternatives

Videos, documents and full-resolution photos need bytes to live **outside** the message, which means someone stores them. These options exist, and none is taken now:

- **A Keyring-run file store or cloud bucket** (the Signal/WhatsApp model) is ruled out by the no-hosting goal (G5). Running one brings storage cost, retention, abuse handling and legal duties, even though it would only ever see ciphertext.
- **Hosting on the sender's own VTA** is not possible with what VTAs offer today (pin `49f5f1be`):
  - VTA app-state is JSON only, capped at 64 KiB per record (`MAX_VALUE_BYTES = 65_536`, `vta-service/src/operations/app_state.rs:93`), and has **no blob member by design**: "1.0 has no blob member at all … [the cap] is what keeps a consumer from quietly treating `value` as a blob store" (`docs/05-design-notes/appstate-store.md:237-242`).
  - No grant scoped to a peer exists. Giving a peer read access means an admin adding them to the ACL for a whole context, with write access too, since "a namespace in 1.0 is collision avoidance, **not** a trust boundary" (`appstate-store.md:327-331`). There is no share link.
  - Not every Keyring user has a VTA. The Farm path is "optional and additive" (`docs/plans/keyring-on-the-vta-farm.md` on `origin/main`).
- **Data rooms** are hosted by a VTC or the `room-host` binary, and the room host "is not part of the VTA, on purpose" (`docs/02-vta/data-rooms.md:35, 493`). Their blob layer is a design in Keyring's own rooms subtask that "**does** need an upstream spec" (`rooms_group_messaging_subtask.md` §1). Bytes would still sit with whoever runs the host.
- **Splitting media into many messages** through the mediator would let a video arrive in pieces. It turns the mediator into a file store by the back door, fills the queue caps (200 soft, 1,000 hard per DID on Affinidi) and costs every pickup. Rejected.

**The path that fits the no-hosting goal** is upstream: an app-state `blobRef` (a MINOR addition the VTI design note leaves open, `appstate-store.md:237-242`) together with a peer-scoped read grant, or the rooms blob layer. Either one would put a user's media on infrastructure the *user* chose, at the cost and under the terms of that operator. Keyring would then add a link-based attachment variant (§4.3). Until one of those exists upstream, large media stays out of scope.
