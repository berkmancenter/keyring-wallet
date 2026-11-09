# Rooms Chat — Plan

**Status:** Accepted, building. Slice A and C are next; slice B stage 1 is in review as [bifold #925](https://github.com/berkmancenter/keyring-bifold/pull/925). D and E wait on upstream's stages (§6).
**Scope:** A room's conversation in Keyring, on the shared record format in trust-tasks-tf [#1027](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/1027): replies, reactions, withdrawn messages and edits, read and written by the same rules as every other client.
**Companion:** [`rooms-chat-plan/2026-11-04-al.md`](./rooms-chat-plan/2026-11-04-al.md) — why this parent, why build before #1027 merges, and what each re-read of it changed.
**Related plans:** [`rich-messaging-plan.md`](./rich-messaging-plan.md) is the one-to-one chat this reuses components from; it leaves group chat to the rooms work. [`openvtc-rooms-plan/rooms_group_messaging_subtask.md`](./openvtc-rooms-plan/rooms_group_messaging_subtask.md) is the wider group messaging architecture. Its §5.3–5.4 event body (`org.openvtc.msg/1`) gives way to #1027's record members for conversations; its files, membership and delivery sections stand. [`community-polls-plan.md`](./community-polls-plan.md) sits beside it.
**Baseline:** #1027, merged as `565f8d32`. Its specs keep `status: draft`, and a later PR can still change them, so this plan calls their text "the draft". Keyring: bifold `main` `d1d84ee11`, testers on 277.10 at `0a54d7883`. VTI `main` `2afa34e0`, newest tag `vta-service-v0.74.0`. Spec citations are `rooms/_shared` 0.2, `rooms/records/put` 0.5, `rooms/records/list` 0.6, `rooms/keys/seal` 0.3, `rooms/keys/browse` 0.4 and `rooms/keys/read` 0.2, all as drafted in #1027.

---

## 1. Summary

Keyring's rooms show every record as a post or a note, deciding only by its title. Under #1027 a room can hold reactions, replies and withdrawn messages, and a shipped Keyring would draw a reaction as a post holding an emoji. The plan fixes that first, then builds up:

| Slice | What | Can start | Waits on |
|---|---|---|---|
| **A** | Reader-safe: understand `kind`, `inReplyTo`, `writtenAt`; never show a reaction as a post | Now | Nothing. Re-check against the draft before it ships |
| **B** | Reading rules: stage 1 (a count), then stage 2 (applied to what's shown) | Stage 1 is in review | Stage 2 waits on stage 1's report, decision 1 (§7) and slice D |
| **C** | Display: reply quote, reaction chips, withdrawn, edited | Now, on the draft | Private rooms' names and counts wait on B's stage 2 |
| **D** | Agent: `browse` 0.4, `read` 0.2 batches, read lane | Client code can start | A VTA that serves them (§5) |
| **E** | Writing: replies and reactions, per room | Profile read can start | A VTA that seals them, and a room's owner listing them (§5, §6) |
| **F** | Open upstream: new-record signal, member names | No build | Upstream |

**A and C don't wait for an agent or for the specs to leave `status: draft`.** That's safe because no room can hold these members yet: no agent seals them and no profile lists them. A reader we later need to change is one OTA away (§8 lists what would change).

---

## 2. Goals and non-goals

**Goals**
- G1. A reaction is never shown as a post, and a kind Keyring doesn't know is shown as a note, before any room can hold them.
- G2. A room's conversation offers what our one-to-one chat offers: quoted replies, reaction chips, plain text, photos with captions.
- G3. Every record already in a room reads exactly as it does today.
- G4. Keyring writes the same records as the plugin and the member portal, so a thread is shared across clients.
- G5. Nothing here makes opening a room slower; slice D should make it faster.

**Non-goals**
- Read receipts, delivery receipts and typing. Our chat has none, and in a room they'd tell members who read what.
- Tap-to-jump from a quote. Our chat doesn't have it; a later small addition if wanted, since a reply's `key` is all it needs.
- A room-wide disappearing timer. `validUntil` and `rooms/records/retention/set` cover this differently, and "either person sets it" doesn't fit a room.
- Merging notes into the conversation. The draft allows either, and Keyring keeps them apart (§7).
- Delete for me in a room. A room lists the message again, so it would need its own local memory; the room's sheet leaves it out.

---

## 3. Current state

All at bifold `d1d84ee11`, under `packages/core/src/modules/rooms/`.

| Area | Today | Where |
|---|---|---|
| Parsing a read | Takes `title`, `body`, `file`; ignores other members | `real/wire.ts:502` `parseRead` |
| Note or post | A record with a title, or a retracted one, is a note | `roomPosts.ts:106` `isNote` |
| Words | Shown inert, never followed | `roomPosts.ts`, `components/RoomPostBubble.tsx` |
| The room's list | A `FlatList` of `RoomPostBubble`, not gifted-chat | `screens/Room.tsx` |
| Page | 10 chat posts; sealed records are read one by one to tell what they are | `useRoomPosts.ts:35`, and its `leftOut` |
| Unread | Every new listing key not ours counts; only the newest is read | `useRoomRows.ts:199`, `:209` |
| Arrival | "Nothing pushes a post to a phone"; polled | `useRoomRows.ts` header |
| Reading rules | A log-only count of how text records read is in #925 | `real/files/sender.ts`, and `real/files/textSenderCount.ts` on that PR |
| Author shown | The host's on attributed rooms; none on private rooms | `real/wire.ts`, `roomPosts.ts` |
| Writing | `rooms/keys/seal` 0.2 with `signAsPrincipal`, sealed tiers | `real/agentRoomsService.ts:1467` |
| Listing | `rooms/keys/browse` 0.3 or 0.1, by discovery | `real/agentRoomsService.ts:1209` `browseType` |
| Room profiles | Not read at all | No `rooms/keys/profile/read` in `modules/rooms` |
| Empty-chat card and note line | "1 note in this room" (#900, merged); "Note: <title> · See" (#923, open) | `roomPosts.ts` `isNote` decides both |

**What upstream's agent does.** The newest tag, `vta-service-v0.74.0`, refuses to seal these members. VTI `main` at `2afa34e0` serves `rooms/keys/seal/0.3` and `rooms/keys/act/0.11`, and its profile reader accepts `recordMembers` (VTI #2449, untagged). `rooms/keys/read` opens a record and returns it without checking members, on both, so a reader change needs no new agent.

---

## 4. Slice A: reader-safe now

**Goal.** Keyring reads the new members correctly while no room holds them, so the adoption clock starts early. It adds no UI beyond hiding what must not be shown.

**The rules it follows** (`SealedRecordBody`):
- *Kind*: "a reader MUST present a record whose `kind` it does not know as a note, and MUST NOT refuse it for its `kind`."
- *Reactions*: "A reader MUST NOT show a reaction as a note or a message". And it "MUST NOT show a reaction that lacks `inReplyTo` or whose value is longer than 64 code points or holds a line terminator; it refuses that record alone, never the room's others."
- *Nothing answers a reaction*: a reader that finds a reaction as a target "MUST ignore the record naming it — show it nowhere, count it as no reaction".
- *Untitled records*: "A reader that keeps a conversation apart from a library MAY treat a record with no `kind` and no `title` as a message". Keyring takes that MAY: every post it has ever written depends on it.
- *Withdrawing a message*: "A reader shows a current version of a message with an empty `body` and no `file` as withdrawn, or not at all".

**What it does.**
1. `parseRead` reads `kind`, `inReplyTo`, `writtenAt` and `editedAt` from a sealed body and from an open room's cleartext, type-checked and otherwise dropped. `Note` carries them.
2. One function decides, in one place in `roomPosts.ts`, and it has three answers: chat, notes or nowhere. `isNote`, `isChatPost` and #923's `isNoteMarker` all derive from it. This matters because `isChatPost` is `!isNote` today, so a reaction that's simply "not a note" would read as a message. `Room.tsx`'s filter and `useRoomPosts`' page count use the same function.

| Record | Today | With A |
|---|---|---|
| No `kind`, no title | Chat | Chat (unchanged) |
| No `kind`, title | Notes | Notes (unchanged) |
| Retracted | Notes marker | Notes marker for now (see §7) |
| `kind: message`, no title | n/a | Chat |
| `kind: message`, title | n/a | Notes, until listings carry `kind` |
| `kind: note`, no title | n/a | Notes |
| `kind: reaction` | n/a | Nowhere |
| Unknown `kind` | n/a | Notes |
| `kind: message`, empty `body`, no `file` | n/a | Not shown (C adds the withdrawn line) |

   A titled message goes to Notes because of how a page is read. On an open room `useRoomPosts`' `leftOut` skips a record whose listing shows a title, and that decision can't see `kind` until a listing carries it. Sent to chat, such a record would never be read there, and Notes would leave it out too, so it would vanish. *Kind* says a message "SHOULD carry no `title`", and it says a reader "SHOULD show messages in the first", so this is rare and allowed. It's exact once listings carry `kind`.
3. A reaction leaves every place a post can show: the chat, Notes, #900's count, #923's line, the Messages row's preview, and `useRoomPosts`' page count, so a page is still 10 posts. A record naming a reaction as its target goes too.
4. The note editor offers no Edit on a record carrying `kind`, `inReplyTo`, `writtenAt` or `editedAt`. It writes `{title, body}`, so an edit would drop them, and *What a new version keeps* says: "A new version MUST keep the `kind` of the version it rewrites, absent included". Slice E lifts this. A record with none of them edits as it does today.
5. On the Messages row, a newest record that turns out to be a reaction shows the last thing that isn't, or nothing.

6. `parseFileManifest` accepts `width`, `height` and `preview`, type-checked. Today it returns nothing for a manifest with any member it doesn't know (`real/wire.ts`, `FILE_MANIFEST_FIELDS`), so a shipped Keyring would drop the file from such a record. Nothing shows them until C.

**Stable enough to ship before #1027 is released:** the kind rules, the note default, `reaction` hidden, `inReplyTo`'s shape, the untitled MAY. These have held through every revision so far, and getting one wrong costs an OTA, with no record affected. The manifest fields are newer, but accepting them is what's needed whichever way they settle.

**Left out of A, because it would change what's shown or needs more of the draft to settle:**
- *Reading rule (1)*, "refuse an unknown member". Keyring ignores unknown members today. Refusing changes what's shown, so it belongs with B.
- Ordering by `writtenAt` or `createdAt`, and the backdating line. Order stays as it is until slice D brings `createdAt`.
- Showing anything new: chips, quotes, marks. Those are C.

**A limit it accepts.** On sealed tiers a listing doesn't say what a record is, so a reaction still counts as unread until it's opened (`useRoomRows.ts:199`). Slice D narrows this. It costs nothing until rooms hold reactions.

**Acceptance.**
- A control: every record shape in rooms today (titled, untitled, retracted, a `keyring.chat/1` body from before 277.8, non-JSON, a file record) gives byte-identical `postOf` output and the same `isNote` answer before and after. Compared on real read order, with records as a real store gives them, not only mocks.
- Each row of the table above has a test, signed with the real fixture, and `isChatPost` is false for a reaction.
- A titled `kind: message` on an open room appears in Notes and is never lost, through the real `leftOut` path.
- Reactions over 64 code points, with a line terminator or with no target are refused alone, and the room's other records still show. These rules run on the body as written, not on `toInertText`'s output, which removes U+000B, U+000C and U+0085 and so would hide a line terminator.
- A reaction is absent from the chat, Notes, #900's count, #923's line, the row preview and the page count, each asserted on its own.
- Edit isn't offered on a record carrying any of those members, and is still offered on one carrying none.
- A file record with `width`, `height` and `preview` still opens as a file, and one with a member nobody defined is still refused.
- Deliberate breaks of each rule fail a test, on a green baseline.
- One read-only look at a lab room on a device: nothing on screen changes.

**Tier.** Expected `ota`; grade with `origin/main`'s `tier.mjs`.
**Depends on.** Lands alongside #923. `isNote` is one function, so whichever merges second rebases on it.

---

## 5. Slices B, C and D

### Slice B: reading rules

The rule is `SealedRecordBody` *Reading*: a reader "MUST, before showing any member of it or trusting its `file`" run four checks. Slices C and E read a body's `author` on private rooms, where no host names one, so on those rooms this comes first.

**Stage 1, a count: [#925](https://github.com/berkmancenter/keyring-bifold/pull/925).** Logs counts and closed kinds, and nothing on screen.
*Acceptance:* one line of counts and closed words per interval; a phone's cost measured or reported from the line itself.
*What its report decides:* how often each kind happens on real rooms.

**Stage 2, applying them. Conditional on decision 1 (§7).** What it has to do that stage 1 doesn't:
1. **Which document.** *Which DID document*: "`author`'s DID document **as it stood at the host's `bodyStoredAt`**"; for `did:webvh`, "resolved with `versionTime`". Credo's `WebVhDidResolver` doesn't pass `versionTime` and `resolveDidDocument` can't, so this needs a patch or our own `resolveDIDFromLog` call over the one fetched log. One fetch per author still holds, since the log has every version.
2. **Records with no `bodyStoredAt`**, which is every record today: "it uses the current document, and treats a proof that fails there the same way". So a failed old record is the placeholder, not a refusal.
3. **Deactivated authors.** The draft treats one like an unresolvable DID, so stage 2 reads the resolver's metadata as well as the document.
4. **Rule (1)**, refusing an unknown member, with an allow-list from the released schema so honest provenance members pass.
5. **Showing before checking.** The rule says *before showing*. A check costs a fetch once per author and a verify per record on the JS thread (§9). Stage 2 needs a saved verdict per record version, kept with what's already stored and by hash, so a re-read costs nothing and a lock doesn't cause a new fetch. A first read waits or shows a placeholder until checked.

*Acceptance:* reading rules (1)–(4) each broken alone, in `roomFileSender`'s style; a rotated key verifies against a dated document; a key rotated away before `bodyStoredAt` is refused; a first-time page of 10 opens no slower than the agreed budget on the slowest phone we have; a rollback flag.
*Blocked on:* decision 1, and D for `bodyStoredAt`.

### Slice C: display

**Mocks:** drawn and reviewed before this is built. They order by `createdAt` and show the off state. Their placeholder frames are conditional on decision 1 (§7).

**Reuse from chat:** `MessageReactions`' chip layout (`components/chat/ChatMessage.tsx`), generalised from two roles to `{value, count, mine}`, since it now counts many authors; `ReactionBar`, whose `selected` becomes a set, since another client can give one author several values; `foldChatEvents`' shape as a pure function, `foldRoomRecords`; `normalizeEmoji` for showing the fully qualified form. **Not reusable:** gifted-chat's `MessageReply`, because rooms draw `RoomPostBubble` in a `FlatList`. A small `RoomQuote` takes the same words and states.

| Item | Rule | What's shown | On private rooms |
|---|---|---|---|
| Reply quote | *Replies* | Target's words, or "isn't available", in chat's wording | Quote's words yes; author's name after B |
| Reaction chips | *Reactions*, *Counting reactions* | Value, count, your own marked; word values as short text chips | Counts after B |
| Withdrawn | *Withdrawing a message* | One neutral line in place; replies stay | Same |
| Edited | *Edits* | "edited" from `editedAt`, never from `version` | Same |
| Rewrite by another member | *Edits*, *The record's original author* | Shows the new author, never as an edit | Earlier version only; no `createdBy` there |
| Late arrival | *Backdating* | "arrived later", ordered by `createdAt` | Needs D |
| Placeholder | *An author whose DID does not resolve*, *Which DID document* | Comes with B. It may not use `kind`, so a departed member's reactions can't be told from messages: consecutive ones merge into one line ("3 posts can't be verified"). The merge is our reading: the draft forbids dropping them silently and doesn't mention merging. Conditional on §7's first decision | With B |
| Photo | `FileManifest` `width`, `height`, `preview` | The bubble's final shape, and the preview until the file is fetched; both checked against the bytes | Same |

**What it reads.** A quote needs its target, usually already on the page. A target beyond the page costs one read, within the read lane.

**Holding earlier versions.** Several rules compare with a version the reader already holds. Keyring holds opened records only until a lock, so after a lock it reads as a first-time reader, and it relies on `createdBy` where D provides it. A store of earlier versions isn't planned; the draft says a first-time reader "has nothing to compare" and we accept that.

*Acceptance:* each row has a test and a harness render at real text size (~18 px) in both platforms, with fixed data, and a mock approved first; French and Portuguese strings flagged for a human reader; each chip and line keeps the post's accessibility label; opening a room makes no new request for a page whose targets are on the page.
*Tier:* expected `ota`.
*Blocked on:* nothing for attributed rooms. Private rooms' names and counts wait on B.

### Slice D: agent reads

`rooms/keys/browse` 0.4 and `rooms/keys/read` 0.2 carry `createdAt`, `createdBy` and `bodyStoredAt`. A read may name up to 32 keys, "each answered on its own in `results`", and a key the agent didn't reach answers `rooms/keys/read:notAttempted`, which is retryable.

**Client changes.**
1. Discovery: `browseType` and a new `readType`, newest served first, with 0.3 and 0.1 kept as fallbacks.
2. A page's reads become one batch of up to 32, not one task per key. The read lane (`trust-tasks/module/VtaClient.ts` `inReadLane`, 3 at a time) still applies, per task. `notAttempted` retries only those keys.
3. Order by `createdAt` where present (§7), else today's order.
4. Unread: a record whose `createdAt` is older than what was last seen is a rewrite, not a new message. New keys are read in one batch, so a reaction stops counting as unread.
5. `createdBy` feeds C's rewrite rules. `bodyStoredAt` feeds B.

**Don't turn it into a poll.** `read` 0.2 warns against this: only what's new is read.

*Acceptance:* an agent with and without 0.4 both work, tested; a batch with a `notAttempted` key retries only that key; opening a room of 10 is measured against today's on a lab simulator, with the same method as bifold #786; a reaction never counts as unread when its batch was read.
*Blocked on:* a VTA serving them (§6).

---

## 6. Slice E: writing, and the agent it needs

**The agent to watch for.** Upstream is doing this in three stages. VTI vendors the specs itself, so a `trust-tasks-rs` release isn't a precondition.

| Stage | What | State at VTI `2afa34e0` | Unlocks |
|---|---|---|---|
| 1. VTI #2449 | The VTA serves `seal` 0.3 and `act` 0.11, and accepts `recordMembers`. `pnm rooms profile set --record-members` writes it | Merged, in no tag yet | E, once tagged and on the Farm |
| 2. VTI #2451 | Hosts serve `put` 0.5, `list` 0.6 and `get` 0.3, and stamp `createdAt`, `createdBy` and `bodyStoredAt` | Open | Part of D |
| 3. Not started | The VTA serves `browse` 0.4 and `read` 0.2 | "Follows" in #2449 and #2451 | D, and B's stage 2 |

**A tag isn't enough on its own.** Each member's VTA and each room owner's VTA has to run it, and for lab rooms the Farm has to offer it. Records already stored have no `createdAt`, `createdBy` or `bodyStoredAt`: #2451 runs no migration, so old rows read without them, which the draft's fallbacks cover.

**The writer's rule is ours.** `seal` 0.3 doesn't check `recordMembers` (#2449: "Neither checks the room's recordMembers"), so Keyring has to apply it itself.

**How it's watched.** On each pass of the upstream check: `git tag --contains` for #2449's and #2451's merge commits, `git grep -l 'keys/browse/0.4'` in `external/verifiable-trust-infrastructure` at `origin/main`, and whichever version the Farm offers.

**Steps.**
1. Read the profile: `rooms/keys/profile/read` 0.1, once per room epoch: "A writer MAY rely on a profile it resolved within the room's current epoch". This also makes Keyring a profile reader, which rollout step 1 requires, so it ships with or soon after A, before any agent is ready.
2. Discover: `rooms/keys/seal/0.3` in the agent's served types.
3. Gate per member, per room: "A writer MUST NOT write `kind`, `inReplyTo`, `writtenAt`, `editedAt`, `width`, `height` or `preview` into a room unless the room's current profile" lists that member. When a member isn't listed: send an untitled message as today, and the long-press sheet offers Copy and says "Replies and reactions aren't on in this room yet" (the mock's off state).
4. Reactions: a new opaque key; changing one is a new version with the new value, "A new version of a reaction record with a different non-empty value changes that author's reaction"; withdrawing is an empty version. Keyring writes one emoji, one reaction per person, per message, and reuses chat's `ReactionBar` and `EmojiPickerSheet`.
5. Replies: `inReplyTo` with `key`; `version` too, so "changed since" can work. Long press offers Reply, through `MessageActions`.
6. Withdraw and edit: an empty version for withdrawal; `editedAt` on edits, keeping `writtenAt`. Offered only on your own messages. The note editor keeps every member it read, so it no longer needs A's guard: a rewrite carries `kind`, and a reaction's `inReplyTo`, and goes through `seal` 0.3. Where the agent or the room's profile can't take them, Edit stays off.
7. Every message carries `kind: message` and `writtenAt` where listed.

*Acceptance:* editing another client's record keeps its `kind` and other members, byte for byte apart from `title`, `body`, `version` and `editedAt`; with a member unlisted, the wire body is byte-identical to today's; with it listed, the body validates against the released schema and a `pnm rooms get` of it verifies; a body with these members written under seal 0.2 is impossible by construction; a lost response on a reaction leaves one record; a live two-client check on a lab room, Keyring with the plugin, in both directions.
*Tier:* expected `ota`, but signing content needs a maintainer's word regardless.
*Blocked on:* the agent above, and an owner listing members for a room.

---

## 7. Decisions, and what rollout means for us

**Rollout order, from** *Turning them on*: "(1) the readers, including every reader of the room's profile ...; (2) the owner's key holder ...; (3) on the sealed tiers, the key holders that seal for the room's writers (`rooms/keys/seal/0.3`); (4) then the profile."

| Step | What it means for Keyring | Who |
|---|---|---|
| 1 | Slice A and the profile read reach every tester. Older installs are the risk: "A reader that ignores the members it does not know shows a reaction as a post" | Us, by OTA; then a store build for anyone who doesn't take OTAs |
| 2 | Each room owner's VTA runs the release in §6 | Community owners; the Farm for lab agents |
| 3 | Each writer's VTA does too. Keyring checks discovery, so a member on an older agent keeps sending plain messages | Members, the Farm |
| 4 | The owner or a curator lists the members. No room lists by default, and Keyring has no UI for this; `pnm` or the portal does it | Room owners |

So Keyring's job is step 1, early, and Keyring can't move step 4 by itself. **The first room to list members is a lab room.**

**Decisions.**
1. **What a record that can't be checked shows. Open, waiting on stage 1's report.** The draft shows a placeholder, which "shows none of the record", and doesn't tell a temporary failure apart: "it no longer resolves, or its method reports it deactivated". The alternative is its words marked "sender not confirmed". That departs from the draft and has two more costs. With no check the author can't be named, so the words appear with no name, and `kind` can't be trusted either, so a reaction could show as a message. Stage 2 is conditional on this.
2. **When a real community's room may list members. Decided:** once the OTA carrying A and the profile read has reached all active testers, and a store build carries it too.
3. **Order by `createdAt`. Decided.** "A reader MAY instead order a conversation by `createdAt` throughout". It's what our chat does, and a sender's clock can't move it.
4. **Notes stay apart from the conversation. Decided.** Other clients may show both together, so a thread can look different in each.

**Decided, waiting on others:** the agent release (§6), upstream.

**What #900 and the note line (#923) become.** Both stay, and both follow `isNote` from its one place, as #923 says it was built to.
- **Untitled notes.** `kind: note` with no title now counts. #900's card and #923's line print a title, so they need words for an untitled note.
- **Titled messages.** A titled `kind: message` stays in chat, with no line.
- **Reactions.** Never counted and never a line.
- **Unknown kinds.** They read "Note:", which matches the rule.
- **The line's time.** #923's line moves on an edit, because `updatedAt` does. With `createdAt` from D it stays put. Its "Note:" wording stays either way.
- **"Message" wording.** #900's "a message is a message" matches `kind: message`; no change.
- **Removed-note markers.** Today every retracted record shows as a note marker in Notes. Under *Tombstones* a retracted message belongs "where the message was", where a reader held it, and otherwise a tombstone has no kind. A retracted reaction or message would read as a removed note, so the marker's words become neutral, and a held message's marker moves to the chat. This belongs with C.
- **Note text.** A note's body is markdown "rendered inert", and Keyring shows it as plain characters. That's allowed to stay for now.

---

## 8. If the draft moves

#1027 is checked on each pass of the upstream check, and anything that touches a slice goes to whoever is building it the same day.

| If this moves | Slices | What changes |
|---|---|---|
| Kind names, the note default, how an unknown kind reads | A, C | `isNote` and its table. One OTA |
| Reaction limits or normalisation | A, C, E | One function, and its tests |
| The untitled MAY | A | The hardest one: every post today depends on it. Raise it the same day |
| Withdrawal, tombstones | A, C | The not-shown row and the withdrawn line |
| `createdBy`, `createdAt`, `bodyStoredAt` | B, C, D | Field names only, if the meaning holds |
| *Which DID document*, placeholder | B | Stage 2's design; stage 1 only counts |
| `read` 0.2's batch shape, or the 32 limit | D | Client batching. Nothing shipped until an agent serves it |
| `recordMembers`, `seal` 0.3, rollout order | E, §7 | Gating. Nothing shipped until an agent serves it |

---

## 9. What it costs

Measured for #925, with the real check under Hermes:

| | A check | First in an app run |
|---|---|---|
| Hermes on a fast Mac | ~15 ms | ~260 ms |
| Android emulator on an arm64 Mac mini | 30–50 ms | 570–790 ms |
| A phone | Not yet measured; #925's log line reports it | |

A DID document fetch was 2–6 KB and 0.4–1 s for three lab DIDs. Each read today is about 0.47–0.84 s through the agent (lab simulator, 30 October), with 3 at a time. Enforcement should be re-budgeted with the phone's number before B's stage 2 is designed further.

---

## 10. Order of work

1. **A**, now. Mock not needed; nothing new is shown.
2. **Profile read** (E step 1), right after A, since rollout step 1 needs it.
3. **C**, on the draft: attributed rooms first, behind mocks.
4. **B stage 1** merges after review, reports, and decision 1 follows. Then stage 2, once D's fields exist.
5. **D**, client code against fixtures whenever convenient; live when the agent exists.
6. **E**, when the agent exists and a lab room lists members.
7. **F**, when upstream answers. Today rooms poll, and names come from what Keyring already shows.

## Open upstream (slice F)

**Decided, waiting on upstream; no build here.**
- **New-record signal.** Nothing in the rooms family tells a member there are new records, and `notifications/notify` isn't a per-record signal. Defining one is upstream's call. Sealed kinds mean a reaction would wake a phone like a message would, so Keyring would still read before saying anything. Until then, rooms keep polling (`useRoomRows.ts`).
- **Member names.** `_shared` 0.2 defines none. Quotes and chips on `private` rooms need this and B.

*Acceptance:* each has an upstream reference recorded here, and a slice opened only when there's something to build on.
