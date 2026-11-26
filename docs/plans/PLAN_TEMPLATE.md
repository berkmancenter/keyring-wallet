# Plan template

Copy the block for what you are writing. Rules are in [`CLAUDE.md`](./CLAUDE.md);
the overview is written last, with the
[`technical-plan-humanizer`](../../.claude/skills/technical-plan-humanizer/SKILL.md)
skill. Delete any heading that does not apply only after writing "not applicable"
and the reason in its place once, so the omission is a decision.

## A plan (or a subtask plan)

````markdown
# <Name> — <what it does, in a few words>

**Status:** Draft | Proposed | Accepted, building | Implemented. <one line on where it stands>   <!-- Implemented only when the last stacked PR has merged and a companion records the deviations (CLAUDE.md, "When the plan is done") -->
<!-- opt-in marker, alone on its line in the header block: the checker then enforces tiers, lanes, owners and upstream asks (CLAUDE.md, "Tiers, lanes and upstream asks"). Every new plan carries it -->
<!-- plan-format: tiers -->
**Roadmap epic:** <link, if any>
**Scope:** <one sentence>
**Companions:** [`<plan-name>/`](./<plan-name>/) — review index in §<n>
**Parent / related:** <links>

## Overview
<!-- plan-part: human -->

> **Human part: for people deciding and reviewing.** What this is, what a person
> sees, how we'll know it works, and what is needed from whom. It adds nothing: the
> numbered precision part below is authoritative, and if the two disagree, the
> precision part wins and this part is the bug.

<2–4 plain sentences: what a person does and sees, and why. No protocol terms. (§n)>

```mermaid
flowchart LR
    <the journey: what each person taps and sees, screen by screen, in the plan's copy>
```
<Caption: what to look at. (§n)>

![Screens 1–2: 1. <one-line caption>; 2. <one-line caption>](./<plan-name>/mockups/sheet.png)

<Caption: what the screens show, in flow order, in one line. (§n)>
Sources (SVG, generated from [`mockups.ts`](./<plan-name>/mockups/mockups.ts)):
[1 <screen>](./<plan-name>/mockups/01-<screen>.svg) ·
[2 <screen>](./<plan-name>/mockups/02-<screen>-<state>.svg)

<Assumed in these mockups, when any: each `<…>` stand-in and why. Or delete.>

<Not drawn, because their copy is not defined yet: <screens> (§n). Or delete when every screen is drawn.>

<What it does not claim, and what it adds. (§n)>

<When the reader needs it: "How it works underneath", with the sequence or architecture diagram and its caption. (§n)>

**How we'll know it works**

| Claim | Proved by | Runs where | Status |
|---|---|---|---|

**Where it stands:** <status in a line; blockers and on whom. (§n)>

**Open decisions**

| Question | Recommendation | Who decides | By when, or what it blocks |
|---|---|---|---|
| <question> | <recommendation and a short reason, or "None yet, because …"> | <name or role, or "Not named"> | <date, step or "Not stated"> |

**Decisions made**

| Decision | Who | When | Why |
|---|---|---|---|
| <decision taken, in the present tense> | <name or role> | <date> | <the reason, in a clause; the argument lives in a dated companion> |

**Not doing:** <non-goals and non-claims. (§n)>

---

<!-- plan-part: precision -->

> **Precision part: for implementers and agents.** Complete, exact and normative:
> implement from this part. Sections are numbered, and a bare `§n` means this
> plan's section n.

## 1. Scope, non-goals and baseline
## 2. Current state
## 3. Design
## 4. Constraints (cited)
## 5. Decisions and rejected alternatives
## 6. UX: screens, states, copy, accessibility   <!-- when there is UI; mockups: <plan-name>/mockups/mockups.ts, drawn with scripts/plans/mockup-kit -->
## 7. Steps and acceptance criteria   <!-- one step = one PR in the stack (CLAUDE.md, "Implementing a plan: stacked PRs"); P0, P1, P2 are iterative MVPs (CLAUDE.md, "Tiers, lanes and upstream asks") -->

### 7.0 Tiers, lanes and order

Each tier is a complete, working product that builds on the one before. If time runs
out after any tier, what exists works. A tier's exit criterion is "ships and works on
its own", shown by a named demo or test, never "all its items are done". No step
depends on a later tier.

| Tier | Exit criterion | Demo or test |
|---|---|---|
| P0 | <what a person can do with only this tier, and it works> | <the named demo or test> |
| P1 | <what P0 plus this tier lets a person do> | <…> |
| P2 | <…> | <…> |

| Lane | Owner | Steps |
|---|---|---|
| <UI/UX, core, plugin or another repo, upstream, test> | <name or role> | <7.1, 7.3> |

```mermaid
flowchart LR
    <the steps as nodes, the dependencies as arrows, the critical path drawn thick (`linkStyle … stroke-width:4px`) and named in the caption>
```
<Caption: which path is critical and which steps can run in parallel.>

| PR n of N | Step | Tier | Base | Can start after |
|---|---|---|---|---|
| 1 of 5 | 7.1 | P0 | feat/<plan-name> | none |
| 2 of 5 | 7.2 | P0 | PR 1 | PR 1 |
| 3 of 5 | 7.3 | P1 | feat/<plan-name> | PR 1 |

<A step is one PR and can proceed in parallel with another when neither is in the
other's "can start after". "Can start after" never names a later-tier PR. Within a
tier, order steps so that stopping after any one leaves a coherent product; steps
that cannot be separated are one step.>

### 7.1 <Step title> (P0)

**Owner:** <name or role>

<What changes, and the acceptance criteria, each checkable.>

**Fallback:** <only when the step names a VTI-Qn or VTI-NN: what works in this tier without the upstream change>
## 8. Testing
## 9. Security, privacy, migration and rollout
## 10. Upstream asks and blocked on whom   <!-- every VTI-Qn / VTI-NN is registered in docs/VTI_UPSTREAM_FINDINGS.md under its feature (CLAUDE.md checklist, "Upstream gaps"). An ask is recorded here, not filed or tracked: no link, status or response columns -->

| Ask | Id | Blocks (step, tier) | Fallback meanwhile |
|---|---|---|---|
| <what we want from upstream> | <VTI-Qn or VTI-NN> | <7.3, P1> | <what the tier does without it; the ask improves a later tier> |

Anything else this plan is blocked on, and on whom (people, decisions, devices), follows the table.
## 11. Open questions
## 12. Reviews

| Rev | Companion |
|---|---|
````

## A dated companion (`<plan-name>/YYYY-MM-DD-<initials>.md`)

````markdown
# YYYY-MM-DD — <topic>

Companion to [`../<plan-name>.md`](../<plan-name>.md). Not revised afterwards.

## Summary
<!-- plan-part: human -->

> **Human part: for people deciding and reviewing.** What was concluded and what it
> asks for. The findings below are authoritative; if the two disagree, the findings win.

<A few sentences: what was concluded, what it changes in the plan (§n), and any
decision it asks for, from whom. A diagram or mockup only if this changes one.>

<!-- plan-part: precision -->

> **Precision part: for implementers and agents.** Each finding with its evidence,
> the position it supersedes and the plan sections it changes. A bare `§n` means
> the plan's section n.

## Precision check   <!-- when this session ran it -->

Checked at Keyring `<sha>`, bifold `<sha>`, external pins `<sha>`. <What was
checked, by whom, and what was fixed.>

## Findings and decisions

### 1. <finding>

- **Concluded:**
- **Evidence:** <file:line at sha, command output, quoted citation>
- **Supersedes:**
- **Plan sections changed:** §n
- **Test impact:**
````
