# Rooms member sprint: join, list, download, post

Subtask of [`../openvtc-rooms-plan.md`](../openvtc-rooms-plan.md). Draft. Reasoning for the
re-baseline and for the review round of PR #661 (existing rooms module, persona signing, delivery
leg, message vocabulary, test host) is in
[`2026-10-26-bam-rebaseline.md`](2026-10-26-bam-rebaseline.md).

**This is the first chunk of rooms work.** Keyring ships at least this much room functionality:
join a data room, list its most recent content, download an attachment, post a message or a
file. It narrows R0–R3 of the parent plan to one deliverable for `open` and `attributed` rooms,
measured against VTI `main` at `fc157f76` (2026-10-26). Everything else in the parent plan
follows after it.

Join is by **community offer** today. The join path is built behind a single entry point so a
join link or QR can be added later without reworking the consent and accept screens (see
"Join entry points").

Out of scope: owner and host operation, agent grants (R4), owner lifecycle (R5), threads,
edits, reactions and redactions beyond display, disappearing timers, real-time delivery,
`private` tier, one-to-one chat (see `rich-messaging-plan.md`).

**Built on unmerged work.** The wallet already has a rooms module in draft (next section). All of
it is unmerged, and the sprint's service-layer stories extend it. Alberto owns PRs #595-#602, and
build 272's final pin is the gate for merging them and for any change to `components/chat/`.

## What changed upstream since the parent plan

1. `rooms/blobs/*` **exists** (`get` 0.1/0.2, `chunk` 0.1, `upload/{begin,chunk,commit,abort}` 0.2),
   with `rooms/records/put` 0.2 carrying `blobs:[blobRef]`. The parent plan and the
   group-messaging subtask say it needs an upstream spec; that is no longer true.
2. `vtc/rooms/offers/{list,accept}` exist (list 0.1–0.3; accept 0.1), so a community-offered join
   is a real, supported path.
3. `rooms/records/list` 0.3, `rooms/keys/file-key/0.2` and `rooms/keys/act` 0.1–0.6 are current.
   `act/0.3` completes `vtc/rooms/offers/list` and `offers/accept` with no presentation (only the
   persona's authentication key). `act`'s table is closed: `rooms/records/put` is completable
   only at 0.1 and 0.2, not 0.3, and the `rooms/blobs/upload/{begin,get,chunk,commit,abort}`
   calls are in it. `rooms/records/put/0.3` adds provenance and expiry for open rooms, so those
   fields are unavailable through `act`.
4. `vta-mobile-core` (UniFFI) exists upstream but contains no rooms code.
5. The owner's MLS half is served: `rooms/owner/group/{create,add,remove,renew}` on the owner's
   VTA. A sealed-room join needs an owner VTA, or a community offer where the VTC does the add.
6. `pnm rooms put` seals on sealed rooms (`rooms/keys/seal/0.2` with `signAsPrincipal`).
   `rooms/keys/write` remains a proposal; the two-call seal-then-put is the real path.
7. `vtc/rooms/memberships/list` shows where each admission stands, and is the upstream record
   for the wallet's Rooms list.

Source for everything below: `docs/02-vta/data-rooms.md`, `docs/03-vtc/community-rooms.md`,
`docs/05-design-notes/data-rooms-files.md` in `verifiable-trust-infrastructure` at `fc157f76`.

## The existing rooms module this sprint extends

keyring-bifold carries a rooms module in **draft PRs, all unmerged**, owned by Alberto. #595
states "not for merge until 272's final pin".

| PR | Contents | State |
|---|---|---|
| #595 | `RoomsService` interface, capabilities and sample (`packages/core/src/modules/rooms/types.ts:311-351`): `capabilities`, `listMyRooms`, `getRoom`, `roomCapabilities`, `listNotes`, `readNote`, `prepareWrite`, `confirmWrite(token)`, `curate`, `listOffers`, `previewOffer`, `acceptOffer(token)`, `hideOffer`, `listFiles`, `openFile`, `releaseFile`, `listCommunityMembers`, `listAgentAccess`, `grantAgentAccess`, `withdrawAgentAccess`, `leaveViaCommunity`. Writes and accepts are two-step, with 10-minute preview tokens. Each capability is `available`, `comingSoon` or `unavailable`, discovered at runtime through the agent's `trust-task-discovery/0.1` | draft |
| #600 | `AgentRoomsService`, stacked on #595. `listMyRooms` joins the VTC's `memberships/list` with the agent's `rooms/keys/list`; `listNotes` and `readNote` use `rooms/keys/browse` and `read`; leave is a self-remove. Writes, offers, files and agent access report `clientNotBuilt`. **Not live-proven**: "no lab VTC serves it yet"; it stays draft until one lab call passes | draft |
| #597 | R1 feature flag | draft |
| #601 | R2 entry from My Agent | draft |
| #602 | R3 room screen; held until build 272's final pin | draft, held |
| #433 | preview and `nav-communities` | draft |

Wallet PRs: #645 (companion `docs/plans/openvtc-rooms-plan/2026-10-25-al.md`, the source of the
persona-over-DIDComm design below) and #642 (rooms sample data is excluded from builds that do
not set `ROOMS_SAMPLE`).

**Naming.** bifold's R0-R3 are screen-stack names. This plan's R0-R3 are phases (measurement,
read-only, invitations, write and curate). The two do not correspond.

**The sprint extends this module and adds no second layer.** The service-layer stories fill the
methods #600 reports as `clientNotBuilt`: offers and accept (S1), writes (S4), blobs (S3 and S4).
Each new method lands on `RoomsService` / `AgentRoomsService`, and reports its capability through
the existing discovery.

