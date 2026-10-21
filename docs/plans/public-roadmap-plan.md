# Public Roadmap — Plan

**Status:** Proposed. Decisions D1–D11 are taken (§10). Step 1 is blocked on data access (§9).
**Scope:** Make Keyring's work visible in public: what we are building, what testers and the community asked for, and what shipped in which release. It is delivered as one public GitHub Project over GitHub issues in `keyring-wallet` and `keyring-bifold`. Each plan in `docs/plans/` becomes an epic. Fixes and requests from the community become issues tied to the ticket number the reporter was given. Every card reads in plain language, with technical detail one click away.
**Companions:** [`public-roadmap-plan/2026-10-21-al.md`](./public-roadmap-plan/2026-10-21-al.md) — research findings (what the internal board and the tester-report ledger hold today, what GitHub offers as of October 2026, how other open-source projects run public roadmaps), the options weighed, and the decisions taken.
**Related plans:** [`release-flow-plan.md`](./release-flow-plan.md) (how a change reaches testers). The versioning-and-releases plan (not yet on `main`) makes each tester release a version, with a GitHub Release as the changelog of record; this plan's "Shipped in" field uses those versions.

---

## 1. Summary

Today the backlog lives in three private places that do not line up:
- the **Command Center** board and its companion **Backlog** page, which are claude.ai artifacts with a database;
- a **work queue** kept by the agent sessions;
- the **tester-report ledger** kept by the Signal bot, which hands every incoming message an `IN-` number.

The board's items are already written in plain language and work well internally. Nobody outside the team can see them, and a reporter's `IN-` number leads nowhere they can look.

The design:

- **GitHub is the source of truth for the backlog.** One public org project, *Keyring Roadmap*, shows issues from `keyring-wallet` and `keyring-bifold`. Everyone sees the same board, with a few plain statuses: Requested → Under review → Planned → In progress → Testing → Shipped.
- **Plans become epics.** Each plan in `docs/plans/` gets one Epic issue with a plain summary and a link to the plan. Its phases and subtasks become sub-issues, in whichever repository the code changes.
- **Community reports become issues, linked to their ticket number.** When a Signal report is accepted, the bot creates or updates an issue that lists the report's `IN-` number, and replies to the reporter with the link. When it ships, the reporter is told, as today, now with a public link.
- **Every card has two layers.** At the top, three short plain-language parts: *What this is*, *Why it matters*, *Where it stands*. Below them, a collapsed *Technical details* section for specs, files and agent notes. Agents write both layers to a card standard (§6).
- **There is no separate internal board.** Internal coordination stays where it already happens, in Signal and in the Command Center's release, testing and decision sections. The public board is the only board.
- **Some things never go public:** reporter identities, private messages, embargoed security issues, internal hostnames and DIDs, and maintainer or session names. The pipeline screens for them before anything is created, because a public issue's edit history cannot be fully erased afterwards.

---

## 2. Goals and non-goals

**Goals**
- G1. Anyone can see what Keyring is working on, what is planned, and what shipped in which release, without an account.
- G2. Every tester or community member who reports something can follow it by the number they were given, and sees it change state.
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
- A private or internal project board.

---

## 3. Current state

Read 2026-10-21. The companion has the detail.

