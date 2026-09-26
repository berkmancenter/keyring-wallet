# The openvtc TUI, mapped for driving over a pseudo-terminal

Read from upstream source on 2026-09-25: openvtc `ed13d29` (upstream main) and
`177a218` (our pin, an ancestor about 40 commits behind). Paths are relative to
`openvtc/src/` unless they start with `openvtc-core/`, and line numbers are at
`ed13d29`. Differences at `177a218` are marked **[177a218]**. Every string the
harness waits for is quoted here with its source; when a pin advance moves one,
the harness fails loudly, and this file is updated with it.

## Setup (`openvtc -p <profile> setup`)

- `-p/--profile` (default `default`); `OPENVTC_CONFIG_PROFILE` overrides it.
  Config: `$OPENVTC_CONFIG_PATH` or `~/.config/openvtc`, file
  `config-<profile>.json`. Secrets go to the macOS Keychain (service `openvtc`,
  account = profile). One process per profile (process lock).
- Pages, in order:
  1. StartAsk: `" New profile setup "` (start_ask.rs:106). Enter.
  2. VtaEnterDid: `" Connect to your VTA "`, prompt `"Enter the VTA's DID:"`
     (vta_enter_did.rs:83, 103). Type the DID, Enter. The minted setup DID
     appears inside the printed command on the next page (`--admin-did
     did:key:…`); the `"Setup DID minted"` line is not on screen (measured at
     ed13d29, 2026-09-25).
  3. VtaAclInstructions: `" Authorise the setup DID via PNM "`
     (vta_acl_instructions.rs:118). Context id `openvtc` by default. Run the
     printed command on the agent:
     `pnm contexts create --id <ctx> --name "OpenVTC" --admin-did <setup did:key> --admin-expires 1h --admin-holder`
     (:258–263). `--admin-holder` grants `persona-holder`; without it faces are
     refused. Then Enter.
  4. VtaProvisioning: wait for `"Bootstrap complete — admin key rotated,
     ephemeral setup DID retired."` (vta_provisioning.rs:179), then Enter. On
     failure: `"[ENTER] to return to the ACL instructions and retry."`
  5. ContextOccupied, only if the context already holds something:
     `"This Trust Context is already in use"`. Keys `r`/`c`/`b`; Enter does
     nothing.
  6. TokenStart (default build): `" Step 1/6: Set up hardware token "`. Press
     `s` to skip.
  7. UnlockCodeAsk: `"Yes, require unlock code (recommended)"` / `"No, do not
     require unlock code"`. Tab/↑/↓, then Enter. "No" leads to `" SECURITY
     WARNING "`.
  8. FinalPage: wait for `"Account setup completed successfully."`
     (setup_wizard.rs:150–166) BEFORE pressing Enter. Enter does not check
     completion.
- Later launches of an encrypted profile prompt for the passphrase before the
  TUI starts (`--unlock-code-file PATH|-`). The loading screen needs Enter:
  `"Press [ENTER] to continue — connecting in the background"`
  (ui/pages/loading/mod.rs:667).
- There is no mediator prompt: the VTA's advertised mediator is used. A persona
  is minted by the VTA on its first WebVH server, during a join or from
  My Identity → Personas → `n`.

## Main page

- Menu: Communities, Inbox, My Relationships, My Credentials, **Vetting**, My
  Identity, Settings, VTA Service, TSP Relationships, Logs, Help / Status, Quit
  (main_page/menu.rs:25–71). ↑/↓ moves; Enter or Tab focuses the content; Esc
  returns to the menu. Ctrl+K opens the community switcher from anywhere.

## Joining a community

- Communities, then `j`. EnterDid: `"Enter the community's DID or agent
  name:"` (join_flow/vtc_enter_did.rs:134). A bracketed paste starting with `{`
  loads an invitation (VIC): `"✓ Invitation credential loaded — it will be
  presented to the community."` Progress: `"Join request sent."`
  (join_progress.rs:103). **[177a218]** the EnterDid prompt is the same
  (vtc_enter_did.rs:118; the invitation lines sit above the input, :197), and
  there is no routes page and no Answers page: Enter asks the community whether
  it vets (" Joining {name} ", vetting_requirements.rs:150/:168/:191) and `j`
  there goes on to the persona choice.
- A vetter role is not taken in the TUI: the community sends it, and the notice
  reads `"{community} named you a vetter until {date}. You can hand out
  tickets."` (openvtc-core/src/vetting/inbound.rs:263).

## As vetter

- Vetting → content. Tabs `" Applications (n) "` | `" Vetting desk (n) "`, with
  Tab between them; ←/→ on the desk switches between Requests, Tickets and
  Issued.