| Method group | #600 state | Sprint story |
|---|---|---|
| `listMyRooms`, `listNotes`, `readNote`, `leaveViaCommunity` | built, not live-proven | S0.3 lab call, S2 |
| `listOffers`, `previewOffer`, `acceptOffer`, `hideOffer` | `clientNotBuilt` | S1 |
| `prepareWrite`, `confirmWrite`, `curate` | `clientNotBuilt` | S4 |
| `listFiles`, `openFile`, `releaseFile` | `clientNotBuilt` | S3 |
| agent access, `listCommunityMembers` | `clientNotBuilt` | out of scope (R4) |

## Architecture decision this sprint rests on

**The wallet holds no room credential (VMC, VAC, VIC) and no MLS group key; the member's linked
VTA does** (parent plan §2.2 item 1 and §3.3). A wallet with no linked VTA cannot use rooms (Q2).

**The phone does hold the persona's signing key, lent by the VTA, in memory only.** Per the #645
design the phone borrows the persona's signing and key-agreement keys (`VtaClient.borrowKey`
(about line 2292) over `keys/export-secret` into the in-memory `EPHEMERAL_KMS_BACKEND`;
`ensurePersona` per community; `vtiAgent.ts` about lines 943-955, `tspSessionForPersona`) and
signs community tasks over DIDComm through the mediator. `communityTask` (`vtiAgent.ts:1790`) is
the same `ask()` path as join and leave.

