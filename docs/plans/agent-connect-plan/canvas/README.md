# The UI/UX canvas, exported

Exported from the UI/UX lane's canvas, artifact version `1795797015-5052 (the UI/UX lane's canvas version 45, 2026-11-27)`, by `scripts/plans/export-canvas.py`.
One PNG per artboard, in the canvas's order, rendered with headless Chrome at the board's size at twice the
pixel density from the published artboard files and their shared stylesheet; `sheet.png` is all of them, three
to a row. These are the design the screens are built to (D41, the plan's section 8.6); the kit SVGs in `../mockups/`
are the checked source for the copy, and only that. Re-export when a new canvas version is approved.

A re-export changes the bytes of most frames whose drawing did not change: headless Chrome's anti-aliasing of
text differs from run to run. So compare each changed frame with its committed copy as a thresholded
difference image (a block of changed content shows; speckle across all the text does not), not by PSNR, which
scores a one-letter change and run-to-run speckle alike; and commit only the frames with a changed block. The
sheet is built from the frames of the run that made it, and is not pinned to the committed frames' bytes, so a
partial commit does not require rebuilding it.

| # | File | Board | Size |
|---|---|---|---|
| 1 | `01-terminal.png` | T The terminal meanwhile (the plugin, not Keyring) | 560×340 |
| 2 | `02-main.png` | 1 Connect: name, memories, what it can use them for, 4 hours | 390×1060 |
| 3 | `03-new-memory.png` | 1b New memory: name it | 390×844 |
| 4 | `04-scan.png` | 2 Scan the code in your terminal | 390×844 |
| 5 | `05-number.png` | 3 Enter the number, one try | 390×844 |
| 6 | `06-wrong-number.png` | 4 Wrong number: nothing connected | 390×844 |
| 7 | `07-approve.png` | 5 Approve: HCP's checklist, with face or fingerprint | 390×1000 |
| 8 | `08-connected.png` | 5b Connected, until when; Keep it connected | 390×844 |
| 9 | `09-keep-connected.png` | 5c Keep it connected: only while it is temporary, never pre-selected | 390×844 |
| 10 | `10-expired.png` | 18 Code expired | 390×844 |
| 11 | `11-not-administrator.png` | K23 The guard: a phone that is not a full administrator ends the connect | 390×844 |
| 12 | `12-agent-list.png` | 6 AI agents: the My Agent tab's first screen | 390×844 |
| 13 | `13-agent-list-states.png` | 6b Reference, not a real screen: every status a list row can show | 390×1320 |
| 14 | `14-agent-sheet.png` | 7 Agent sheet, opened in a room: owner, Answers other people | 390×844 |
| 15 | `15-answers-on.png` | 8 Turning Answers other people on (from the sheet or the details) | 390×844 |
| 16 | `16-agent-details.png` | 11 Agent details (the whole scroll; a temporary agent) | 390×1150 |
| 17 | `17-details-revoke-not-confirmed.png` | 11b Details: Revoke not confirmed | 390×844 |
| 18 | `18-details-key-changed.png` | 11c Details: the agent changed its key (a persistent agent) | 390×844 |
| 19 | `19-revoke.png` | 17 Revoke (with the P2 row) | 390×844 |
| 20 | `20-settings.png` | 19 Settings: the My VTA row | 390×844 |
| 21 | `21-change-memories.png` | K20 Change memories: let it use one more (asks first) | 390×844 |
| 22 | `22-stop-memory.png` | K20b Change memories: stop using one | 390×844 |
| 23 | `23-delete-memory.png` | K21 Delete a memory (P1) | 390×844 |
| 24 | `24-memory-access-changed.png` | K22 Agent details: its memory access changed | 390×844 |
| 25 | `25-contacts.png` | 9 Contacts: the agent is a contact | 390×844 |
| 26 | `26-messages.png` | 10 Messages, All chip: the agent chat among people and rooms | 390×844 |
| 27 | `27-agent-chat.png` | 10b Agent chat: the header variant | 390×844 |
| 28 | `28-agent-chat-waiting.png` | 10c Agent chat: not connected, waiting | 390×844 |
| 29 | `29-messages-people.png` | 10d Messages, People chip: people and your agents | 390×844 |
| 30 | `30-messages-community.png` | 10e Messages, a community chip: its rooms only | 390×844 |
| 31 | `31-room-mention.png` | R Room: a mention, and the agent's post | 390×844 |
| 32 | `32-composer-plus.png` | 12 Composer +: Add a file, Add my agent | 390×844 |
| 33 | `33-composer-plus-refused.png` | 12b The + where the room's owner hasn't allowed agents | 390×844 |
| 34 | `34-agent-picker.png` | 12c More than one agent qualifies (layout assumed) | 390×844 |
| 35 | `35-add-to-room.png` | 13 Add the agent to this room | 390×844 |
| 36 | `36-memory-for-room.png` | 14 What Notes helper remembers (read-only) | 390×844 |
| 37 | `37-room-agents.png` | 15 Room details: Agents in this room | 390×844 |
| 38 | `38-room-members.png` | 16 Members: the Agents section, with another member's agent | 390×844 |
| 39 | `39-other-agent-sheet.png` | 20a Another member taps the agent: whose it is, with proof (D30) | 390×844 |
| 40 | `40-other-agent-unknown.png` | 20b The same tap with no proof: Keyring can't tell | 390×844 |
| 41 | `41-credential-give.png` | 24a Wallet: a credential's "Give to an agent" | 390×844 |
| 42 | `42-credential-pick-agent.png` | 24c Give "Degree" to an agent: the agent and its memory | 390×844 |
| 43 | `43-agent-add-credential.png` | 24b "Add a credential", from the agent details | 390×844 |
| 44 | `44-give-credential.png` | 24 Give "Degree" to "Notes helper": what to share, and what it's for | 390×844 |
| 45 | `45-share-credential.png` | 25 Approve: "Share these with "Notes helper"?" | 390×844 |
| 46 | `46-memory-credentials.png` | 26 What a memory holds: credentials, valid and revoked | 390×844 |
| 47 | `47-revoked-credential-chat.png` | 26b Agent chat: Keyring says a credential was revoked | 390×844 |
| 48 | `48-ask-each-time-chat.png` | P1 PROPOSED, not in the plan: the agent asks in its chat | 390×844 |
| 49 | `49-ask-each-time-share.png` | P2 PROPOSED, not in the plan: the phone shares straight with the clinic | 390×844 |
| 50 | `50-hcp-approve.png` | H1 Approve, the demo variant | 390×900 |
| 51 | `51-hcp-new-memory.png` | H2 Add a memory for the agent | 390×844 |
| 52 | `52-hcp-agent-list.png` | H3 The list: "What it saw" and "Revoke" | 390×844 |
| 53 | `53-hcp-what-it-saw.png` | H4 What Notes helper saw (P1) | 390×844 |
| 54 | `54-hcp-revoke.png` | H5 Revoke: "We'll tell it" | 390×844 |
| 55 | `55-hcp-revoke-states.png` | H6 After revoking: the three lines (reference, not a real screen) | 390×920 |
| 56 | `56-memory-use.png` | 11d PROPOSED: how much each memory holds (P0, no rooms) | 390×1000 |
| 57 | `57-memories-list.png` | 57 Your memories: the list (step 7.16, P1) | 390×844 |
| 58 | `58-acting-as.png` | 58 Acting as: more than one persona (finding 18) | 390×844 |