- **Ticket:** Tickets view, then `t`, form `"Hand out a ticket"`, then Enter.
  Status: `"Ticket {code} for {community} — press ⏎ to show its QR code, or u to
  copy its link. …"` (vetting_actions.rs:2260; **[177a218]** `"— read it to the
  person, or copy it with y."`, :2008). The `vetting-ticket:` link is the last
  content line before the key hints (vetting_panel.rs:1686; 177a218 :1344). It
  wraps across rows, so the rows are joined when scraping it; PgDn/End if the QR
  pushes it below the fold. A PTY has no clipboard.
- **Request:** accepted automatically when the ticket is valid. State
  `"accepted — open a session when you are together"`
  (vetting_actions.rs:335).
- **Session:** Requests, then `o`, form `"Open a session"`, then Enter. If the
  required claims are unknown, the first Enter only asks the community:
  `"Asking the community which claims it requires — open the session again in a
  moment."`, so press `o`, Enter again. Success: `"Session open. Read the match
  code {code} to each other…"` (:2351; 177a218 :2099), then `"Session sent —
  waiting for their card."` (:3368). Reopening replaces the session and changes
  the match code.
- **Card:** `"card verified — check the person, then attest or decline"`
  (:347).
- **Attest:** `a`, heading `"Check the person, then attest"`. Five fields: Method
  (←/→), Documentation (←/→), Relationship (←/→), `We read the code` (Space),
  `I attest` (Space). Enter signs and sends. Then **`"Statement signed and
  sent."`** (:3372; 177a218 :2870); state `"statement signed"`.

## As applicant

Read from source at `ed13d29` for `tuiRoles.js`'s applicant steps
(2026-09-25); not yet run. 177a218 notes were re-read at 177a218 the same day; see "At 177a218" below.

- **Persona:** My Identity → the Personas tab (one of six, marked by colour
  only; its content is `" N persona(s)"` or `"You have no personas yet."`,
  identity_panel.rs:305, :319), `n`: `"What should this persona be called?"`
  (create_persona_overlay.rs:144), type the name, Enter; `"Where should this
  persona's DID live on the hosting server?"` (:190), Enter lets the server
  pick; `"✓ Persona created"` (:295). The DID under it is drawn unwrapped in a
  96-column box (:102, :299), so a long `did:webvh` is clipped. The full DID is
  in the debug log: `"minted persona advertises #tsp"` (debug) or `"minted
  persona has no #tsp service"` (warn), field `did=`
  (state_handler/setup_sequence/vta.rs:524-532).
- **Application:** Vetting → Applications tab, `n`: `"Apply to be vetted"`
  (vetting_panel.rs:202). Two fields: `Community DID` (text; a bracketed paste
  fills it) and `Join as` (Tab to it, ←/→ to cycle; shows `label (DID shortened
  keeping the end)`, :211-223; vetting_actions.rs:897, :955-960). **[177a218]**
  plus Context. Enter: `"Application started."` (vetting_actions.rs:1244) is at
  once replaced by `"Asking the community what it requires…"` (:1152), because
  starting also asks for the requirements (:1252); wait for either, then for
  the `Requires` line to stop reading `"not known yet — m asks the community"`
  (vetting_panel.rs:827-836).
- **One application per (community, persona)** (openvtc-core vetting/book.rs:754-771):
  starting again returns the existing one. Every application to a community
  shows the same name in the list, so the highlighted one is identified by
  `"Joining as <DID, SCID shortened 4…4>"` (vetting_panel.rs:820;
  display.rs:137). `r`, `c`, `f`, `j` act on the highlighted application
  (ui/pages/main/mod.rs:2805-2836).
- **Faces:** the card is read from the face the application wears in its
  context. With none, `f` says `"You have no faces yet — make one under My
  Identity with the claims the community requires, then press f again."`
  (vetting_actions.rs:3110; measured on the lab 2026-09-25), and the Keyring
  vetter's session asks for `name.legal`. **Making one** (My Identity, tabs told
  apart by their key hints, identity_panel.rs:278, :285): Your attributes → `n`,
  `" Add an attribute"` (:1380), fields Type, Label, Value type (`◂ string ▸`
  by default), Value (:1395-1422), Enter: `"Saved the attribute."`
  (persona_actions.rs:1748, :2338). Then Faces → `n`, `" Make a face"` (:1450),
  Name, Tab to `" Shows these attributes (N ticked)"` (:1471), ↑/↓ and Space
  tick, Enter: `"Saved the face."` (persona_actions.rs:1801, :2338).
  **Binding:** attributes and faces are the holder's, above every context and
  not tied to a persona (holder_grant.rs:1-9); the Faces tab makes a face that
  "May be worn anywhere" (identity_panel.rs:826), and the vetting picker lists
  all of them (vetting_actions.rs:2729). WEARING is per context and persona:
  `f` on the application → `"The face you show vetters"` (vetting_panel.rs:359),
  ↑/↓, Enter → `"Vetters are shown your {name} face…"` (vetting_actions.rs:3228)
  binds it in the application's own context (:2050-2082, :2115-2149). So a face
  can be made before or after the application; wearing must come after it.
  The picker's `"Make a face for this community"` row (makes and wears in one
  step) is only reachable when at least one face exists. **Persona-holder
  missing:** on the vetting page `"Your faces need one more grant"`
  (vetting_panel.rs:239, from `f` or the new-face form only,
  vetting_actions.rs:3175-3203); on My Identity `"Could not read your
  attributes/faces from the agent."` (identity_panel.rs:1328) with `pnm acl
  update … --capabilities persona-holder` (holder_grant.rs:52). Starting an
  application cannot show it.
