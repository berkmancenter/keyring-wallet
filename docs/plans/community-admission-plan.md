# Community admission from Keyring — invite people and admit them from the phone

**Scope.** The basics a community member and a community administrator do most often, from Keyring
instead of the community's web pages: show someone how to join (a QR code or a link), see who has
asked to join, and admit or decline them. Everything else a community administrator can do stays
in the community's console and the `cnm` command line.

**Relation to other work.**
- [`openvtc-integration-plan/pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md)
  P6 ("Community administration (CNM scope)") is the parent design for administration from
  Keyring. This plan is a narrowed, current first slice of it: three operations instead of P6's
  roster, policy and VTA surface, read against today's upstream rather than the pin P6 was written
  on. P6's two-service split (§2.5: the VTC is a different service with its own access list and
  token audience) holds unchanged.
- [`ui-ux-improvements-plan.md`](./ui-ux-improvements-plan.md) owns the agent and community
  screens this plan adds to.
- The VTI findings source: VTI-Q47 (a community notifying an administrator through the
  administrator's own agent) is the upstream piece §6 waits on for a notification.

**Reviews.** See [`community-admission-plan/`](./community-admission-plan/):

| Companion | Contents |
|---|---|
| [2026-10-11-al.md](./community-admission-plan/2026-10-11-al.md) | The first draft's findings: what the CNM does today, which community tasks exist, what Keyring already reads and writes, and the UI options weighed |

Upstream read: VTI `49f5f1be` (tag VTI-Eucalyptus, the `external/` pin in
`scripts/openvtc/PINS.json`). Keyring: wallet `main` `a10a6c7`, bifold `main`.

---

## 1. What a person does

| Who | What | Today | With this plan |
|---|---|---|---|
| Any member | Show someone how to join | Send them to the community's landing page | **Invite**: the community screen shows a QR code and a share link |
| The applicant | Ask to join | Scan the community's code or open its page, then Keyring's Join flow | Unchanged: the QR from **Invite** opens the same Join flow |
| An administrator or moderator | See who has asked | The console's join requests list | **Requests to join** on the community screen, with a count |
| An administrator or moderator | Admit or decline | The console | **Admit** / **Decline** on a request, with an optional reason for a decline |

These are the three things most administrators do. Every other administrator action (§3) stays
where it is.

## 2. Architecture

**The same trust tasks the console and `cnm` use; no new protocol.** Each operation below is a
signed Trust Task to the community's VTC (its own service, its own access list, distinct from the
person's agent: subtask §2.5). Keyring already signs and sends community tasks for joining
(`joinWire.ts`: `vtc/join-requests/manifest`, `vtc/join-requests/submit`), through the person's
agent ("the agent signs, the client drives"), so these ride the same path.

| Operation | Task (VTI `49f5f1be`) | Who may | Notes |
|---|---|---|---|
| Invite | none: the code is the community's public DID, or Keyring's community link | any member | Keyring already reads both: a bare community `did:webvh` (`vtiLinks.ts`, kind `did` → classified as a community) and `keyring://community?d=…&n=…` (`vtiCommunityLink.ts`, built by `buildCommunityLink`, unused today) |
| List requests | `vtc/join-requests/list/0.1` | any administrator of the community, including a scoped one (a moderator) | `admin_events` lists the `joinRequests` topic for "any administrator" (`vtc-service/src/admin_events/mod.rs:452`) |
| One request | `vtc/join-requests/show/0.1` | as above | one request in full (what it carries is read in phase 2, not assumed here) |
| Admit / decline | `vtc/join-requests/decide/0.1` `{decision: approved \| rejected, reason?}` | any administrator, including a moderator | one task for both; approving atomically adds the member and issues the membership and role credentials (`routes/join_requests/decide.rs` header); a moderator may decide (test `a_moderator_may_decide_and_may_not_edit_the_profile`, `trust_tasks/mod.rs:7488`); a second decision is refused `notPending` |

**Who the phone signs as.** The VTC checks the signer's row in **its own** access list. The
person's Keyring identity in that community (the persona that joined) must therefore hold an
administrator row, scoped or not, on the VTC. Today a community's administrators are usually the
console's passkey sessions and `cnm` keys, not a phone. Granting the phone's identity a moderator
row is a one-time step an existing administrator takes in the console (Access) or with
`cnm access grant` (§4, phase 0).

**How the phone knows it may administer.** It shows **Requests to join** only for a community
where it holds an administrator row. It learns that by asking (`acl/show/0.2` for its own DID,
if a non-administrator may read its own row) or, failing that, from whether
`join-requests/list/0.1` is refused. Which of the two works is open (§7).

**What a member needs to invite: nothing new.** An invitation is not an admission. Anyone may hand
out the community's public code, and the community's own policy decides at submit time (automatic
admission, or referral for review). So **Invite** needs no administrator rights and no task.

## 3. What the CNM does, and what Keyring takes from it

`cnm` (VTI `cnm-cli`) is a command line for community operators. Its subcommands
(`cnm-cli/src/main.rs:146`) cover setup of the operator's own agent, the community profile,
health, auth, config, keys, contexts, the agent's ACL, auth credentials, backup, audit, vetting
(vetter grants, branding, statement withdrawals, PGP seeding), the community's own access list
(`access`), member-facing verbs (`member`: renew, rotate, relationships, issuing a statement),
consent, the administrator action list (`actions`, with a live `actions watch` that includes the
`joinRequests` topic, `actions_watch.rs`), git namespaces, the DID log, bootstrap, and DID
templates.

**It has no command that lists or decides a join request.** It only watches the `joinRequests`
topic and reads the join manifest for vetting (`vetting/mod.rs`). Upstream decides join requests
from the console, through the same `join-requests/*` tasks this plan uses. So Keyring takes
**tasks**, not CNM code:

| Take | Leave (and why) |
|---|---|
| `join-requests/list`, `show`, `decide` (the console's own calls) | `vtc/admin/invites/*`: invites a new **administrator** (an install link, the inviter's passkey gesture and another administrator's consent), not a member, despite the name (`trust_tasks/admin_tasks.rs:14`, `routes/admin/invites.rs`) |
| The `joinRequests` live topic, later, for a count (§6) | `access` grant/revoke, `members` remove/update, policy, vetting grants, git namespaces, backup, audit, config: rare, consequential, and better done with a keyboard and the console's review screens |
| | `actions` approvals other than join decisions: a separate design, once the basics are used |

## 4. Phases and acceptance criteria

| Phase | Step | Owner | Done when |
|---|---|---|---|
| 0 | **An administrator grants the phone's identity a moderator row** on the community's VTC (console Access, or `cnm access grant`). Documented for testers; no code | Docs (ours); the grant is the community's | A tester follows the steps and `join-requests/list/0.1` signed by the phone's identity is answered, not refused |
| 1 | **Invite.** On a community's screen, an **Invite people** action shows a QR code and a share sheet with the community's code | Keyring (bifold) | Scanning the QR on a second phone opens Keyring's Join flow for that community; a phone without Keyring that scans it gets the community's landing page (§7 decides the payload); no task is sent |
| 2 | **See requests.** **Requests to join** lists pending requests with each applicant's answers, shown only where the phone holds an administrator row | Keyring (bifold) | Against a test community with a pending request: listed within one refresh; a non-administrator sees no section and no error |
| 3 | **Admit or decline.** Each request has **Admit** and **Decline** (with an optional reason); the list updates; a refusal reads in words | Keyring (bifold) | Admit: the applicant's Keyring shows the membership; Decline: the applicant sees the decline; a second tap answers `notPending` in words; a non-administrator's attempt is refused legibly |

Phases 1–3 are independent of each other's screens; 2 and 3 depend on phase 0's grant. All are
exercised against a test community, never a person's own community or agent.

## 5. UI: where it lives

Keyring has six tabs today (Contacts, Messages, Connect, Credentials, My Agent, Settings;
`TabStack.tsx`), and each community already has its own screen inside My Agent (`VtiCommunity`).

| Option | For | Against |
|---|---|---|
| **A. A "My communities" tab** | One place, always visible | A seventh tab on a tab bar already at six; administration is occasional, so a permanent tab mostly sits empty; splits communities away from the agent that signs for them |
| **B. Reshuffle the menu** (fold Connect or Messages to make room) | Keeps the count | Moves things people already use, for a feature most of them will not |
| **C. On the existing community screen** (recommended): **Invite people** for every member; **Requests to join** with a count, only for administrators; a badge on My Agent when requests wait | No new tab; it appears exactly where the community already is; a plain member sees only Invite | One more step from the home screen than a tab |

**Recommendation: C.** It is the basic, simple version: invite from the community you are looking
at, and see requests there if you are an administrator. If administrators turn out to use it daily,
a tab can follow without moving anything built here.

## 6. Notifications

A new join request does not wake an administrator's phone today: the VTC only signals its console's
live stream, and it has no wake path (VTI-Q47). Until upstream answers VTI-Q47, Keyring shows the
count when the person opens the app (phase 2). The peer message notifications plan
(keyring-wallet #365, in review) covers the phone side of wakes.

## 7. Decisions, open questions, and what is upstream

**Decided here.** Three operations, the existing tasks, option C, and Invite needs no rights.

**Open.**
- **What the QR carries.** The community's bare DID is what upstream's own pages draw and what
  Keyring and other VTI clients read; the landing page URL also works for a person without
  Keyring. Proposed: the QR carries the landing page URL if the page links into Keyring's Join
  flow, otherwise the DID, and the share sheet offers both. Settled in phase 1 by trying both.
- **How the phone learns its role.** Whether a non-administrator may read its own row with
  `acl/show/0.2` (`trust_tasks/acl_tasks.rs:90`); if not, the refusal of `join-requests/list` is
  the signal. Settled in phase 2.
- **Granting from the phone.** Phase 0 is a console step. Letting an administrator's Keyring grant
  a moderator row would need `access` grant from the phone: deliberately out of the basics.

**Upstream (VTI), none blocking.** Every task in §2 exists at `49f5f1be`. VTI-Q47 is needed only
for a notification (§6).

**Ours.** Phases 0–3: tester documentation and the bifold screens and client calls.