| Source | What it holds | Fit for publishing |
|---|---|---|
| Command Center (claude.ai artifact, database collections `backlog`, `items`, `features`, `decisions`, `release`, `testing`, `builds`, `agents`, `config/releases`) | Backlog rows: `title`, a 1–3 sentence `what`, `ref`, `lane`, `note`, `order`, `release` (a per-row picker over release numbers, "Later" and "Not scheduled", saved as `releaseSetAt`/`releaseSetBy`), `reportedBy`/`Via`/`On`, `addedAt`. On 10-08 it held 32 backlog rows, 100+ work items and 57 decisions | Plain text is close to the card standard. Rows use roles rather than names, but the Backlog page once held maintainer names, and some rows track embargoed security work |
| Keyring Backlog page (artifact, collection `items`) | `group` (feedback / p1 / p2 / p3 / shipped), `order`, `title`, `plain`, `source`, `lane`, `state`, `call` (Not decided / Next release / Later / Drop, the product owner's call only) | Same as above. Mapping: `call` and the Command Center `release` picker become *Up next*; `group` p1–p3 becomes order within a column; `shipped` becomes Shipped with *Shipped in* |
| Agents' work queue (private file) | About 100 rows, technical, with mixed id schemes | Not publishable as written: file paths, DIDs, hostnames |
| Tester-report ledger (Signal bot, private) | 351 `IN-` tickets. Every inbound Signal message gets one, so most are chatter or follow-ups: about 155 were merged into another ticket and about 69 closed as noise. 63 open | **Not publishable as written:** real display names, Signal UUIDs, verbatim private messages |
| `docs/plans/` | 16 plans on `main`, with statuses in `README.md` (some stale), plus subtasks | Already public. They map to epics |
| GitHub repos | Both public, issues on, no milestones. `keyring-wallet` has 13 issues, default labels and no issue templates. Bifold has upstream Aries templates that still say "Aries Bifold" | Almost a blank slate |
| GitHub org | Issue types Task, Bug and Feature. Org issue fields Priority, Effort, Start date and Target date exist. Org project #9 "Keyring" is **private**, was created in 2025 by another maintainer, and holds 125 items, most from private repositories | Project #9 is left alone; the roadmap is a new project (D11) |

Two things block a direct copy: (1) the ledger and queue carry identities and private text, and (2) an `IN-` number names a *message*, not a piece of work, so many numbers point at the same thing. The pipeline has to curate.

---

## 4. Model

### 4.1 Where things live

| Thing | Home | Notes |
|---|---|---|
| Work items (features, bugs, tasks, epics) | GitHub issues in `keyring-wallet` and `keyring-bifold`, all on the **Keyring Roadmap** project | The source of truth for *what* and *where it stands* (D1, D2) |
| Epics and community reports | `keyring-wallet` | Reporters and readers don't know which repository holds the code, so every entry point lives in one place |
| Implementation issues | The repository where the code changes | Bifold sub-issues sit under wallet epics, since sub-issues work across repositories in the same org. A wallet report found to be a bifold fix gets a bifold sub-issue, so the reporter's link never moves |
| Plans (design, rationale) | `docs/plans/` | The epic links its plan; the plan names its epic in its header |
| Tester reports and reporter identity | Signal bot ledger (private) | The ledger keeps `IN-` → reporter, and the issue keeps `IN-` → issue (D3) |
| Release, testing, gate runs, decisions, sessions | Command Center and Signal | Unchanged. The Command Center's backlog section reads from GitHub instead of holding its own rows (D1) |
| Security issues | GitHub private vulnerability reporting / security advisories | Never on the board until disclosed (§7) |

### 4.2 Issue types and hierarchy

- **Issue types** (org level): `Epic` (to be added), `Feature`, `Bug`, `Task`.
- **Epic** = one plan. **Sub-issues** = the plan's phases or subtasks, and under them individual steps where useful. GitHub allows 100 sub-issues per parent and 8 levels, across repositories in one org.
- **Community items** (fixes, requests, alignment work from Signal) are standalone `Bug` or `Feature` issues. They join an epic as a sub-issue only when they really belong to one.
- **Dependencies** ("blocked by") mark items waiting on another item, including upstream waits. They show as an icon on the board.

### 4.3 Fields

Everything on the board is public. Project fields have no per-field visibility, and the plan does not use organization-only fields, because the plan has no internal view to show them in.

| Field | Kind | Values | Set by |
|---|---|---|---|
| Status | Project single select | Requested · Under review · Planned · In progress · Testing · Shipped (D5) | Triage, then automation (§8) |
| Up next | Project single select | Next release · Later | The product owner, replacing the Backlog page's "Your call". No dates (D9) |
| Shipped in | Project text | Release version, e.g. `0.2.1` | Release automation |
| Report IDs | Project text | `IN-309, IN-311` | Signal sync (D3) |
| Source | Project single select | Community · Plan · Team | Whoever creates the issue |
| Area | Labels | `area:chat`, `area:vetting`, `area:onboarding`, … | Triage |

The org's existing issue fields (Priority, Effort, Start date, Target date) are not used on this board. Priority is shown by order within a column and by *Up next*, and dates are excluded by D9.

### 4.4 Lifecycle

```
Request or report ─▶ Requested ─▶ Under review ─▶ Planned ─▶ In progress ─▶ Testing ─▶ Shipped
  (Signal, issue      (issue       (we analyse;     (accepted;   (an agent    (in a tester  (released;
   form, plan)         exists)      card filled)     on the       or person    build)        reporter
                                                     roadmap)     is on it)                  told)
                         └──────────────▶ Closed: Not planned / Duplicate (with a one-line reason)
```

- **Requested → Under review:** triage. A person or agent fills in the card's top layer and decides whether it is real, a duplicate, or out of scope.
- **Under review → Planned:** accepted. For larger work, this is where a plan is written and the item becomes or joins an epic.
- **Planned → In progress:** set automatically when a branch or PR for it opens (§8).
- **In progress → Testing:** set automatically when the fix is in a tester build, by the release flow.
- **Testing → Shipped:** set when the release goes out. The issue is closed with a comment linking the GitHub Release and `Shipped in` is filled. The Signal lane tells the reporters, as the standing rule already requires.

---

## 5. Views

One public project, **Keyring Roadmap**, linked to both repositories:

1. **Board** by Status: the default view.
2. **Up next**: Planned and In progress items with `Up next = Next release`. This is what the next release is aiming at, with no dates.
3. **Shipped**: a table of closed items grouped by `Shipped in`. This is the public "what changed" history.
4. **Big pieces**: epics only, with sub-issue progress.
5. **From the community**: `Source = Community`, so reporters can find their items, sorted by 👍.

A **project README** covers:
- what Keyring is;
- "this is not a commitment, and there are no dates";
- how to take part: Signal, a bug or feature issue form, and the private security link;
- what each status means;
- one line on how we work: much of the building is done with AI coding agents, overseen by the maintainers.

---

## 6. Card standard

Every issue body starts with the public layer. Agents write it to the same rules the leadership update already follows: plain words, jargon explained, claims only what was verified, no names, no private quotes, no DIDs, hostnames or session names.

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
- **Issues filed by the community** keep the reporter's own words. A maintainer or agent adds the plain three-part summary as the first comment and pins it in the body when triaging, and never rewrites what the reporter wrote.
- An issue whose public layer is missing or stale is flagged by the check in §8, and the agent moving the card fixes it.

---

## 7. What never goes public, and how that is enforced

| Never public | Where it stays | Enforcement |
|---|---|---|
| Reporter names, Signal UUIDs, phone numbers | Signal ledger | The sync never reads those fields into an issue. A pre-create scan rejects text that matches the ledger's names |
| Verbatim Signal or private messages | Signal ledger | Issues carry a written summary, never a quote |
| Maintainer and session names | Nowhere public | The same scan as the existing no-names rule |
| Security issues before the fix ships and disclosure is agreed | Private vulnerability reporting / draft advisory | Items marked security in the ledger or Command Center are excluded from the sync. Both repos enable private vulnerability reporting with a report form, and the issue forms point to it |
| DIDs, hostnames, IPs, keys | Private notes | Pattern scan (DID, IP and hostname regexes) before create or update |
| Internal deliberation and decisions | Signal and the Command Center | Not modelled on the board at all |

The scan runs **before** an issue is created or edited, never after: GitHub keeps edit history, so a leak fixed later stays visible to anyone who opens the history.

---

## 8. Automation

- **Credentials.** Automation needs a credential that can write issues in both repositories and the org project; the workflow `GITHUB_TOKEN` cannot write to projects. How it is provisioned and held is managed outside this document.
- **Signal → issue (idempotent upsert):**
  1. When a report is accepted, find an issue whose `Report IDs` contains the number.
  2. If there is none, create one in `keyring-wallet` from the card template; otherwise update it.
  3. Add it to the project (`addProjectV2ItemById` is idempotent), then set the fields in a separate call.
  4. The ledger stores `IN-` → issue number.

  Writes run one at a time, at least one second apart, inside GitHub's content-creation limits (about 80 a minute, 500 an hour).
- **Issue forms.** The two repos get two forms, *Report a problem* and *Ask for a feature*, each setting its type and a `needs-triage` label, plus a `config.yml` that disables blank issues and links to Signal and the security form. Built-in auto-add (one workflow per repository) puts new issues on the board as Requested.
- **PRs and releases:**
  - PRs say `Closes #N` (same repository) or `Closes berkmancenter/keyring-wallet#N` (cross-repository).
  - A workflow sets **In progress** when a linked PR opens.
  - The release flow sets **Testing** when a build containing it goes to testers, and **Shipped** plus `Shipped in` plus the closing comment when the GitHub Release is published.
- **Plans → epics.** A small script creates the Epic for a plan from its header, and the plan header gets the issue number in the same PR.
- **Staleness check.** A weekly job lists items in In progress or Testing with no activity for 14 days, and any card without a public layer, and **reports** them to the coordinator. It never auto-closes: stale bots are widely resented, and they would close real tester reports.
- **Skills updated:**
  - `keyring-command-center` reads the backlog from GitHub.
  - The Signal lane uses the upsert and replies with links.
  - The release flow sets Testing and Shipped.
  - A new `keyring-roadmap` skill holds the card standard and the triage steps.

---

## 9. Steps

**Step 0 — Prepare** (no public change)
- Provision the automation credential. Add the `Epic` issue type. Enable private vulnerability reporting on both repos.
- *Done when:* the automation can add an item to a private test project and set every field, verified with one throwaway issue in a private repository and the test project, both deleted afterwards.

**Step 1 — Clean the backlog** (private)
- Export the Command Center backlog rows, the Backlog page items, open queue rows and open ledger tickets into one review list.
- Dedupe, mark security or embargoed items, rewrite each into the card standard, and map each to an epic or "standalone", with its repository.
- *Done when:* the product owner has approved the list (each row: publish / keep private / drop), and the scan in §7 finds nothing in the approved rows.
- **Blocked:** the Command Center and Backlog page databases are readable only from the claude.ai account that owns them, so this step runs from a session signed in there.

**Step 2 — Build the project, seed the epics**
- Create Keyring Roadmap (kept **private** until Step 4), its fields, views and README. Create one Epic per active or proposed plan (D6), with sub-issues for phases. Write the epic numbers back into the plan headers.
- *Done when:* every plan in the D6 scope has an epic, each epic and plan link each other, and the views render as in §5.

**Step 3 — Seed the backlog and connect the pipelines**
- Create the approved backlog issues in batches of at most 25, with no @mentions. Connect the Signal upsert, issue forms, PR status, release status and the Command Center read.
- *Done when:*
  - a test report goes from Signal intake to an issue to Shipped in a lab release, and the bot's reply carries the issue link;
  - re-running the sync creates no duplicates;
  - an issue filed through each form lands on the board as Requested;
  - the Command Center backlog matches the board.

**Step 4 — Go public**
- Make the project public, link and pin it on both repositories, and announce it in Signal.
- *Done when:* a logged-out browser shows the board and every view, and the first week's staleness report is empty or acted on.

---

## 10. Decisions

**Taken** (2026-10-21, reasoning in the companion):

| # | Question | Decision |
|---|---|---|
| D1 | Source of truth for backlog work items | GitHub. The Command Center reads its backlog from it |
| D2 | Repositories | `keyring-wallet` and `keyring-bifold`, on one project. Epics and community reports in the wallet; implementation issues where the code changes |
| D3 | `IN-` numbers and the board | `IN-` stays the receipt. An accepted report's issue lists it in *Report IDs*, and the bot replies with the issue link. Many numbers can map to one issue |
| D4 | Which Signal reports reach the board | Only accepted bugs and requests |
| D5 | Status names | Requested · Under review · Planned · In progress · Testing · Shipped, plus Not planned / Duplicate with a reason |
| D6 | Which plans become epics | Active and Proposed plans. Drafts get one "Exploring" epic each, or stay off. Dated companions never |
| D7 | Internal view | None. One public board; internal coordination stays in Signal and the Command Center |
| D8 | Filing on GitHub | Anyone can file bugs **and** feature requests as issues, through forms. No Discussions; 👍 shows interest |
| D9 | Dates | None on the board. Releases only, plus an *Up next* marker |
| D10 | Credentials | Managed outside this document (§8) |
| D11 | Project | A new public project. The existing private org project #9 "Keyring" is left to its owner: it holds 125 older items, mostly from private repositories, which outsiders would see as redacted rows |

**Later (not in this plan):** a Keyring agent in the Signal channel that asks for and records decisions, such as accepting a report or choosing *Up next*. Revisit after Step 4, once the board is the source of truth.

**Blocked on others:** Step 1 needs a session signed in to the claude.ai account that owns the Command Center and Backlog page (see Step 1).