- **Ticket:** `r`, `"Ask a vetter"` (vetting_panel.rs:474; 177a218 :280), one field `Ticket
  link` (:487). A bracketed paste of a link reads it at once: `"Read the ticket
  link. It goes to {vetter} — Enter sends the request."` (vetting_actions.rs:1384)
  and a `Goes to` row (vetting_panel.rs:493); Enter sends. A typed link is read
  on Enter instead (vetting_actions.rs:1261-1296), so both end in the same
  send. The link must name the application's community (openvtc-core
  applicant.rs:692-697; errors :96, :100). Sent: `"Request sent to {vetter} —
  it is answered only if your ticket is valid."` (vetting_actions.rs:3361).
  Keyring's `vetting-ticket:?v=1&community=…&vetter=…` link is the same scheme.
  **[177a218]** two fields (Vetter DID, Ticket code; vetting_panel.rs:293,
  :299). A bracketed paste of a link fills both at once (ui/pages/main/mod.rs:254-267):
  `"Filled in from the ticket link: {vetter}. Enter sends the request."`
  (vetting_actions.rs:1354), then Enter sends. Only a link that arrived as
  typed text needs two Enters: the first fills the form (:1238-1240).
- **Rows** are the highlighted application's `Vetters` block
  (vetting_panel.rs:880-929), not selectable, states from
  vetting_actions.rs:265-300: `"sent — waiting for the vetter"`, `"accepted —
  waiting for a session"` **or `"accepted — {the vetter's session hint}"`**
  (:269-275), `"session open — read the code together, then send your card"`
  with `"   code <MATCH>"` on the same line (vetting_panel.rs:893-899), `"card
  sent — waiting for their statement"` (code still shown), `"statement
  received"`, `"declined"`, `"refused ({code})"` with its meaning on the next
  line.
- **Card:** `c` (or Enter), `"Send your card"` (vetting_panel.rs:1216) with
  `"Match code {code}"` (:1237) and `"Read this code to the vetter, and hear it
  read back. Send only if it matches."` (:1243). No key confirms the code. The
  first Enter previews: `"This is what the card shows. Enter approves and sends
  it."` (vetting_actions.rs:3246) over `" The card will show"` (vetting_panel.rs:1271);
  failures `"This face cannot make the card: …"` (:3245), `"… holds none of …"`
  / `"Could not preview the card: …"` (:1899-1924). The second Enter sends:
  `"Card sent — the vetter checks it against you and your documents."`
  (:3285); a VTA step-up says `"Your VTA wants you to approve this disclosure…"`
  (:3300).
- **Statement:** received shows `"statement received"`. A **refused** statement
  shows nothing; only the log line `"vetting statement refused"`
  (inbound.rs:821), and the row stays `"card sent — waiting for their
  statement"`.
- **Join:** the application's `Next` line reads `"j — join now; your
  statements go with the request"` (vetting_actions.rs:496) once it meets the
  requirements. `j` opens the join flow for its community
  (ui/pages/main/mod.rs:2828-2836): `"Choose how to join"`
  (join_flow/vetting_requirements.rs:401). **Correction:** the vetting row reads
  `"Present your vetting statements"` (state_handler/join_flow.rs:281) only for
  a satisfied application of the persona in `"Apply as"` (:247), which is a row
  only while the cursor is on the vetting route (state_handler/join.rs:306-326)
  and opens on the first satisfied application — possibly an earlier run's
  (join_flow.rs:353-361); ←/→ cycles it. Enter on the route: `" Use an
  invitation for this community? "` (join_flow/invitation_choice.rs:93); `"Join
  without it — send an open request"` (:182) still presents the statements,
  which the submit attaches for this community and persona whatever the choice
  (join_flow.rs:3027-3044; `"Presenting N vetting statement(s) to the
  community…"`, :3034). Then `"Join request sent."` and, after leaving the
  page, the membership log line as for an invitation join. **[177a218]** there
  is no `j` on Applications; the path is Communities → `j` → the DID → Enter
  on the vetting page.

