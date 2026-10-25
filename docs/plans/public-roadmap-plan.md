# Public Roadmap — Plan

**Status:** Proposed. Decisions D1–D18 are taken (§10). **Step 1 and launch are blocked** until the product owner names the triage owner, the moderation owner and the holder of the claude.ai account that owns the Command Center (§8.1, §9).
**Scope:** Make Keyring's work visible in public: what we are building, what testers and the community asked for, and what shipped in which release. It is delivered as one public GitHub Project over GitHub issues in `keyring-wallet` and `keyring-bifold`. Each plan in `docs/plans/` on `main` becomes an epic. Fixes and requests from the community become public issues, and the issue number is the reporter's receipt. Every card reads in plain language, with technical detail one click away.
**Companions:**
- [`public-roadmap-plan/2026-10-21-al.md`](./public-roadmap-plan/2026-10-21-al.md) — research findings (what the internal board and the tester-report ledger held on 2026-10-21, what GitHub offers as of October 2026, how other open-source projects run public roadmaps), the options weighed, and the first decisions.
- [`public-roadmap-plan/2026-10-22-bam.md`](./public-roadmap-plan/2026-10-22-bam.md) — review of the plan: publication and privacy gaps, status and closure semantics, verifiable acceptance criteria. Lists the items awaiting owner confirmation and carries the point-in-time data removed from §3.
- [`public-roadmap-plan/2026-10-25-al.md`](./public-roadmap-plan/2026-10-25-al.md) — the product owner's answers to the review's decisions (D3, D6, D10 confirmed) and what is still open.

**Related plans:** [`release-flow-plan.md`](./release-flow-plan.md) (how a change reaches testers). The versioning-and-releases plan is **not in this repository yet** (not on `main`): it makes each tester release a version, with a GitHub Release as the changelog of record. This plan's *Shipped in* field and the Testing and Shipped automation are **conditional on it** (§8).

---

## 1. Summary

The backlog lives in three private places that do not line up:
- the **Command Center** board and its companion **Backlog** page, which are claude.ai artifacts with a database;
- a **work queue** kept by the agent sessions;
- the **tester-report ledger** kept by the Signal bot, which hands every incoming message an `IN-` number.

The board's items are already written in plain language and work well internally. Nobody outside the team can see them, and a reporter's `IN-` number leads nowhere they can look.

The design:

- **GitHub is the source of truth for the backlog.** One public org project, *Keyring Roadmap*, shows issues from `keyring-wallet` and `keyring-bifold`. Everyone sees the same board, with a few plain statuses: Requested → Under review → Planned → In progress → Testing → Shipped, plus Not planned and Duplicate.
- **Plans become epics.** Each plan in `docs/plans/` on `main` gets one Epic issue with a plain summary and a link to the plan. Its phases and subtasks become sub-issues, in whichever repository the code changes.
- **Community reports become issues.** When a Signal report is accepted and the reporter has opted in, the bot creates or updates a public issue and replies to the reporter with the link. The public issue number is the reporter's receipt. The `IN-` number stays in the private ledger. When it ships, the reporter is told, as today, now with a public link.
- **Every card has two layers.** At the top, three short plain-language parts: *What this is*, *Why it matters*, *Where it stands*. Below them, a collapsed *Technical details* section for specs, files and agent notes. Agents write both layers to a card standard (§6).
- **There is no internal board for public work.** Internal coordination stays where it already happens, in Signal and in the Command Center's release, testing and decision sections. Work that must not be public has one private holding place (§4.1, D7), which is a list and not a second board.
- **Some things never go public:** reporter identities, private messages, embargoed security issues, internal hostnames and DIDs, and maintainer or session names. Creating an issue in a public repository **is** publication, so the pipeline screens for them before anything is created, because a public issue's edit history cannot be fully erased afterwards (§7).

---

## 2. Goals and non-goals

**Goals**
- G1. Anyone can see what Keyring is working on, what is planned, and what shipped in which release, without an account.
- G2. Every tester or community member who reports something can follow it by the public issue number they were given, and sees it change state.
- G3. Each card can be understood in under 30 seconds by someone who doesn't write code.
- G4. Each card still links to the full technical picture (plan, spec, PRs) for engineers and agents.
- G5. The project lead and the team read the same board as everyone else. Anything more detailed is one click away on the card, or in Signal.
- G6. Agents keep the board current as part of their normal work, so it doesn't go stale. A stale public roadmap is worse than none.
- G7. Nothing private, embargoed or identifying leaks.
- G8. Anyone can take part: report a bug or ask for a feature as an issue, and show interest with 👍.

