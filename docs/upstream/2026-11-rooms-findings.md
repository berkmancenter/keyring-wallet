# Data rooms: two findings for upstream (November 2026)

For the OpenVTC / VTI maintainers. Both came from testers using rooms from Keyring and from
the VTA Wallet browser plugin against live communities on 2–3 November 2026. Upstream source
is cited at fixed commits. "Read from source" means we read the code and did not run it.

| | Finding | Effect | What we're asking |
|---|---|---|---|
| [1](#1-a-second-authoritycredential-from-one-room-locks-the-member-out-of-it) | A second AuthorityCredential from one room locks the member out of it | The room can't be read or written by that member, and they can't clear it | Retire the earlier credential on accept, or define which one wins |
| [2](#2-rooms-have-no-record-kind-for-a-message) | Rooms have no record kind for a message | A chat-style client's messages read as untitled notes in other clients | A convention for telling a message from a note |

---

## 1. A second AuthorityCredential from one room locks the member out of it

### What happened

A member's agent held an AuthorityCredential and a MembershipCredential for a community's
room. The community then removed the member, invited them back, and re-issued the room offer.
The member accepted. One second after the accept was answered (`vtc/rooms/offers/accept/0.1`
at 22:14:31Z), the next act for that room failed, and every act since has failed the same way:

> conflict: this VTA holds more than one AuthorityCredential issued by room `…` to one
> persona; which one to attenuate from is not a question this can answer safely

What the member sees: the room is listed under its real name, but its posts, notes and files
never read, and nothing they post reaches the room. The community's members page confirms
that: the room's records are there, and none of the member's four attempted posts is among them.

**One live occurrence so far.** We didn't record the exact VTA and VTC versions at the time,
and we haven't reproduced it on a clean stack. The steps below are what we expect to reproduce
it.

### Why it happens (read from source)

All links are at VTI [`e84bb1ed`](https://github.com/OpenVTC/verifiable-trust-infrastructure/tree/e84bb1eda56e64a0e4ea4b151423ab30aa654cb5) (main, 4 November).

- [`room_oracle.rs` `principals()`, L159-L192](https://github.com/OpenVTC/verifiable-trust-infrastructure/blob/e84bb1eda56e64a0e4ea4b151423ab30aa654cb5/vta-service/src/operations/room_oracle.rs#L159-L192)
  gathers the room's AuthorityCredentials from the vault and returns `Conflict` when two name
  one subject. It has no tie-break on issue date, the room's epoch or a revocation list.
- [The same function, L194-L224](https://github.com/OpenVTC/verifiable-trust-infrastructure/blob/e84bb1eda56e64a0e4ea4b151423ab30aa654cb5/vta-service/src/operations/room_oracle.rs#L194-L224)
  does the same for MembershipCredentials ("which one to present"). So a re-issue that adds
  both needs both resolved.
- [`room_credentials()`, L425](https://github.com/OpenVTC/verifiable-trust-infrastructure/blob/e84bb1eda56e64a0e4ea4b151423ab30aa654cb5/vta-service/src/operations/room_oracle.rs#L425)
  finds them with a vault search on `type` and `issuer_did`, so every `Active` credential from
  that room is a candidate.
- We found nothing on the accept path that retires an earlier credential from the same room
  to the same persona. The new one is stored beside the old one
  ([`vault/credentials/receive/0.1`](https://github.com/OpenVTC/verifiable-trust-infrastructure/blob/e84bb1eda56e64a0e4ea4b151423ab30aa654cb5/vta-service/src/trust_tasks/cred_vault.rs#L113)).

The refusal itself is right: the VTA shouldn't guess. The problem is that the ordinary path of
remove, invite back, re-issue, accept walks into it, and nothing tells the member how to get out.

| Version | Same refusal? |
|---|---|
| vta-service 0.69.1 | Yes, `room_oracle.rs` L190 |
| vta-service 0.71.0 | Yes, `room_oracle.rs` L190 |
| main `e84bb1ed` | Yes, `room_oracle.rs` L190 |

So upgrading the agent doesn't help.

### What doesn't get the member out (read from source)

- **The room owner revoking the old credential.** `rooms/owner/revoke` signs the room's
  revocation list and delivers it to the hosts. Room credentials carry no `credentialStatus`,
  so the member's VTA never marks one Revoked, and `principals()` still counts two. Revoking
  by `--subject` would withdraw both, since both name the same persona.
- **Anything in a client.** Keyring has no safe way to choose between them, and shouldn't try.

### The one way out we can see (read from source, not yet run)

A vault search returns `Active` credentials only
([`query.rs`, L43-L60](https://github.com/OpenVTC/verifiable-trust-infrastructure/blob/e84bb1eda56e64a0e4ea4b151423ab30aa654cb5/vta-vault/src/query.rs#L43-L60)),
and `room_credentials()` doesn't opt in to archived ones. So archiving the older credential
should take it out of `principals()`, and `unarchive` undoes it:

```sh
pnm cred-vault query --filter-file f.json   # {"type":"AuthorityCredential","issuerDid":"<room DID>"}
pnm cred-vault get <id>                     # compare subject and dates
pnm cred-vault archive <older id> --reason "superseded by the re-issued offer"
# Repeat for type MembershipCredential if it also lists two.
```

That needs an admin of the agent at a command line, which a phone user won't have. We haven't
run it on the affected agent yet. Please tell us if this is wrong.

### To reproduce (expected)

1. A community owns a room. A member accepts its offer, so their VTA holds the room's
   AuthorityCredential and MembershipCredential.
2. Remove the member from the community and the room, without touching their agent.
3. Invite them back to the community and offer the room again.
4. The member accepts, as the same persona.
5. Any act for the room (`rooms/keys/browse`, `rooms/keys/act`) returns the conflict above.

### What we're asking

Any one of these would fix it. The first looks cleanest to us, but it's your call.

1. **On accept, retire the earlier credential.** When a VTA stores a room credential and
   already holds one from that room to that persona, archive the earlier one.
2. **Define which one wins.** `principals()` takes the newest valid credential and says so,
   rather than refusing.
3. **Give the holder a task for it.** The refusal names the credential ids, and a defined task
   drops one, so a client can offer the member a way out.

On our side, we're changing Keyring to tell the member the room can't be used, instead of
offering a retry that can't work.

---

## 2. Rooms have no record kind for a message

### What happened

Keyring shows a room as a conversation plus a list of notes. Until our 277.8 release it wrote
each message as a record body holding its own chat envelope:

```json
{"profile":"keyring.chat/1","eventId":"…","type":"message","content":{"format":"text/plain","text":"Hello"},"clientTs":"…"}
```

On the community's web page and in the browser plugin, those appeared as "(untitled)" or
"Untitled record", with that JSON as the text. Going the other way, a titled note written on
the web page showed only on Keyring's Notes screen, while the room's main view said "No posts yet".

### What we changed

From 277.8, Keyring writes a message's words as the record's plain `body`, as the schema describes
([`room.schema.json`, `SealedRecordBody`](https://github.com/trustoverip/dtgwg-trust-tasks-tf/blob/355c4169acd183e8c0021943ce820c8c22692d68/specs/rooms/_shared/0.1/room.schema.json#L111-L191):
"the record's text"), and record keys no longer carry a `note/` prefix, since a sealed room's key
"MUST be opaque". Read from the plugin's source
([`files.ts`](https://github.com/OpenVTC/vta-browser-plugin/blob/bf92427985b9f73522482c1d48375b2bb75992a7/packages/core/src/rooms/files.ts#L265-L267)),
the words should now show. A tester is checking that live. Records written before 277.8 stay
as they are.

### What's left, which only upstream can settle

A room is a library of notes and files: one body schema, and every reader refuses an unknown
member. So our rule that an untitled record is a message is only our convention. Four asks:

1. **A way to tell a message from a note**, such as a `kind` member or a profile. Then two
   clients can agree, and a client that doesn't know a kind has a defined way to show it.
2. **Captions on file records.** The plugin never shows a file record's `body`, so a photo's
   caption is invisible there.
3. **A label for untitled records.** Their first line would read better than "Untitled record".
4. **Replies, reactions and edits.** Is there a shared shape planned? Keyring has replies and
   reactions in one-to-one chats, and we'd rather adopt a convention than invent one for rooms.

---

## Contact

Please reply in the Keyring feedback group, or open an issue on this repository and mention
this file. We can run a change against our test communities as soon as it's on a release.