| Call | Signed by | Why |
|---|---|---|
| `vtc/rooms/memberships/list/0.1` | the phone, as the persona (#600) | community-scoped read |
| `vtc/rooms/offers/list` | the phone, as the persona, once built (S1) | `act/0.3` completes it with only the persona's authentication key; the VTC checks that the signer is the member and an active member |
| `vtc/rooms/offers/accept` with no `keyPackage` | the phone is feasible (**inferred**: same `act/0.3` completion; not read for an accept without a package) | |
| `vtc/rooms/offers/accept` carrying a `keyPackage` | the VTA, through `rooms/keys/act` | completed only if the VTA minted that package (`keyPackageNotHeld`) |
| seal, `file-key`, sealed puts, every `rooms/records/put` and every `rooms/blobs/*` call | the VTA, through `rooms/keys/act` | the VTA inserts the persona's presentation (VMC and a narrowed VAC); the persona key alone is not enough for a room write |

#600 signs only `memberships/list`; `offers/list` and `offers/accept` are the next phase and are
built in S1.

**Security trade-off, as standing rationale.** `rooms/keys/act` exists so that a client holds none
of the persona's keys (header of `vta-service/src/trust_tasks/room_act.rs` in VTI). Lending the
key to the phone (`VtaClient.borrowKey`) gives that up for the persona's signature. The plan
accepts it only for community-scoped reads and offers, where it removes a VTA round trip per
poll, and uses it for nothing else.

Target tiers: `open` and `attributed`. `private` is refused by hosts today.

## Limits that shape the scope

| Limit | Value | Source / configurable |
|---|---|---|
| Text record, VTC | 64 KiB whole Trust Task document, **including** the presentation (VMC + up to 8 VACs). Usable body is noticeably less; measure it in S0 | `vtc-service/src/trust_tasks/size.rs`; per-spec `maxDocumentBytes` |
| Text record, room-host | No cap of its own beyond axum's 2 MiB default (stated in the guide, not tested) | `docs/02-vta/data-rooms.md:934` |
| Sealed overhead | 12-byte nonce + 16-byte tag, base64url ≈ 1.33× | `vti-rooms/src/sealed.rs` |
| Record key, body length | No code cap found | the practical cap is document size |
| Sealed record keys | must be opaque: 16 random bytes, base64url (22 chars) | `SealedRoom::opaque_key` |
| File size | default **100 MiB per file** (room and member), host ceiling 1 GiB | room-host `--max-file-bytes`; VTC `[rooms.files]`, `vtc/rooms/limits/set` |
| File count / bytes | room 10,000 files / 5 GiB; member 2,000 files / 1 GiB | same flags |
| Transfer chunk | 16–256 KiB (default 256 KiB), max 4096 chunks; chunk document ≈ 350 KiB | `vti-rooms/src/files.rs` |
| File types | **No allow or deny list.** `mediaType` is an unverified claim inside the sealed body; filenames are untrusted | client must sniff and sanitize |
| List page | max 500, ascending by version, no newest-first | `MAX_PAGE` in `vti-rooms/src/storage.rs` |
| Rate limits (VTC) | per (room, presenter) burst 120, 1 per 100 ms; chunks burst 200, 1 per 20 ms; 429 with `Retry-After` | `[rooms.rate_limits]` |
| Document freshness | `issuedAt` within 600 s (+60 s skew); document ids are single-use | `vti-common/.../acceptance.rs` |
| Chunk throttle | "a chunk on a transport that charged no room budget" falls under `LargeDocumentBudget`: 5 raised-limit documents per minute per address. Whether DIDComm chunks hit it is **unproven** (S0.8) | `vtc-service/src/trust_tasks/size.rs` about lines 357-360 |
| DIDComm message size | mediator default `message_size` 1 MiB; a 256 KiB chunk (about 350 KiB encoded) fits (**inferred, untested**, S0.9) | mediator configuration |

Caveat: the spec-level `maxDocumentBytes` for `rooms/records/put` lives in `trust-tasks-rs`
0.34.1, which was not available locally. Treat the 64 KiB figure as the VTC default, not the
spec's final word, until S0 measures it.

Product caps for the wallet (smaller than host limits, raiseable later): text body
**16384 UTF-16 code units**, attachment **25 MiB**, one attachment per post. No type restriction
at upload. Download previews only for sniffed images; everything else goes to the share sheet
(`expo-sharing`). The text cap equals chat's `keyring.chat/1` limit; it is a count of code units,
not bytes. The group-messaging subtask says 32 KiB; this plan uses chat's number. Alberto's review
of #661 accepts the caps as a starting point.

## Message format: `keyring.chat/1`

Room messages use the chat module's vocabulary (`bifold/packages/core/src/modules/chat/chatEvent.ts`),
not a wallet-owned shape. Chat events are `message`, `reaction`, `redaction` and `timer`.

| Field | Rule |
|---|---|
| `eventId` | ULID; equals the room record key (below) |
| `clientTs` | display only; never used for ordering (the host's version orders) |
| `content` | `{format:'text/plain', text}`, `text` at most 16384 UTF-16 code units |
| `inReplyTo`, `expiresIn` | as in chat |
| attachment | one inline image: `{id, mediaType, filename, byteCount, width, height, data:{base64}}`, at most 256 KiB, JPEG, PNG, GIF or WebP only |
| whole event | 64 KiB without the image |
| author | implicit in chat (the authenticated DIDComm sender). In rooms the author is the persona, signed inside the seal on `attributed` rooms |

**Rooms mapping.** One create-only record per event. The record key is `e/<eventId>` on open
rooms and a 22-character opaque base64url string on sealed rooms (sealed keys must be opaque);
`eventId` equals the record key. A sealed key is 22 characters and a ULID is 26, so on sealed
rooms `eventId` is the opaque key and is not a ULID; whether the schema's ULID check is relaxed
for rooms is **not decided** and is settled at schema alignment (Q-S8). An event that is unknown or does not parse renders as "unsupported".

**Additions rooms need.**

- A **hosted attachment** variant beside the inline one: `{id, filename, mediaType (claimed),
  byteCount, hosted:{blobRef, fileId, epoch, segmentSize, digest}}` with no `data.base64`.
  `rich-messaging-plan.md` §4.3 already calls a link-based variant additive. A hosted attachment
  is **unverified until opened**: `checkImageAttachment` cannot run until after the download, so
  the claimed `mediaType` is never trusted for rendering before then.
- Room-scoped media storage for downloaded files.
- Optimistic send, pending and failed states, and a version-race retry. Chat has none of these.

**Not carried to rooms in this sprint.** Disappearing timers (no meaning in a shared log),
reactions and redactions beyond display (out of scope), and edits (not built in chat). Without
`curate`, a removed message is "hidden", never "deleted": the record remains on the host.

**Shared with chat, and not shared.** Shared: the schema, the pure checks (`checkAttachment`,
`imageHeader`, `inertText`) and the leaf components `MessageActions`, `ReactionBar`,
`MessageInput` and `useComposerText`. Not shared and not refactored: `Chat.tsx`,
`ChatMessage.tsx`, `chatEventsStore`, `send.ts` and `inbound.ts`. They are coupled to Credo,
DIDComm and `connectionId`, have no "load older", and put the newest message at the bottom.
`RoomView` is its own screen on a plain inverted `FlatList` or gifted-chat `inverted` (decided
in S2).

**Sequencing against build 272.** Nothing in `components/chat/` or `Chat.tsx` changes before
build 272's final pin; #602 is held for the same pin. After it: align the schema (S), then build
`RoomView` on the shared leaves (M). A full shared chat and room presentation refactor (L) is
deferred until one-to-one chat has been stable through a store release.

## How it looks in the app

### Where it lives

Rooms are a section of the **My Agent** stack, reached from the VTA agent home
(`modules/trust-tasks/screens/VtaAgentHome.tsx`), as a "Rooms" card beside Requests and Devices.
Reasons that rule out the alternatives:

- Rooms need a linked VTA, and the agent home is shown only then, so the gate costs nothing.
  A wallet with no linked VTA never sees Rooms; the unlinked My Agent screen can say why.
- A seventh bottom tab (`TabStack.tsx`, six today) crowds the bar, and every tab has
  `unmountOnBlur: true`, which would discard a composer draft and abort a running download
  each time the member switches tabs.
- Settings holds only Help and More Information; it has no feature screens.
- A per-community entry on `VtiCommunity` is not discoverable, and rooms are not tied to one
  community (T3 rooms mix communities).

Pending offers surface as a count badge on the Rooms card only. The My Agent tab keeps its
waiting-requests badge and does not show room offers.

Gating is `link.kind === 'linked'` from `vtaAgent` (as in `agentHome.ts`), plus a new
`enableRooms` flag in `Config` (`types/config.ts`) set in `app/container-imp.ts`, so the entry
can be turned off per build. `VtaOfflineBanner` already renders above the tabs, so rooms
inherit the agent-offline banner.

### Screens

| Screen | Contents |
|---|---|
| `RoomsHome` | Joined rooms (from `vtc/rooms/memberships/list`) and an Offers section. Empty, loading, error and offline states. Pull to refresh. |
| `RoomOffer` | Consent screen for one offer: who invites, which room, its tier, `validUntil`, what joining discloses. Accept / Decline. Takes an `offerRef` route param (see "Join entry points"). |
| `RoomView` | Newest-first message list, "load older" at the end, an attachment chip on file messages, and the composer. |
| Attachment sheet | A bottom sheet for a tapped attachment: name, size, claimed type, Download, progress and cancel, then Share / Open. |

Wiring: add the screens to the `Screens` enum and `MyAgentStackParams` in
`types/navigators.ts`, register them in `navigators/MyAgentStack.tsx` with the existing
`title: t('Screens.X')` plus `ScreenOptionsDictionary` pattern, and add `MY_AGENT_SCREEN` /
`myAgentLinkParams` entries in `vtiLinks.ts`. There is no screen registry; screens are
hard-wired in the stack files. Enum values are the route names and display strings, so choose
them once. Strings go under a new `Rooms` section in `localization/en/en.json` (mirror to fr and
pt-br) and the app override in `app/src/localization/en/index.ts`. Each screen gets a
`*.ids.ts` testID file using `testIdWithKey`; ids are added, never renamed.

### Components: what exists and what is missing

| Need | Use | Status |
|---|---|---|
| Rows and cards | `Pressable` card style from `VtaAgentHome.tsx` (rooms card, offer rows) | exists |
| Lists, pull to refresh | `FlatList` with RN `RefreshControl` | exists |
| Empty state | `components/misc/EmptyList.tsx` (message only) | exists; add a CTA-less variant only if design needs one |
| Loading | `LoadingView`, `ButtonLoading`, `useTakingLong` | exists; no skeleton, none planned |
| Errors | `SaidFailure` + `plainError.ts` (the plain-words Vti pattern), `InlineErrorText`, `ErrorModal` | exists |
| Offline | `useNetwork` / `assertNetworkConnected`, `VtaOfflineBanner` | exists |
| Buttons | `Button` (`ButtonType.Primary/Secondary/Critical`), `IconButton` | exists |
| Consent screen | model on `VtiInvited.tsx` and `DirectoryDisclosureCard.tsx` | pattern exists; new screen |
| Bottom sheet | `chat/DisappearingMessagesSheet.tsx`, `ActionSlider` | exists as a pattern |
| Progress | `views/ProgressBar.tsx` (0–100) | exists |
| Toasts | `react-native-toast-message` via `useToastAboveTabBar` | exists |
| Avatar | `misc/AvatarView.tsx` (initials); no identicon | exists |
| File pick | `react-native-document-picker`, `expo-image-picker` | exists |
| File IO / share | `react-native-fs`, `expo-sharing` (the share path) | exists |
| Rooms service | `RoomsService` / `AgentRoomsService` (#595, #600) | **exists in part**, unmerged; offers, writes and blobs are `clientNotBuilt` |
| Message list | `RoomView`'s own list: plain inverted `FlatList` or gifted-chat `inverted` (S2) | new; `ChatMessage.tsx` is not shared |
| Composer and message actions | leaves `MessageInput`, `useComposerText`, `MessageActions`, `ReactionBar` from `components/chat/` | shared leaves, after build 272's final pin |
| Schema and pure checks | `chat/chatEvent.ts`, `chat/media/checkAttachment.ts`, `imageHeader.ts`, `inertText` | reuse; a hosted-attachment variant is added |

New components to build:

| Component | Size |
|---|---|
| Extend `RoomsService` / `AgentRoomsService`: offers and accept, writes (prepare/confirm), blobs, and the DIDComm delivery leg for act-completed documents | L |
| Upload/download manager (progress, cancel, resume, file protection, temp cleanup) | L |
| `RoomsHome` and the offers list | M |
| `RoomOffer` consent screen | M |
| `RoomView` message list, on the shared leaves | M |
| Composer with attach, caps, progress, and pending/failed/retry states | M |
| Schema alignment with `keyring.chat/1`, including the hosted attachment variant | S |
| Room message row (author, time, inert body) | S |
| `AttachmentChip` (icon, name, size, state) | S |
| Offline/error/empty kit shared by the rooms screens | S |
| Ids, strings, route registration | S |

There is no attachment chip, file icon or "open in" component today, and `chat/ChatMessage.tsx`
only renders images. The chat module's media path is inline and capped at 256 KiB with no
hosting, so rooms reuse its schema, pure checks and leaf components but not its transport or its
screen.

### Rendering and accessibility

- Every free-text field (body, title, filename, room profile) renders inert: no markup, no
  auto-opened links, filename with path separators stripped.
- Tappable rows and buttons carry `accessibilityRole` and `accessibilityLabel`; banners use
  `accessibilityLiveRegion="polite"`; the offers badge has a count in its label.
- Theme tokens come from `useTheme()` (`ColorPalette`, `TextTheme`, `Spacing`); no raw colours.
- Dates use `localDate` / `localDateTime` from `localTime.ts`.
- Screen tests follow `VtaAskMeScreen.test.tsx` (`BasicAppContext`, `fakeAgent`, assertions on
  testIDs and accessibility state).

Done when: each screen has an RNTL test for its loading, empty, error, offline and populated
states; a reduced-motion and large-font pass shows no clipped or hidden controls (the tab
labels already hide at large font scale, so Rooms entry points do not depend on tab labels);
and a manual run on one iOS and one Android device walks join → list → download → post.

## Notifications

### What the backend provides

Nothing pushes to a member. Everything a member learns about a room is pull.

| Event | Backend support |
|---|---|
| New offer or invitation | **Not delivered.** "Nothing is delivered: the member's VTA has no inbound address, so admission is pull-shaped" (`docs/03-vtc/community-rooms.md:285`). The member polls `vtc/rooms/offers/list` (0.3 also returns `renewals`). |
| Welcome ready | Pull: `offers/accept` answers synchronously, or `admissionPending` and the member retries (same KeyPackage, same Welcome, 7 days). |
| New message or file | **No** per-room subscribe, watch, webhook, SSE or long-poll anywhere in `room-host`, `vti-rooms`, `vtc-service/src/rooms`, `vtc-client` or `vta-sdk`. |
| New MLS commit or epoch | Pull: `rooms/epoch/commits`; the member's VTA repairs lazily inside a read (`vta-service/src/trust_tasks/room_catch_up.rs`). |
| Removed from a room | The member is not told (`vtc-service/src/rooms/departures.rs:78-90`). |
| Room lapsed, dormant, reclaimable | Computed on demand (`vti-rooms/src/lifecycle.rs`); "owner notified" is design text only (`data-rooms.md:735-750`). |
| Admin console stream `vtc/admin/events/subscribe/0.4` (`communityRooms`, `rooms` topics) | Exists, but only for holders of `vtc.rooms.manage`, over HTTPS SSE, hints only (no room id, no DID). Not usable by a member or a backgrounded phone, and deliberately not extensible to carry rows. |

Upstream has a generic durable member-push engine (`vtc-service/src/member_push.rs`,
`vti_common::trust_task_push`: TSP, then DIDComm, then REST) that already delivers credentials,
removal notices and step-up notices. No room code calls it. `data-rooms.md:178` says a room "can
push epoch and membership changes to members over the existing delivery layer"; no
implementation exists.

### What the wallet provides

Keyring has a contentless doorbell path: the gateway rings FCM/APNs, the phone then picks up from
the DIDComm mediator (`docs/plans/push-notifications-plan.md`,
`peer-message-notifications-plan.md`; `app/src/push/*`). Two components can ring it today: the
agent for approvals and step-ups, and the mediator's push webhook for messages (at most once per
30 s per handle). A wake shows a fixed system string with no title or sender; the handler never
opens the agent; a new wake kind needs a new collapse-id prefix (`tapKind` in `pushHandlers.ts`).
There is no background fetch and no local-notification library. Whether the mediator-webhook
secret is live in production is not verified (the infra README says it is pending in PR #12).

A foreground inbox (`vtiPersonaInbox.ts`) polls every 30 s and already stores community notices,
invitation offers and removal notices. The My Agent badge is fed by `waitingRequests.ts`.

### This sprint: pull only, no new push

Nothing in this sprint rings a phone. Room awareness is built from polling the wallet does while
it is open, which is what upstream supports.

| Mechanism | Behaviour |
|---|---|
| Offers poll | While unlocked and a persona is linked, the phone signs `vtc/rooms/memberships/list` (now) and `vtc/rooms/offers/list` (once S1 builds it) as the persona over DIDComm, per community, every 60 s. The 60 s value is a starting point pending the S0.6 limiter check (the persona inbox ticks every 30 s; rooms do not need to match it). Feeds a `useRoomOffersCount` store in the `waitingRequests` pattern, shown as the badge on the Rooms card only. Pauses in the background. |
| Refresh on open | Offers and joined rooms refresh at app foreground, on opening Rooms, and on opening a room. |
| Active-room poll | Only for the room on screen: `rooms/records/list/0.3` with `sinceVersion` = the stored watermark every 20–30 s. Persist `headVersion` per room; an unchanged room costs one small request. Compare the watermark, never the record count (a prune moves `headVersion`). Stops when the screen blurs. |
| Unread dot per room | From the stored watermark vs `headVersion`, refreshed by the same offers/memberships refresh (one `rooms/info/0.2` per visible room at most, rate-limited). |
| Lifecycle warnings | A scheduled **local** notification or in-app banner from the room's expiry dates (`owner_authority_valid_until`, `epoch_expires_at`); needs no server change, but the wallet has no local-notification library, so this sprint ships the in-app banner and leaves the local notification for later. |
| Tap routing | Add a `keyring-room-` collapse-id case to `tapKind` that opens Rooms. It does nothing until a trigger exists, so it can land now. |

Polling budgets matter: room documents are limited per (room, presenter) to a burst of 120 then
one per 100 ms. The offers poll is phone-signed and costs no VTA round trip. The active-room poll
(`rooms/records/list`) is a host call; on a sealed room reading it goes through the VTA
(`rooms/keys/browse`). Poll per community and per active room, never per room in the background.
Verify in S0 whether `vtc/rooms/offers/*` falls under the room limiter or the shared anonymous
governor (burst 10, then 1 per 5 s) before choosing the offers interval.

Done when: a new offer created on the lab VTC appears as a badge within one poll interval with
the wallet in the foreground; a message posted by a second member appears in the open room
within one active-room interval; a pruned room does not show a stale unread state; polling stops
within one tick of backgrounding or locking; and a test proves no poll runs with no linked VTA.

### Later: real push (not this sprint)

Rising cost, in order. Each needs work outside this repo.

1. **VTC sends an "offer waiting" Trust Task** through `member_push::push_trust_task`. The wallet's
   persona inbox already consumes community-sent messages, so the badge could update without
   waiting for a poll, and the mediator-webhook path would ring a phone with a queued message.
2. **A true background wake.** The VTC needs a trigger on the handle's allowlist
   (`set-wake` `suggestedTriggers`), and the gateway needs a new collapse-id prefix: a gateway
   patch plus VTC work.
3. **Per-room activity.** No producer exists. A contentless "head moved" doorbell from the host to
   the member's mediator, followed by a `headVersion` poll, is possible but needs an upstream spec.

Constraints on any of these: wakes stay contentless with the fixed system string. A wake that
names a room or community, or a gateway handle per room, leaks membership metadata to Apple,
Google, the gateway and the mediator. iOS throttles silent pushes (about 2–3 an hour), so a wake
is a visible push, and the app has no background execution while locked.

## Story map

### S0. Spikes (first, blocks the rest; about 3 days)

| # | Spike | Done when |
|---|---|---|
| S0.1 | Port feasibility: run `external/vta-browser-plugin/packages/core/src/rooms/index.ts` (821 lines) under Hermes inside `@bifold/core` | A jest test and one on-device call build and sign a `rooms/records/list` document; the library choice (port vs. thin rewrite) is recorded |
| S0.2 | Credential acceptance: does the wallet accept room-issued VIC/VMC/VAC (`issuerScope`)? (parent B4) | Yes/no with evidence; if no, the join story changes to "VTA holds them, wallet only displays" |
| S0.3 | **Confirm the Farm community's room configuration** (primary test host). Claimed, and nothing in this repo confirms it: a Farm community on VTA 0.64.0-4a0f1ff1 and VTC 0.12.0-4a0f1ff1 (commit 4a0f1ff1 is in `vta-service-v0.64.0`; the offers commit 795fd2ae and the memberships-list commit 594c8ff9 are its ancestors). Unknown: whether `[rooms.community]` is set (without it room creation is refused `noKeyHolder`) and whether `[rooms.files]` is set (absent, uploads are refused and reads are served). The older lab VTCs `keyring-lab-community` and `keyring-hv-lab1` lacked Rooms openapi schemas on 2026-10-25 (`2026-10-25-al.md` §3). Steps: GET the community's openapi and look for `Rooms…` schemas; ask it for `trust-task-discovery/0.1`; ask Alberto whether a community room exists and whether `[rooms.files]` is on; run the lab call #600 still owes (`memberships/list` over DIDComm as a persona) | The openapi lists `Rooms…` schemas; discovery lists the rooms tasks; Alberto's answers on the room and `[rooms.files]` are recorded here; the `memberships/list` call passes, which clears #600's draft gate. **Blocked on Alberto** for the room and `[rooms.files]` answers. **Fallback**: the local lab: add `room-host` and a VTC with `[rooms.community]` and `[rooms.files]` to `scripts/openvtc/local-vti-stack`, and a seed script that creates an `attributed` room the lab VTA is a member of with 30 messages and one 5 MiB file |
| S0.4 | Measure the real text ceiling: largest body a VTC and room-host accept with a 2-link chain | A number in this file, replacing the 64 KiB assumption |
| S0.5 | ACL: does the wallet's VTA grant carry the room capabilities (`roomPresent`, `roomOpen`; parent B2)? | The grant the wallet requests is listed and a call with it succeeds |
| S0.6 | Rate limiter class: does `vtc/rooms/offers/*` fall under the room limiter or the anonymous governor (burst 10, 1 per 5 s)? | The class is recorded and the offers poll interval in "Notifications" is set from it |

| S0.7 | Delivery leg, text: one end-to-end `rooms/records/put` completed by `rooms/keys/act` and delivered by the phone over DIDComm to a VTC. Upstream design says the client sends the act-completed document "to the host unchanged" (`docs/02-vta/data-rooms.md` about lines 1364-1380), and the VTC dispatches every transport through one `dispatch_trust_task_core` (`vtc-service/src/trust_tasks/messaging.rs`, about line 1012 for TSP and 1694 for DIDComm). **Unproven live** | The record is accepted and appears in `rooms/records/list`; or the refusal and its reason are recorded and S4 stops (see "Sequencing") |
| S0.8 | File-chunk throttle: determine whether DIDComm chunks fall under `LargeDocumentBudget` (`size.rs` about lines 357-360; 5 raised-limit documents per minute per address) | A measured chunks-per-minute figure over DIDComm. If throttled, file transfer over DIDComm is throttled; the options are an HTTPS leg for blobs or smaller chunks, and **files slip to the next sprint** (text-only post) |
| S0.9 | A 256 KiB chunk (about 350 KiB encoded) fits one DIDComm message under the mediator's 1 MiB default `message_size` (**inferred, untested**) | One chunk round-trips through the mediator on the S0.3 host, and the mediator's configured limit is recorded |

Not blocked: the product decision (Q1) and module location (B3) are settled; see "Decisions".

### S1. Join (community offer)

This story extends `RoomsService` (#595) and `AgentRoomsService` (#600): it builds `listOffers`,
`previewOffer`, `acceptOffer(token)` and `hideOffer`, which #600 reports `clientNotBuilt`.

Flow: `vtc/rooms/offers/list` (phone-signed as the persona) → show offer and consent → (sealed only)
VTA `rooms/keys/key-package/0.2` → `vtc/rooms/offers/accept/0.1` (completed through `rooms/keys/act`
when it carries the package) → VTA `rooms/keys/welcome`. Repeat-accept returns the same
Welcome for 7 days; treat `alreadyJoined` as success and retry with the identical KeyPackage
after `admissionPending`. A Welcome never travels through the room host.

- Accept only offers that arrive from a community the wallet is already linked to. There is no
  self-service join upstream (`data-rooms-joining.md` is a proposal: "do not write the spec yet"),
  so join by link or QR is **not** in this sprint, but the code is shaped for it (below).
- `offers/list` is signed by the phone with the lent persona key; the VTC checks the signer is the
  member and an active member. An `offers/accept` that carries a `keyPackage` is completed only
  if the VTA minted that package (`keyPackageNotHeld`), so sealed and MLS accepts go through
  `rooms/keys/act`. The member needs a persona DID held by the VTA.
- After the Welcome, run `rooms/keys/backfill/0.2` (or `rooms/epoch/chain/0.2`) so reads work.
- The Rooms list reads `vtc/rooms/memberships/list` as the one record of where each admission
  stands, and never keeps its own record of acceptance: every step answers a repeat with its
  first answer, so any surface can finish another's join (`vtc-service/CLAUDE.md`).
- Done when: the lab offer is listed, consented, accepted on `open` and `attributed` rooms; a second
  accept is idempotent; the membership appears in a "Rooms" list that survives app restart.
- Sealed joins by a community offer are done by the VTC. Sealed joins by a self-hosted owner use
  `rooms/owner/group/add` from the owner's VTA (`pnm rooms owner group-add` in the lab).

#### Join entry points

Offer acceptance is one function, `acceptRoomOffer(offerRef)`, reached from the consent screen
only. The inbox is the first entry point. A later join link or QR adds a second one that
resolves to the same `offerRef` and opens the same consent screen. To add it, a future change
touches only these places:

1. `keyringAgentLinkKind` in `modules/trust-tasks/module/vtiLinks.ts`: a new kind (for example
   `roomInvite`) and its detector.
2. `routeKeyringAgentLink` (same file): a case that resolves the link to an offer and navigates.
3. `MyAgentScreenName` / `MY_AGENT_SCREEN` / `myAgentLinkParams`: the consent screen's entry.
4. Native URL registration (Android manifest, iOS Info.plist, associated-domains file) only if the
   link needs a new scheme or path.
5. The scanner (`Scan.tsx`, `PasteUrl.tsx`) already routes through `routeKeyringAgentLink`, so
   QR support needs no scanner change. Use the existing `scanId` / `getId` pattern so each scan
   opens its own screen.

Done when (for this sprint): the consent screen takes an `offerRef` route param and nothing in
it assumes it came from the inbox, shown by a test that renders it with a param and no inbox.

### S2. List recent content

- Open: `rooms/records/list/0.3` with `limit`, `sinceVersion`, `cursor`.
- Attributed: `rooms/keys/browse` through the VTA (it catches up on commits itself) and
  `rooms/keys/read` for one record. Do not use `open` directly; it does not catch up.
- **Newest-first is built client-side.** List is ascending with no reverse. Read `headVersion`,
  request `sinceVersion = headVersion − N`, follow `cursor` until absent (never infer the end
  from a short page), reverse for display. Tombstones come back; hide retracted records.
- Message profile: `keyring.chat/1` (see "Message format"). Each record is one event; records that
  are unknown or do not parse render as "unsupported". `RoomView` uses a plain inverted
  `FlatList` or gifted-chat `inverted`; S2 picks one and records why.
- Extends `AgentRoomsService.listNotes` / `readNote` (#600), which are built but not live-proven
  until S0.3's lab call passes.
- All free text (body, title, filename, room profile) renders inert: no links auto-opened, no
  markup.
- Done when: the 30 seeded messages render newest-first with pull-to-refresh and "load older";
  tombstones are hidden; an unknown record shape does not crash; offline shows the last page.

### S3. Download an attachment

Extends `RoomsService.listFiles`, `openFile` and `releaseFile` (`clientNotBuilt` in #600). The
record's attachment is the hosted variant of `keyring.chat/1` (`hosted:{blobRef, fileId, epoch,
segmentSize, digest}`); its `mediaType` is a claim until the file is opened and sniffed.

Sequence: read the record → `file{fileId, name, mediaType, size, digest, epoch, segmentSize, blobRef}`
→ `rooms/blobs/get/0.1` (manifest + `downloadId`; skip `direct` mode) → `rooms/blobs/chunk/0.1`
per chunk, with `issuer` set to the member → VTA `rooms/keys/file-key/0.2` (`purpose:"open"`)
→ decrypt chunk by chunk (STREAM, ChaCha20-Poly1305) → verify chunk and plaintext digests →
write the file only after verification passes → share sheet (`expo-sharing`), file via
`react-native-fs`.

- **Crypto location is the open design issue.** Decrypting in the wallet means the wallet holds
  the file key briefly (acceptable for files; not the group key). Options: a small JS STREAM
  opener (S0 decides), or compile `vti-rooms` with only the `files` feature behind a native
  module. The parent plan advises against compiling `vti-rooms-wasm` into the app first, since
  it carries group state. JS is the proposed default; the digest check makes a wrong
  implementation fail closed.
- Never write unverified plaintext to a shareable location; stream to a temp path in app
  storage, delete on failure.
- Strip path separators from the filename; never trust `mediaType`; sniff before previewing.
- Honour 429 `Retry-After`; resume partial downloads by chunk index.
- Chunk requests (`rooms/blobs/chunk`) travel over the same DIDComm leg as other community tasks,
  completed by `rooms/keys/act`. Whether DIDComm chunks are throttled (S0.8) and whether a chunk
  fits one message (S0.9) decide whether downloads work in this sprint. **Cut line:** if S0.8
  fails, S3 and the file half of S4 move to the next sprint.
- Done when: the 5 MiB seeded file downloads, verifies and opens from the share sheet; a
  corrupted chunk (lab tamper) is refused with no file left behind; a 25 MiB file completes
  on a mid-range device without exceeding memory (stream, not buffer).

### S4. Post (message, or file with optional message)

Extends `RoomsService.prepareWrite` and `confirmWrite(token)` (`clientNotBuilt` in #600). A write
is two steps with a 10-minute preview token. Every call below that needs the persona's
presentation is completed by the VTA through `rooms/keys/act`.

**Delivery leg.** The phone delivers the act-completed document to the community host unchanged,
over the same DIDComm leg it already uses for join and leave. There is no new HTTPS client.
Upstream's design says the client sends the document "to the host unchanged"
(`docs/02-vta/data-rooms.md` about lines 1364-1380). **Unproven live until S0.7.** `act` cannot
complete `records/put` 0.3, so S4 uses 0.1 and 0.2 and open-room provenance and expiry fields are
unavailable.

- Message body is a `keyring.chat/1` `message` event. One create-only record per event
  (`expectedVersion:0`); key `e/<eventId>` on open rooms, a 22-character opaque base64url key on
  sealed rooms.
- Text, open room: `rooms/records/put/0.1` completed by `act`, delivered by the phone.
- Text, attributed room: build `SealedRecordBody`, VTA `rooms/keys/seal/0.2` with
  `signAsPrincipal`, then `put` with `sealed:{ciphertext, nonce, epoch}`. The seal binds
  `roomId|key|version|epoch`, so predict version = head + 1; on a version mismatch re-seal at
  the version the host returns and retry. Keys on sealed rooms must be opaque (22-char
  base64url). The composer shows optimistic, pending and failed states and retries on a version
  race.
- File (with optional message): mint a 32-byte `fileId` → `file-key purpose:"seal"` → seal
  STREAM segments and build the manifest → `rooms/blobs/upload/begin/0.2` (resumable; repeat
  with the same manifest) → `upload/chunk/0.2` for each missing chunk, signed by the throwaway
  `uploadKey` → `upload/commit/0.2` → `put/0.2` with `blobs:[blobRef]` and the body's `file`.
  Abort with `upload/abort/0.2` on cancel.
- **Retry rule:** document ids are single-use. Never blindly retry a write; re-sign with a fresh
  id unless the host refused before executing.
- Enforce the wallet caps (16384 UTF-16 code units of text, 25 MiB file) before any network call; surface the host's
  refusal reason when a host limit is lower.
- Files are gated on S0.8 and S0.9 (cut line in "Sequencing").
- Done when: a message and a message-plus-file post to both tiers and show on a second lab
  member's list; a version collision recovers automatically; a cancelled upload leaves no
  orphan after the host's 168 h grace (check `abort` path); over-cap input is refused with a clear
  message.

## Sequencing

Two engineers, one sprint (10 working days). Q1 and B3 are answered (see "Decisions"):

| Days | Work |
|---|---|
| 1–3 | S0 spikes (parallel: S0.1 + S0.2 by one, S0.3 + S0.4 + S0.5 by the other) |
| 3–5 | S1 join (needs S0.3) and S2 list on `open` rooms |
| 5–7 | S2 attributed list; S4 text post (open then attributed) |
| 7–9 | S3 download; S4 file upload |
| 9–10 | Hardening: inert rendering, 429 and resume paths, jest coverage, a manual lab script |

Cut lines, all deliberate:

- If S0.1 shows the TypeScript port does not run under Hermes, or S0.2 says the wallet cannot
  hold room credentials, S3 and the file half of S4 slip to the next sprint and the sprint ships
  join + list + text post.
- **If S0.8 fails** (DIDComm chunks are throttled), files slip to the next sprint: the sprint
  ships join + list + text post. The fallbacks for that sprint are an HTTPS leg for blobs, or
  smaller chunks.
- If S0.7 fails, S4 has no delivery leg and is blocked until the leg is decided with Alberto and
  upstream; the sprint then ships join + list.
- Build 272's final pin gates the shared-leaf work in `RoomView` and #602, not the service
  stories.

## Testing

- Jest in `app/` and `bifold/packages/core` for document building, version-collision handling,
  cursor paging, newest-first assembly, digest verification, filename sanitizing, and
  "unknown record" tolerance. Use `TZ=GMT yarn jest <path>`.
- Lab script for the seeded room (S0.3), run by hand against `open` and `attributed` rooms.
  No Appium rung this sprint; add after the manual pass is stable (parent plan).
- Gate commands before merge: `yarn lint`, `yarn typecheck`, `yarn test`, `yarn prettier`.

## Risks and waiting items

| Risk | Mitigation / owner |
|---|---|
| The sprint is built on unmerged work: #595-#602 are drafts, #595 is "not for merge until 272's final pin", #600 is not live-proven | Owner: Alberto, for #595-#602. Gate: build 272's final pin. Service stories land as extensions of those PRs |
| Delivery of act-completed documents over DIDComm is unproven (S0.7), and DIDComm chunks may be throttled (S0.8) or too large (S0.9, inferred) | Spikes first; cut lines in "Sequencing" |
| The lent persona key puts a persona signing key in phone memory | Used only for community-scoped reads and offers; room writes stay behind `rooms/keys/act` (see "Architecture decision") |
| Hermes, credential-acceptance and ACL spikes (S0) come back negative | Cut line in "Sequencing" |
| TS client doesn't run under Hermes | S0.1; fallback is a thin rewrite of the 4 flows |
| Wallet can't accept room credentials | S0.2; join becomes display-only |
| Host `maxDocumentBytes` lower than assumed | S0.4 sets the caps |
| No self-service join upstream | Out of scope; track the joining proposal upstream |
| Tab bar already has six tabs; `unmountOnBlur` would drop a draft or running download | Rooms live inside the My Agent stack, not a new tab (see "Where it lives") |
| Commits are not optional; a missed one reads as corruption (`unknownEpoch`) | Always read via `rooms/keys/read`/`browse`; backfill after join |
| `private` tier unavailable | Not offered in the UI; refuse with a clear message |
| The Farm community's room configuration is unconfirmed (`[rooms.community]`, `[rooms.files]`) | S0.3; blocked on Alberto's answers; local lab is the fallback and claims made there are local-lab only |

## Decisions (Brendan, 2026-10-26)

- Rooms are wanted; this subtask is the first chunk (parent Q1/B1).
- The module lives in `@bifold/core` beside `VtaClient` (parent B3).
- The posting identity is the persona the VTA assigned to that room. Profiles are not VTA
  personas (`editable-multi-profile-plan.md` §3).
- Wallet caps are 16384 UTF-16 code units of text and 25 MiB per attachment, one attachment per
  post.
- Join by community offer now, built so a join link or QR can be added later.

## Decisions (Alberto's review of #661)

- **Persona signing.** The phone signs community-level tasks (`memberships/list` now, `offers/list`
  once built) as the persona with the key lent by the VTA; room writes, sealing and blobs go
  through `rooms/keys/act`. The security trade-off is in "Architecture decision" and parent §3.3.
- **Message format.** Rooms use `keyring.chat/1` with a hosted-attachment addition; see "Message
  format".
- **Existing module.** The sprint extends `RoomsService` / `AgentRoomsService` rather than adding
  a layer.
- **Caps.** 16 KiB text (16384 code units) and 25 MiB attachment are fine to start.
- **Share path.** `expo-sharing` is the share and open path for downloaded files.
- **Badge.** Pending offers badge the Rooms card only.

## Open questions

- Q-S7. Plain inverted `FlatList` or gifted-chat `inverted` for `RoomView`. Not decided; S2
  decides and records why.
- Q-S8. The hosted-attachment variant is an addition to the chat schema, which the chat module
  owns, and the sealed-key length above needs a ruling there too. Whether the addition lands in `chatEvent.ts` or in a rooms-side extension is not decided; it is
  decided with Alberto when the schema is aligned, after build 272's final pin.
