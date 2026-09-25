# Keyring role drivers (`lib/keyringRoles.js`)

Keyring's half of a vetting ceremony, one step per function. The counterpart can be another Keyring (`run-vti-vetting.js`) or the openvtc TUI, which the interop harness drives (keyring-wallet#150). The caller owns the Appium sessions and the order of the steps.

Each step does four things:
- **Checks where the page is.** It asserts the vetting page's step testID, `VettingApplicantStep_<step>` or `VettingVetterStep_<step>` (keyring-bifold#115), and the words that show the step took effect.
- **Returns a record.** It is also appended as one JSON line to the run's shared log, `opts.log` or `E2E_STEP_LOG`. The counterpart appends to the same file, so the two sides line up by time.
- **Fails by name.** A step that fails throws a `StepError`. Its record has a screenshot, the page source, and the step the page was stuck on, with for how long.
- **Never waits without a deadline.**

```
{ role, step, platform, device, ok, startedAt, endedAt,
  observed: { stepId, … }, value?, error?, screenshot?, source? }
```

## Steps

| Function | Ends on (step testID) | Value | Pairs with openvtc (177a218) |
|---|---|---|---|
| `applicant.reset` | none | none | none |
| `applicant.start` | `ticket` | none | none |
| `applicant.request({ticketUri, via})` | a request card | none | TUI vetter: its ticket; the request arrives (vetter.rs:365-442) |
| `applicant.awaitAccepted` | `waiting` | none | auto-accept: `request#response` + eligibilityVp (vetter.rs:426-441) |
| `applicant.readMatchCode` | `match` | `XXXX-XXXX` | `o` then Enter: `vetting/session` (VA:2018-2113); the code comes from the session document id |
| `applicant.awaitMatchCodeChange({from})` | `match` | the new code | the vetter reopened the session (F4) |
| `applicant.confirmMatch` | `send` | none | none (spoken) |
| `applicant.sendCard` | `checking` | `{cardSentMs}` | the vetter receives `session#response` and runs `verify_card` (vetter.rs:526-579) |
| `applicant.awaitStatement({cardSentMs})` | `apply` | none | `a` then Enter: `credential-exchange/issue` statement (VA:2115-2217) |
| `applicant.apply` | `member` / screen outcome | `member` \| `deferred` \| `pending` | none; the caller checks it against the community's records |
| `vetter.openDesk` | `ticket` | none | none |
| `vetter.issueTicket` | `ticket` | `vetting-ticket:` URI | TUI applicant: `r`, paste the link (VA:1239) |
| `vetter.awaitRequest` | `request` | none | the TUI sends `vetting/request` |
| `vetter.openSession` | `match` | `XXXX-XXXX` | the TUI receives the session: "session open — read the code together" |
| `vetter.confirmMatch` | `waitCard` | none | none |
| `vetter.awaitCard` | `check` | the claims shown | `c` shows the preview, Enter sends the card (VA:2575-2637) |
| `vetter.attest` | `done` | none | the TUI: "statement received" (applicant.rs:1037-1110) |
| `community.leave({keep})` | none | `purge` \| `tombstone` | none |

**`request` via:**
- `field`: type the link into the ticket box.
- `scanner-paste`: the scanner's paste screen.
- `deeplink`: hand the link to the OS, as a tap on it in a message does (Android `am start … VIEW`, iOS `simctl openurl`). It needs the `vetting-ticket` scheme registered (keyring-wallet PR, after 223).

## What openvtc does that the drivers must expect

Read from the pinned `external/openvtc` at 177a218. `VA` = `openvtc/src/state_handler/vetting_actions.rs`.

- **Every refusal is silent.** A card, session, acceptance or statement that openvtc refuses is logged as a `warn!` and nothing goes back (inbound.rs:409, 650, 683, 724, 794). On the Keyring side the only symptom is a step that never comes, which is why every await names the step it is stuck at and for how long.
- **A card lives at most 15 minutes** (vta-sdk `vetting/card.rs:42`). `awaitStatement` records the card's age when it times out.
- **Reopening a session replaces it.** There's a new session document, so a new match code, and a card for the old session is refused (vetter.rs:535-542). The statement's `taskContext` is the session document id.
- **The statement is matched on `cardDigestMultibase`**, a JCS digest of the card **without** its proof (dtg-credentials `digest_multibase_json`; applicant.rs:1076-1081). A mismatch drops the statement silently. That is the maintainer case of 2026-09-25 (cd: Keyring hashed the card with its proof).
- **Keyring's own refusals are not silent.** When Keyring refuses a document from openvtc unread (bad proof, wrong signer, wrong type; keyring-bifold#128), the screen shows `VettingEnvelopeRefused` with a reason. Every `awaitStep` then fails at once with that reason, and so does `awaitStatement`. A refused statement shows `VettingStatementRefused` (#116).
- **The TUI vetter's first "open session"** may only fetch the community's manifest. It has to be done twice (VA:2036-2061).

## openvtc main (ed13d29) against the pin (177a218)

The peer messages are unchanged in both roles: request, acceptance with eligibilityVp, session, card, statement, match code and card digest. The order the drivers follow is unchanged too. The differences:

- **The openvtc applicant takes only a pasted `vetting-ticket:` link** (056f544). A typed short code is no longer accepted, so a Keyring vetter must hand over the link or the QR code.
- **A DIDComm problem-report threaded on the request id counts as a refusal** on the openvtc applicant (b2c7af7).
- **Peer messages carried in the binding envelope are accepted** (b2c7af7). At 177a218 they were dropped silently.
- **New optional TUI screens** can come before the openvtc applicant answers a session: making a face in the flow, confirming an abandon, confirming a ticket delete (421547a, 58d99ed, e5a3ada).
- **An application the openvtc applicant abandons** tells the vetter nothing. A Keyring vetter that opens a session afterwards gets no answer.
- **vta-sdk moved from 0.42.1 to 0.51.0, and dtg-credentials from 0.9.1 to 0.11.0** inside vta-sdk. The card, statement and match-code internals of 0.51.0 were not diffed, because they are not in the local registry. Treat them as unverified until they are.

## Logs and installs

- `startDeviceLog({platform, udid, file})` captures `adb logcat`, or on an iOS simulator the app process's unified log. It is bounded (200 MB by default) and writes a `.pid` file next to the log, so it can be stopped by PID.
  - Known gap: an iOS Release build writes no JavaScript console lines to the unified log.
- `installedHash({platform, udid})` returns the installed app's hash: the pulled APK, or the iOS bundle's `main.jsbundle`.
  - Gate runs install fresh and compare it with the build. Never use `E2E_KEEP_APP` for a gate run (it reuses whatever is installed).
