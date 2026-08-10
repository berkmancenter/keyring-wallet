# CLAUDE.md — `docs/plans/`

Guidance for writing and maintaining planning documents in this directory. The
root `CLAUDE.md` covers the repo itself; this covers only how plans are written,
and exists because these documents are read twice — once by a human deciding, and
once by an agent implementing, months apart and with no shared memory.

## Layout

One plan is one file plus a companion folder:

```
<plan-name>.md                       the plan
<plan-name>/
  <YYYY-MM-DD>-<initials>.md         findings and decisions, dated and attributed
  <topic>_subtask.md                 a sub-plan owned by the parent
```

**Dates go on point-in-time artifacts, not on living ones.** A dated companion
records what someone concluded on a day and is never revised afterwards, so the
date is part of its identity. A plan — including a subtask plan — is revised
continuously, so a date in its filename is wrong the moment it is edited, and
worse, it advertises a currency the file may not have.

**One dated file per author per working session, not per topic.** The initials
are of the person or people behind it. A session that produces both a review of
the plan and design decisions for a subtask writes *one* file with two parts —
splitting by topic instead duplicates whatever the two share, and the reader has
no way to tell which file is authoritative on the overlap.

**There is no running changelog, and do not add one.** Three artifacts already
cover the ground: the plan holds current design, the dated documents hold
reasoning with an author's name and a date on it, and `git log` holds the
sequence of edits. A changelog is a fourth thing that duplicates the third
without attribution and the second without argument. If you find yourself writing
"what changed on <date>", write a dated document saying what you concluded and
why instead.

Cross-link them explicitly in the headers — parent → subtask and subtask →
parent. A plan that does not name its companions gets read alone and acted on
alone.

## Three kinds of content, kept apart

| Kind | Where | Voice |
|---|---|---|
| **Current design** — what we are building and why | the plan | present tense |
| **Reasoning and superseded positions** — why we decided this, what it replaced | a dated, attributed companion | past tense, dated |
| **External constraints** — what a spec requires of us | the plan, or a constraints companion for large sets | quoted, with citation |

The mistake this file exists to prevent is putting change history in the plan.
It accumulates fast, it lands at the top where it is read first, and it is the
least useful content in the document for anyone implementing.

## The test for any note

**Would an implementer with no memory of the conversation make a wrong decision
without this?**

- Yes → it belongs in the plan, as standing rationale.
- It only explains how we got here → it belongs in a dated companion.

Rejected alternatives usually pass this test, which is why "just delete
superseded material" is wrong. If an option is silently removed, the next
implementer re-proposes it, because the reason it fails is exactly the context
that was deleted. Worked example from this directory: an early draft had the
r-card delivered by the same Trust Task as the relationship credential. Delete
that and the design looks obvious again — it is only wrong if you know the r-card
is a verifiable data structure rather than a `DTGCredential` subtype, which is a
fact about an external spec, not about our history.

## Writing the plan

- **Present tense, no revision markers.** No "revised 2026-08-05", no "an earlier
  version of this section said", no pass-by-pass header. Those go in a dated
  companion.
- **A disposition index is not a changelog.** A plan may carry a short map from
  each revision to the review that drove it — that keeps companions discoverable
  from the plan. It must name the companion, not restate what changed.
- **Rejected alternatives stay, rewritten as standing rationale.** State the
  constraint that rules the option out, not the fact that we changed our minds.
  *"RCard does not ride this task: it is a VDS, not a `DTGCredential` subtype
  [quote], so it fails the Base Structure `type` requirement"* is checkable.
  *"An earlier version had RCard sharing this task; corrected"* is not.
- **Every normative constraint carries a citation.** Name the document and the
  section, and quote the operative sentence. An uncited MUST cannot be verified
  at implementation time and will either be ignored or over-applied.
- **Every implementation step carries acceptance criteria.** "Author the specs"
  and "implement layer C" are not actionable — say what makes each done
  (schemas validate against the meta-schema; the witness e2e passes; a credential
  round-trips with its outcome evidence retained). Without this an agent stops
  short or gold-plates, and the gap only surfaces at review.
- **Name what is blocked and on whom.** Distinguish "not decided" from "decided,
  waiting on someone else" — they need different follow-up.
- **Flag conditional designs.** If an approach depends on a decision that has not
  been made, say so at the approach, not only in an open-questions list. A plan
  that quietly assumes its own precondition reads as settled.

## Writing a dated companion

One document, one point in time, one author. Structure it as findings or
decisions — what was concluded, the evidence, and what position it supersedes —
so it can be evidence-checked and adopted or rejected on its own terms.

Preserve superseded reasoning in full. The argument is the point: a conclusion
that moved is cheap to record, but re-deriving why it moved is expensive. When a
proposal is applied, mark it applied rather than deleting it, so the document
reads as current status rather than as a stale snapshot.

## Citing external specifications

Cite **by name with a pinned `MAJOR.MINOR`**, not by item ordinal. Ordinals shift
when a spec adds requirements, and nothing in anyone's CI guards them — the Trust
Tasks framework moved its §7.3 item numbering between 0.2 and 0.3, which silently
invalidates any citation written as "§7.3 item 8". Prefer *"the proof-requirement
declaration (framework 0.3)"*.

Where a plan depends on more than a handful of external requirements, extract
them into a constraints companion: quotes and citations only, no design. That
half is stable while the design churns, and it lets conformance be checked
without re-reading the source specs.