**Non-goals**
- Dates or deadlines on the board. It says "not a commitment" and shows releases, not calendars.
- Replacing Signal as the place testers and the team talk. Signal stays the main channel; GitHub is where everyone can watch progress.
- Public voting that decides the roadmap. 👍 reactions show interest; they don't bind us.
- Moving release, testing, gate, decision or session tracking out of the Command Center. Only backlog *work items* move.
- A second board for the team. The private holding list for withheld items (§4.1) is not a board: it has no statuses, views or workflow.

---

## 3. Current state

The sources the pipeline reads, and why none can be copied directly. Counts, dates and snapshots are in the companions.

| Source | What it holds | Fit for publishing |
|---|---|---|
| Command Center (claude.ai artifact, database collections `backlog`, `items`, `features`, `decisions`, `release`, `testing`, `builds`, `agents`, `config/releases`) | Backlog rows: `title`, a 1–3 sentence `what`, `ref`, `lane`, `note`, `order`, `release` (a per-row picker over release numbers, "Later" and "Not scheduled", saved as `releaseSetAt`/`releaseSetBy`), `reportedBy`/`Via`/`On`, `addedAt` | Plain text is close to the card standard. Rows use roles rather than names, but the Backlog page once held maintainer names, and some rows track embargoed security work |
| Keyring Backlog page (artifact, collection `items`) | `group` (feedback / p1 / p2 / p3 / shipped), `order`, `title`, `plain`, `source`, `lane`, `state`, `call` (Not decided / Next release / Later / Drop, the product owner's call only) | Same as above. Mapping in Step 1 |
| Agents' work queue (private file) | Technical rows with mixed id schemes | Not publishable as written: file paths, DIDs, hostnames |
| Tester-report ledger (Signal bot, private) | `IN-` tickets. Every inbound Signal message gets one, so most are chatter or follow-ups, merged into another ticket or closed as noise | **Not publishable as written:** real display names, Signal UUIDs, verbatim private messages |
| `docs/plans/` | Plans on `main`, with statuses in `README.md` (some stale), plus subtasks | Already public. They map to epics |
| GitHub repos | Both public. `keyring-wallet` has default labels and no issue templates. Bifold has upstream Aries templates that still say "Aries Bifold" | Almost a blank slate |
| GitHub org | Issue types Task, Bug and Feature. Org issue fields Priority, Effort, Start date and Target date exist. Org project #9 "Keyring" is **private**, belongs to another maintainer and holds mostly private-repository items | Project #9 is left alone; the roadmap is a new project (D11) |

Two things block a direct copy: (1) the ledger and queue carry identities and private text, and (2) an `IN-` number names a *message*, not a piece of work, so many numbers point at the same thing. The pipeline has to curate.

---

## 4. Model

### 4.1 Where things live

| Thing | Home | Notes |
|---|---|---|
| Work items (features, bugs, tasks, epics) | GitHub issues in `keyring-wallet` and `keyring-bifold`, all on the **Keyring Roadmap** project | The source of truth for *what* and *where it stands* (D1, D2) |
| Epics and community reports | `keyring-wallet` | Reporters and readers don't know which repository holds the code, so every entry point lives in one place |
| Implementation issues | The repository where the code changes | Bifold sub-issues sit under wallet epics. Cross-repository sub-issues are assumed to work because both repositories are in one org; Step 0 verifies it. A wallet report found to be a bifold fix gets a bifold sub-issue, so the reporter's link never moves. Issues are never transferred between repositories: one filed in the wrong place is re-created in the right one, linked, and closed as Duplicate |
| Plans (design, rationale) | `docs/plans/` | The epic links its plan; the plan names its epic in its header |
| Tester reports and reporter identity | Signal bot ledger (private) | The ledger keeps `IN-` → reporter and `IN-` → public issue number (D3). No `IN-` number appears on a public issue |
| Items the product owner marks keep-private, and embargoed security work before disclosure | A **private holding project**, *Keyring Private*, in the org: draft items only (no issue is created, so there is no history to leak), with title, reason withheld, and who decides. Embargoed security work lives in a private security advisory, not in the holding project | Nothing here syncs to the public board. Holding-project items that later become public are created fresh through the Step 2/3 gate (D7) |
| Release, testing, gate runs, decisions, sessions | Command Center and Signal | Unchanged. The Command Center's backlog section reads from GitHub instead of holding its own rows (D1) |
| Security issues | GitHub private vulnerability reporting / security advisories | Never on the board until disclosed (§7) |

### 4.2 Issue types and hierarchy

- **Issue types** (org level): `Epic` (to be added), `Feature`, `Bug`, `Task`.
- **Epic** = one plan. **Sub-issues** = the plan's phases or subtasks, and under them individual steps where useful. GitHub allows 100 sub-issues per parent and 8 levels ([adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues): "up to 100 sub-issues per parent issue and create up to eight levels of nested sub-issues").
- **Community items** (fixes, requests from Signal) are standalone `Bug` or `Feature` issues. They join an epic as a sub-issue only when they really belong to one.
- **Dependencies** ("blocked by") mark items waiting on another item, including upstream waits. They show as an icon on the board.
- **Labels:** `area:*` labels (`area:chat`, `area:vetting`, `area:onboarding`, …) are created in **each** repository, because labels do not span repositories.

### 4.3 Fields

Everything on the board is public. Project fields have no per-field visibility, and the plan does not use organization-only fields, because the plan has no internal view to show them in.

| Field | Kind | Values | Set by |
|---|---|---|---|
| Status | Project single select | Requested · Under review · Planned · In progress · Testing · Shipped · Not planned · Duplicate (D5, D12) | Triage, then automation (§8) |
| Up next | Project single select | Next release · Later | The product owner, replacing the Backlog page's "Your call". No dates (D9) |
| Shipped in | Project text | Release version, e.g. `0.2.1`; blank for *Shipped (pre-versioning)* items | Release automation |
| Source | Project single select | Community · Plan · Team | Whoever creates the issue |
| Area | Labels | `area:*`, per repository | Triage |

There is no *Report IDs* field: `IN-` numbers are not public (D3). The org's existing issue fields (Priority, Effort, Start date, Target date) are not used on this board. Priority is shown by order within a column and by *Up next*, and dates are excluded by D9.

### 4.4 Lifecycle and closure

```
Request or report ─▶ Requested ─▶ Under review ─▶ Planned ─▶ In progress ─▶ Testing ─▶ Shipped
  (Signal, issue      (issue       (we analyse;     (accepted;   (an agent    (in a tester  (released;
   form, plan)         exists)      card filled)     on the       or person    build)        reporter
                                                     roadmap)     is on it)                  told)
                         └──────────────▶ Not planned / Duplicate (one-line reason comment)
```

**Status is the only lifecycle signal. Open or closed is not.** The view filters (§5) key on Status.

- **Requested → Under review:** triage. A person or agent fills in the card's top layer and decides whether it is real, a duplicate, or out of scope.
- **Under review → Planned:** accepted. For larger work, this is where a plan is written and the item becomes or joins an epic.
- **Planned → In progress:** set automatically when a branch or PR for it opens (§8).
- **In progress → Testing:** set when the fix is in a tester build (conditional, §8).
- **Testing → Shipped:** set only by release automation when the release goes out (conditional, §8). The issue is then closed with `state_reason` *completed*, with a comment linking the GitHub Release, and `Shipped in` is filled. The Signal lane tells the reporters, as the standing rule already requires.
- **Declined:** Status becomes Not planned or Duplicate, the issue is closed with `state_reason` *not planned* or *duplicate*, and a one-line reason is posted as a comment. A Duplicate comment links the original issue.
- **Bifold items:** *Shipped* means the wallet release whose submodule pointer includes the bifold merge. Bifold fixes merge before that release, so a merged bifold PR leaves the item at In progress or Testing until the pointer bump ships.

**Why closure is decoupled from merge.** `Closes #N` closes at merge, before the fix reaches testers or a release. GitHub's built-in project workflows then move the item to Done on close and on merge ([built-in automations](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations): "two workflows are enabled by default": closed issues and PRs, and merged PRs, move to Done). A Shipped view built on "closed" would also contain declined items. So: the built-in *Item closed* and *Pull request merged* workflows are disabled on the project; PRs say `Refs #N`, never `Closes`; and only release automation closes a shipped issue.

---

## 5. Views

One public project, **Keyring Roadmap**, linked to both repositories. Each view's filter and grouping is part of its definition:

| # | View | Layout | Filter | Group / sort |
|---|---|---|---|---|
| 1 | **Board** (default) | Board | `status:Requested,"Under review",Planned,"In progress",Testing` | Columns by Status; manual order within a column |
| 2 | **Up next** | Table | `status:Planned,"In progress",Testing up-next:"Next release"` | Group by Status; manual order. What the next release is aiming at, with no dates |
| 3 | **Shipped** | Table | `status:Shipped` | Group by `Shipped in`, newest first. The public "what changed" history. Items with a blank `Shipped in` form the *pre-versioning* group |
| 4 | **Big pieces** | Table | `type:Epic -status:"Not planned",Duplicate` | Sort by Status; shows sub-issue progress |
| 5 | **From the community** | Table | `source:Community` | Group by Status. Reporters find their items here, declined ones included |
| 6 | **Closed without shipping** | Table | `status:"Not planned",Duplicate` | Group by Status. Each row's reason is in the issue's last comment |

**Sorting by 👍.** Project views document sorting "by a field value" and do not document sorting by reactions ([customizing the table layout](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-table-layout)). Step 0 verifies whether view 5 can. If it cannot, the README links to an issue search sorted by `reactions-+1-desc` over the `community` label, which the issue forms and the sync both set.

A **project README** covers:
- what Keyring is;
- "this is not a commitment, and there are no dates";
- how to take part: Signal, a bug or feature issue form, and the private security link;
- the response aim ("we aim to respond within about a week", D15);
- what each status means, and that declined items stay visible under *Closed without shipping*;
- the automation's bot identity (§8) and the moderation contact (§8.1);
- one line on how we work: much of the building is done with AI coding agents, overseen by the maintainers.

---

## 6. Card standard

Every issue body starts with the public layer. Agents write it to the same rules the leadership update already follows (that procedure is **not in this repository**): plain words, jargon explained, claims only what was verified, no names, no private quotes, no DIDs, hostnames or session names.

```markdown
**What this is:** One or two sentences a non-engineer understands.
**Why it matters:** Who notices and what gets better for them.
**Where it stands:** One line, kept current by whoever moves the card.

<details>
<summary>Technical details</summary>

Plan / spec link, affected areas, PRs, acceptance criteria, agent notes.
</details>
```

- **Title:** at most about 60 characters, in the user's words ("Photos in chat", not "keyring/chat/1.0 inline attachments").
- **Epics** link their plan and let the sub-issues show progress.
- **Shipped comment:** "Shipped in 0.2.1 — <one line on what changed>. Release notes: <link>."
- **Issues filed by the community** keep the reporter's own words in the body, never rewritten. Their public layer is **one mechanism**: the first maintainer comment, which starts with `**What this is:**`. The agent moving the card keeps that comment's *Where it stands* line current by editing it. For every other issue the public layer is the body.
- An issue whose public layer is missing or stale is flagged by the check in §8, which inspects the first comment starting `**What this is:**` for community issues and the body for all others. The agent moving the card fixes it.

---

## 7. What never goes public, and how that is enforced

**Creating an issue in a public repository is the publication event.** Everything in `keyring-wallet` and `keyring-bifold` is public the moment it is created, whatever the project's visibility. Step 4 (go public) does not gate that; it gates the project's visibility, the pins and the announcement (§9). So the gate that matters sits in front of the first issue create in Steps 2 and 3.

| Never public | Where it stays | Enforcement |
|---|---|---|
| Reporter names, Signal UUIDs, phone numbers | Signal ledger | The sync never reads those fields into an issue. The scan rejects text matching the ledger's names |
| `IN-` numbers | Signal ledger | Not written to any public field, title, label, branch or comment (D3). The scan rejects `IN-\d+` |
| Verbatim Signal or private messages | Signal ledger | Issues carry a written summary, never a quote |
| Device model, OS minor version, exact timestamps from a report | Signal ledger | Summaries use "an Android phone", "recently". The scan rejects model strings and timestamps |
| Maintainer and session names | Nowhere public | The same scan as the existing no-names rule |
| Security issues before the fix ships and disclosure is agreed | Private vulnerability reporting / draft advisory | Default-deny, below |
| DIDs, hostnames, IPs, keys, UUIDs | Private notes | Pattern scan before create or update |
| Internal deliberation and decisions | Signal and the Command Center | Not modelled on the board at all |
| Keep-private items | The private holding project (§4.1) | Never created as issues |

### 7.1 The scan

- **Coverage.** The scan runs on **every text field of every create, edit and comment path**: titles, labels, bodies, bot comments, sub-issue titles, and the PR and branch text the automation writes. It runs before the write, never after, because GitHub keeps edit history. It also rejects `@` (so no mention can notify anyone), and any image or file reference.
- **Attachments.** The sync never attaches Signal files. A screenshot is summarised in words. Community-filed attachments cannot be screened ahead of time; the moderation owner (§8.1) reviews them within the acknowledgement window.
- **Borderline results.** A result that is neither clean nor a clear match goes to a **hold for human approval** state: nothing is written, the item stays in the ledger, and the triage owner approves or rewrites it.
- **Canary suite.** A fixed set of inputs the scan must reject: a fake display name from the ledger's name list, a UUID, a DID, an IP address, an internal-style hostname, an `IN-` number, an `@` handle, and a body with an embedded image. It runs in CI for the scan and is an acceptance criterion of Steps 0 and 1. A scan that passes any canary blocks creation.
- **Owner sign-off.** Before the **first create** in Step 2 and Step 3, the product owner approves a dry run: every body, title and comment the step would create, run through the scan, with the results.

### 7.2 Security and embargo

- **Default-deny.** An item is public only if its triage record says *public-safe*. A *security* flag is an exclusion that fails closed: a missing, unknown or conflicting flag means not public.
- **Disclosure approver.** The product owner approves any disclosure, with a **named backup role** for when the approver is unavailable (D14).
- **Fixes.** Security fixes are developed in the repository's private advisory fork. No public branch or PR exists before the release. `keyring-bifold` follows the same rule, and a bifold security fix's merge and the wallet's submodule-pointer bump are timed to the same release, since a public pointer bump reveals the fix.
- **Discovered late.** If a security-sensitive item turns out to be on the board, it is **deleted** (org owner), not closed: closing leaves the content and its history visible.
- **Reporting channel.** Private vulnerability reporting is enabled on both repositories, including the `keyring-bifold` fork, and the issue forms point to it. Step 0 verifies it by submitting a test report on each.

### 7.3 If something leaks

1. The org owner deletes the issue or comment (deletion removes it from the issue's history, which redaction does not).
2. If it persists in a cached or mirrored copy, file a GitHub content-removal request.
3. If it is a key or credential, re-key it. Deleting the content does not make it safe.
4. Record what leaked, when, how long, and the fix in the Command Center's decisions section.
5. Add a canary for the pattern that got through.

---

## 8. Automation

Everything here that can create or edit public text passes through the scan (§7.1).

- **Credential.** The `GITHUB_TOKEN` cannot write to projects ([automating projects using Actions](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions): "`GITHUB_TOKEN` is scoped to the repository level and cannot access projects"). Automation runs as a **GitHub App**, a bot identity, with Projects (read/write) and Issues (write) on both repositories (D10). Its key is managed outside this document. Its bot identity is documented in the project README and each repository's contributing file, so readers know bot comments are ours.
- **Signal → issue (idempotent upsert):**
  1. When a report is accepted **and the reporter has said yes to a public issue**, find the issue the ledger maps the `IN-` number to. Opt-in is per report and is recorded in the ledger. A report without opt-in stays in Signal.
  2. If there is none, create one in `keyring-wallet` from the card template; otherwise update it.
  3. Add it to the project (`addProjectV2ItemById` is idempotent), then set the fields in a separate call.
  4. The ledger stores `IN-` → issue number, and the bot replies to the reporter with the link. The public issue number is the receipt.

  For the first few weeks after launch, writes are published in **daily batches**, not in real time, so a public issue's creation time does not line up with a Signal message. The cadence is **provisional** and is reviewed after about a month (D13). Each batch writes one at a time, at least one second apart, inside GitHub's content-creation limits (["no more than 80 content-generating requests per minute"](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), 500 an hour).
- **Issue forms.** Both repos get two forms, *Report a problem* and *Ask for a feature*, each setting its type, `needs-triage` and `community` labels. Each form states the response aim ("we aim to respond within about a week") and carries a warning: "This page is public and its edit history is kept. Do not paste names, keys, addresses or private messages," and links the Code of Conduct and contributing guide. A `config.yml` disables blank issues and links to Signal and the security form. In `keyring-bifold`, the upstream Aries Bifold templates are replaced.
- **Project workflows.** On the project: auto-add one workflow per repository, setting Status = Requested; the built-in *Item closed* and *Pull request merged* workflows disabled (§4.4). Step 0 verifies the org's plan allows two auto-add workflows. Auto-add does not backfill, so the existing issues in `keyring-wallet` are added by hand in Step 1.
- **PRs and releases:**
  - PRs say `Refs #N` (same repository) or `Refs berkmancenter/keyring-wallet#N` (cross-repository). Never `Closes`.
  - A workflow sets **In progress** when a linked PR opens.
  - **Conditional on the versioning-and-releases plan** (not in this repository): the release flow sets **Testing** when a tester build contains the item, and **Shipped** plus `Shipped in` plus the closing comment when the GitHub Release is published. For a bifold item, the release job finds bifold PRs between the old and new submodule pointer. Until that plan lands, the triage owner sets Testing and Shipped by hand at each release, and `Shipped in` stays blank.
- **Plans → epics.** A small script creates the Epic for a plan from its header, and the plan header gets the issue number in the same PR. Only plans merged to `main` become epics.
- **Staleness check.** A weekly scheduled workflow in `keyring-wallet`, as the App, **reports** to the triage owner and never closes anything ("stale bots are widely resented, and they would close real tester reports"):
  - In progress or Testing with no activity for 14 days;
  - Requested with no maintainer comment within the acknowledgement target (§8.1), and Under review with no activity for 30 days;
  - any card whose public layer is missing or stale (§6).

  The 14, 30 and acknowledgement thresholds are **provisional**, set to match a weekly rhythm; they have no data behind them yet.
- **Skills.** These skills are **not in this repository** (the project skills here are under `.claude/skills/`, and none of these is there): `keyring-command-center` reads the backlog from GitHub; the Signal lane uses the upsert and replies with links; the release flow sets Testing and Shipped; a new `keyring-roadmap` skill, created by this plan, holds the card standard, the scan and the triage steps.
- **Rollback.** The project can be switched back to private, and the automation disabled by suspending the App or disabling its workflows. Step 3 proves both.

### 8.1 Ownership and cadence

- **Triage owner** (a named role; **who is not yet named, and Step 1 and launch wait on it**): moves cards out of Requested, approves held scan results, receives the weekly report, and sets Testing and Shipped by hand while the release automation is not in place. "The coordinator" elsewhere in Keyring's processes means this role.
- **Acknowledgement.** The public statement, in the project README and the issue forms, is "we aim to respond within about a week". Internally the triage owner tracks a tighter target of 3 working days, which the weekly check reports against and which is never published (*provisional*, D15). The response may only say the item is seen.
- **Moderation owner** (**not yet named; Step 1 and launch wait on it**): handles community issues and comments under the Code of Conduct, reviews community-filed attachments, takes down leaks (§7.3), and may lock an issue that has stopped being useful. Locking is for conduct and for finished threads, never for disagreement.
- **Where jobs run:** the weekly check runs as a scheduled workflow in `keyring-wallet`; the Signal sync runs where the Signal bot runs. Both run as the App.

---

## 9. Steps

**Step 0 — Prepare** (no public change)
- Create the GitHub App and install it. Add the `Epic` issue type. Enable private vulnerability reporting on both repos. Confirm Issues are on in `keyring-bifold`.
- Verify, and record the result in the plan or a dated companion:
  - private vulnerability reporting works on both repos, including the `keyring-bifold` fork, by submitting a test report on each;
  - a sub-issue links across the two repositories;
  - the org's plan allows two auto-add workflows;
  - a view can or cannot sort by 👍 (§5 fallback);
  - the project can be switched public → private;
  - the scan rejects every canary (§7.1).
- *Done when:* the automation can add an item to a private test project and set every field, verified with one throwaway issue in a private repository and the test project, both deleted afterwards; and each verification above has a recorded result.

**Step 1 — Clean the backlog** (private)
- Export the Command Center backlog rows, the Backlog page items, open queue rows, open ledger tickets and the existing `keyring-wallet` issues into one review list.
- Dedupe, mark security or embargoed items, rewrite each into the card standard, and map each to an epic or "standalone", with its repository. For ledger tickets, record whether the reporter opted in.
- Map the source states:

  | Source | Board |
  |---|---|
  | Backlog `call` = Next release | Status Planned, Up next = Next release |
  | `call` = Later; Command Center release "Later" | Status Planned, Up next = Later |
  | `call` = Not decided; release "Not scheduled" | Status Under review, Up next blank |
  | `call` = Drop | Status Not planned, with a one-line reason |
  | `group` = shipped, no release number | Status Shipped, `Shipped in` blank (*pre-versioning*) |
  | `group` = shipped, with a release number | Status Shipped, `Shipped in` = that release |
  | `group` p1–p3 | Order within a column |
  | Plan in `README.md` marked Active or Proposed | Epic, Status In progress or Planned respectively |
  | Plan marked Draft | Off the board, unless the plan's owner opts in to an *Exploring* epic (D6) |

- *Done when:* the product owner has approved the list (each row: publish / keep private / drop), keep-private rows are in the private holding project, the scan finds nothing in the approved rows, and every canary is rejected.
- **Blocked:** the Command Center and Backlog page databases are readable only from the claude.ai account that owns them, so this step runs from a session signed in there. Decided, waiting on someone else: the product owner has not yet named who holds that account and runs the step.

**Step 2 — Build the project, seed the epics**
- Create Keyring Roadmap (kept **private** until Step 4), its fields, the six views and README. Create one Epic per plan in the D6 scope, with sub-issues for phases. Write the epic numbers back into the plan headers.
- **Creating an epic in a public repository is publication.** Before the first create, the product owner approves the scan dry run of every epic and sub-issue body (§7.1).
- *Done when:* every plan in the D6 scope has an epic, each epic and plan link each other, each view has the filter and grouping in §5, and the product owner signed off the dry run.

**Step 3 — Seed the backlog and connect the pipelines**
- Run the end-to-end test below in a **throwaway public test repository** in the org, linked to a copy of the project, and delete both afterwards. Only then point the pipelines at the real repositories.
- Before the first real create, the product owner approves the scan dry run of every approved backlog issue (§7.1).
- Create the approved backlog issues in batches of at most 25 (*provisional*: it stays inside the content-creation limits with room to spare and keeps each batch reviewable), with no `@` mentions. Connect the Signal upsert, issue forms, PR status, release status and the Command Center read.
- *Done when:*
  - a test report goes from Signal intake to an issue to Shipped in a lab release (by hand if the release automation is not yet in place), and the bot's reply carries the issue link;
  - re-running the sync creates no duplicates;
  - an issue filed through each form lands on the board as Requested;
  - a scripted comparison of the Command Center backlog and the board, on title, Status and Up next, shows **zero differences**;
  - the scan over every created body finds no `@`, and each batch was at most 25;
  - the project can be switched to private and the automation disabled, and both were tried.

**Step 4 — Go public**
- Make the project public, link and pin it on both repositories, and announce it in Signal. This step gates the project's visibility, the pins and the announcement. The issues are already public from Steps 2 and 3.
- *Done when:* a logged-out browser shows the board and every view, and the first week's staleness report is empty or acted on.

---

## 10. Decisions

**Taken** (reasoning in the companions). D13 and D15 are **provisional**:

| # | Question | Decision | Because |
|---|---|---|---|
| D1 | Source of truth for backlog work items | GitHub. The Command Center reads its backlog from it | A published page can be linked and contributed to; an artifact outside the repo cannot. Publishing the Command Center directly would mix gates, sessions and releases with the backlog and cannot be filtered per audience |
| D2 | Repositories | `keyring-wallet` and `keyring-bifold`, on one project. Epics and community reports in the wallet; implementation issues where the code changes | Readers do not care which submodule holds the code, but code changes live in one repository or the other. Wallet-only issues would force bifold work to be tracked elsewhere |
| D3 | `IN-` numbers and the board | `IN-` stays in the private ledger. The public issue number is the reporter's receipt, and the bot replies with the link. Many `IN-` numbers can map to one issue. Alternative not taken: a separate public token per report | An `IN-` number plus the issue's creation time and the report's text lets someone who knows when a person wrote to the bot link them to the report. The issue number carries the same function with no cross-reference |
| D4 | Which Signal reports reach the board | Only accepted bugs and requests, and only with the reporter's per-report opt-in | One `IN-` per message means most are chatter or follow-ups; one issue per number fills the board with noise and duplicates |
| D5 | Status names | Requested · Under review · Planned · In progress · Testing · Shipped · Not planned · Duplicate | Not planned and Duplicate are Status values, not only close reasons, so views and automation key on one field (D12) |
| D6 | Which plans become epics | Plans on `main` marked Active or Proposed. Drafts stay off unless the plan's owner opts in to an *Exploring* epic. Dated companions never | An epic for a plan that may never be built reads as a promise |
| D7 | Internal view | No second board. Internal coordination stays in Signal and the Command Center. Withheld items sit in one private holding project of draft items (§4.1) | A second board would be a second source of truth. But keep-private and embargoed items must live somewhere that is not the public board, and draft items have no issue history to leak. |
| D8 | Filing on GitHub | Anyone can file bugs **and** feature requests as issues, through forms. No Discussions; 👍 shows interest | One place to look, and one status for each request. Feature requests in Discussions would need a second status system |
| D9 | Dates | None on the board. Releases only, plus an *Up next* marker | A small team's dates slip and become broken promises in public |
| D10 | Credentials | A GitHub App (a bot identity) with Projects write and Issues write on both repositories; its key is managed outside this document; the bot identity is documented publicly | The workflow token cannot write to projects (§8), and an App is not tied to one person's account |
| D11 | Project | A new public project. The existing private org project #9 "Keyring" is left to its owner | #9 holds older items, mostly from private repositories, which outsiders would see as redacted rows |
| D12 | Declined items | Not planned and Duplicate are Status options, shown in *Closed without shipping*, each with a one-line reason comment, and a link to the original for Duplicate | A close reason alone is not a project field, so a view would have to filter on issue state, which also contains shipped items |
| D13 | Publication cadence | For the first few public weeks, reports are published in daily batches. Cadence may loosen afterwards; provisional, reviewed after about a month | Real-time publication ties an issue's creation time to a message's arrival. Once opt-in and summary scrubbing exist, batching adds little privacy and slows G2 (the reporter sees the item change state), so it is a launch precaution, not a permanent rule |
| D14 | Disclosure approver | The product owner, with a named backup role | Disclosure is a product decision with legal and reputational weight |
| D15 | Acknowledgement target | Public: "we aim to respond within about a week". Internal, tracked by the triage owner: 3 working days. Provisional | A public request with no reply reads as ignored, but a public number is a promise; the tighter internal target keeps the public one safe. Neither has data behind it |
| D16 | Closure | Only release automation sets Shipped and closes a shipped issue. PRs use `Refs`. Built-in close and merge workflows are off (§4.4) | `Closes` closes at merge, before Testing or release |
| D17 | Stale items | The weekly check reports, never closes | Real tester reports would be closed; a public tracker that auto-closes is widely resented |
| D18 | Reporter opt-in | Per report, recorded in the ledger | A public issue is a different disclosure from a Signal message, so consent for one is not consent for the other |

**Rejected alternatives**

| Option | Why it fails |
|---|---|
| A private intake repository, with issues transferred when accepted | GitHub cannot transfer a private-repository issue to a public one, so it becomes re-create plus manual linking. The scan before creation does the same job with less machinery |
| One issue per `IN-` number | See D4 |
| A stale bot that auto-closes inactive issues | See D17 |
| Issues in a single repository | Superseded by D2 |

**Later (not in this plan):** a Keyring agent in the Signal channel that asks for and records decisions, such as accepting a report or choosing *Up next*. Revisit after Step 4, once the board is the source of truth.

**Blocked on others:** Step 1 needs a session signed in to the claude.ai account that owns the Command Center and Backlog page (see Step 1). The triage owner and moderation owner (§8.1) are named by the product owner.
