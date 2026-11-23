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
## 7. Steps and acceptance criteria   <!-- one step = one PR in the stack (CLAUDE.md, "Implementing a plan: stacked PRs") -->
## 8. Testing
## 9. Security, privacy, migration and rollout
## 10. Blocked, and on whom   <!-- names each VTI-QN this plan registered in docs/VTI_UPSTREAM_FINDINGS.md under its feature (CLAUDE.md checklist, "Upstream gaps") -->
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