## At 177a218 (our pin), applicant side

Read from source at `177a218` on 2026-09-25 (external/openvtc), not run; the
vetter side differs only in line numbers and the ticket status text above.
`tuiRoles.js` branches on `at177(tui)`.

- **Persona:** the overlay is `" Create persona DID "` in ui/pages/main/mod.rs:
  `"Label for the new persona:"` (:3065), the path page (:3088), then a
  **context** page, `"Where should this persona's keys and DID live?"`
  (:3144), whose default row is a new sub-context named after the label
  (state_handler/create_persona.rs:44-58). `"✓ Persona created"` (:3200). The
  DID log line is setup_sequence/vta.rs:447/:451.
- **Application:** three fields, Community DID, Join as (`label  (whole DID)`),
  and **Context** (vetting_panel.rs:209-219). A persona minted into its own
  sub-context offers only that context. `"Joining as"` shows the whole DID
  (:508-511), wrapped by the panel.
- **Faces:** the same attributes/faces forms and messages as above
  (identity_panel.rs:1186, :1256, :1277; persona_actions.rs:925, :948, :1209).
  The picker's heading is `"The face vetters are shown"` (vetting_panel.rs:233),
  and `"{name} is already the face vetters are shown."` (vetting_actions.rs:1871).
  There is no holder_grant.rs; a missing persona-holder reads `"Could not read
  your faces: …"` (:2718).
- **Join with statements:** the next step reads `"join from Communities (j) —
  your statements go with the request"` (vetting_actions.rs:499); there is no
  `j` on Applications (ui/pages/main/mod.rs:2553-2558). Communities → `j` → the
  DID → Enter opens `" Joining {name} "` with `"Your application, as {label}"`
  (vetting_requirements.rs:220) — the FIRST satisfied application to that
  community, of any persona (state_handler/join_flow.rs:148-158), with no way
  to pick another and no way to abandon one. The label is `"Persona (<DID cut
  to 29 chars>...)"` until the persona has a community (openvtc-core
  config/mod.rs:394, :440-452). `"Joining now presents your N vetting
  statement(s)"` (:243), Enter → the invitation step as at ed13d29.
- **Wire:** 177a218 types a document for a community (the manifest request) as
  the task URI, not the Trust Task envelope; ed13d29 changed that because a VTC
  refuses it (VTI #1687, Keyring VTI-42; ed13d29 openvtc-core vetting/wire.rs:104-140).
  Against a current community, 177a218's requirements questions may go
  unanswered (a guess from the ed13d29 comment, not measured).
- **Config:** the format is unchanged (openvtc-core config/public_config.rs is
  identical), and ed13d29's new persisted fields are `serde(default)` additions
  (vetting book `requested`, application `face`), so an ed13d29 profile should
  load at 177a218 — and lose those fields on its first save.

## Evidence besides the screen

- `OPENVTC_DEBUG_LOG=/path` appends tracing output (no ANSI; default filter
  `info,openvtc=debug,openvtc_core=debug`), starting with the banner `"─────
  openvtc run started ─────"`. Vetting warnings to watch for: `"vetting card
  refused"` (inbound.rs:751), `"vetting statement refused"` (:821), `"vetting
  request refused"` (:552), `"vetting session not opened"` (:710), `"could not
  send vetting reply"` (message_dispatch.rs:322); on the applicant side also
  `"vetting document refused"` (:425), `"vetting acceptance for no request of
  ours"` (:600), `"vetting acceptance not applied"` (:676) and `"vetting
  session for a community we are not applying to"` (:695).
- A persona minted at runtime gets its listener then; a failure to start it
  is only in the in-TUI activity log (`"Persona created, but its live session
  could not start now…"`, state_handler/mod.rs:4182), not the debug log.
- Notices are persisted in `config-<profile>.json` under `logs.messages` (capped
  at 200).

## Hazards

- Bracketed paste on, mouse off. Only key-press events count. Vetting keys work
  only with the content panel focused.
- The state handler refreshes on 5 s, 15 s, 60 s and 3600 s intervals, which can
  redraw at any moment, so assert on a wait for a line, never on one snapshot.
- The `auto` theme sends an OSC background query first (500 ms timeout). Set
  `OPENVTC_THEME` explicitly.
- Enter on the main menu with **Quit** highlighted exits (ui/pages/main/mod.rs:176-178);
  Esc on the menu does nothing, so Esc is the safe way back to it.
- Every run's application stays on Applications; many runs push the
  highlighted application's details below the fold.
- Prompts outside the TUI: the passphrase (dialoguer), a config-version Confirm,
  and a possible macOS Keychain dialog.
