---
name: technical-plan-humanizer
description: Use when writing or updating the human-readable Overview of a plan, subtask plan or dated companion under docs/plans/: the summary at the top, its flow and architecture diagrams (Mermaid), UI mockups (SVG), and the "How we'll know it works" test summary. Run it only after the plan's precision section has been drafted and checked. Turns a correct, dense technical plan into something a person can read in a few minutes and decide on, without adding, dropping or softening any claim. Also covers the self-check that the overview still matches the plan after an edit.
---

# Humanizing a technical plan

A plan in `docs/plans/` is read twice: by a person deciding, and by an agent
implementing. The precision section (`§1` onward) serves the agent. This skill
writes the part for the person: the `## Overview` at the top, and the `## Summary`
of a dated companion. Read [`docs/plans/CLAUDE.md`](../../../docs/plans/CLAUDE.md)
first. It defines the two parts, the order of work, and the diagram and mockup
convention this skill applies.

## Before you start

- **The precision section must already be checked** (step 2 in `docs/plans/CLAUDE.md`,
  recorded in a dated companion). If it has not been, stop and do that. A good
  summary of an incomplete plan reads as settled and hides the gaps.
- Read the whole precision section, not just its summary table. Note the
  decisions that are open, the designs that are conditional, and every non-claim.
- If an overview already exists, you are syncing it, not starting over. Go
  straight to the self-check at the end and rewrite only what fails it.

## What the overview contains, in order

Aim for one screen of prose (roughly 25–50 lines), plus the pictures. The section
opens with the human marker and banner (`docs/plans/CLAUDE.md`, "Telling the two
parts apart"); copy them from `PLAN_TEMPLATE.md`.

1. **What a person sees.** Two to four plain sentences a reader outside the team
   can follow: what someone taps, sees and gets. No protocol or architecture terms
   in the first screenful (no message names, transports, key types, module
   names); a term that cannot be avoided gets a plain gloss.
2. **The journey diagram**, before any other picture: a `flowchart LR` of what
   each person does and sees, screen by screen, in the plan's own copy. It is the
   simplest true picture of the feature. Caption it.
3. **Mockups**, when there is UI: the key screens in flow order, including at
   least one failure state, shown as the committed contact sheet (`sheet.png`)
   with a one-line caption and links to the SVG sources (see "Mockups"). Then list
   the screens that are not drawn and why.
4. **What it claims and does not claim**, in a short paragraph. In this repo the
   non-claims carry weight ("makes no co-presence claim"); a reader assumes the
   larger claim otherwise.
5. **How it works underneath**, only now: the protocol `sequenceDiagram` or the
   architecture `flowchart`, each with a caption. Technical terms are fine here.
6. **How we'll know it works.** A table: claim, what proves it, where it runs (CI,
   lab, Farm, physical phones, by hand), status. One row per claim the plan makes.
   Say plainly what simulators cannot prove.
7. **Where it stands**: status and blockers, and on whom, in a line or two.
8. **Open decisions**, as a table, following the open-decisions rule in
   `/srv/dev/CLAUDE.md` (recommendation first, or a plain statement that there is
   none and why):

   | Question | Recommendation | Who decides | By when, or what it blocks |
   |---|---|---|---|
   | Store drafts on the phone or the server? | On the phone: nothing leaves it until sent (§5.2) | Product owner | Before step 3 |
   | Which push provider? | None yet, because the cost comparison is not done (§5.4) | Not named | Blocks step 5 |

   Copy "not named" and "not stated" as the precision section records them; do
   not invent an owner or a date.
9. **Not doing.** Non-goals, briefly.

**`§` pointers go at the end of a paragraph or caption**, in parentheses —
"(§2.1, §4)" — not in the middle of a sentence, so the prose reads cleanly and a
reader still finds the detail. Every paragraph has one.

## Grounding rules (where technical plans differ from ordinary prose)

- **Add nothing.** Every sentence must be traceable to a numbered section. If the
  summary needs a fact that is not there, the precision section is incomplete:
  add it there first (and that is a substantive change, with a companion).
- **Drop nothing that changes a decision.** Conditions, blockers, a dependency
  on someone else, and "unconfirmed" all survive the summary.
- **Don't soften uncertainty or strengthen it.** "Conditional on X" stays
  conditional. "Proved on Android only" does not become "proved". A measurement
  that has not been taken is not described by the result we expect.
- **Copy numbers, names, versions and dates exactly.** Absolute dates, never
  "last week". Pinned versions as the plan pins them.
- **Name things the way the person meets them.** Screen titles and button labels
  for UI, in quotes as the copy says them. Code identifiers only where the reader
  needs one to find something, in backticks.
- **Define or replace jargon once.** "VRC (the relationship credential two people
  exchange)" the first time, then "VRC". Skip a term if the overview does not need it.
- **Present tense, current design.** No history in the overview, the same rule
  as the rest of the plan. How we got here goes in companions.

## Style: what to remove

Adapted from public humanizer guidance (the `blader/humanizer` skill and
Wikipedia's "Signs of AI writing"), keeping the patterns that show up in
technical plans:

- **Staging instead of stating:** "It's not X, it's Y" contrasts, one-line
  dramatic closers, "Here's the thing:", rebuttals of points nobody made.
- **Inflation:** "crucial", "robust", "seamless", "leverage", "comprehensive",
  "pivotal", "game-changing", "unlock". Say what it does instead.
- **Vague links:** "associated with", "related to", "in terms of". Name the relation
  ("signs", "is sent to", "waits on").
- **Shallow -ing tails:** "..., ensuring a smooth experience." Delete, or state the
  actual effect.
- **Forced threes** and lists where a sentence would do. Use a list for parallel
  items a reader scans, a table for comparisons, prose for reasoning.
- **Bold as decoration.** Bold the one or two facts a skimmer must not miss, not
  every list label.
- **Hedges stacked on supported claims** ("may potentially help to"). Hedge only
  where the plan is unsure, and say what about.
- **Describing the document** ("This section outlines..."). Just say it.
- **Chat residue:** greetings, "I hope this helps", offers of further work.
- **Long dashes as connectors.** Use a full stop, a comma or a colon.

Prefer short sentences with a subject that acts. Vary sentence length.

## Diagrams

Mermaid, inline, per the convention in `docs/plans/CLAUDE.md`. One diagram, one
question:

| Question | Mermaid type |
|---|---|
| What a person does and sees, screen by screen | `flowchart LR` (the journey; first in the overview) |
| What talks to what (phone, mediator, VTA, witness, push gateway) | `flowchart LR` |
| What happens in order in a ceremony or protocol | `sequenceDiagram` |
| What states a screen or record moves through | `stateDiagram-v2` |

- Keep it to about 12 nodes or participants. If it needs more, split it, or move
  the detail to a diagram in the precision section.
- Use the precision section's names for every component and message, and its copy
  for every screen string, so a reader can search from the picture into the text.
- Every arrow or message must exist in the precision section. If you need one
  that is not there, the plan is incomplete.
- Mark what is new against what exists (a `classDef` for new parts, with a
  one-line legend in the caption).

**Syntax traps** (mermaid-cli 12.2.0):

- `;` ends a statement. In a `sequenceDiagram` message, `A->>B: hello; world` is a
  parse error, and `A->>B: x; B->>A: y` silently becomes two messages. Write `#59;`
  for a literal semicolon.
- `#` starts an entity: `A->>B: issue #42` renders as just "issue", with no error.
  Write `#35;`.
- An unquoted `(`, `[` or `{` inside a flowchart label is a parse error:
  `A[call foo(x)]` fails, `A["call foo(x)"]` works. Quote every label that has
  punctuation.
- `<br/>` makes a line break in labels and messages.

**Render every diagram before committing.** GitHub shows a syntax error as an
error box, and the `#` trap shows nothing at all, so look at the picture. Offline,
with mermaid-cli installed outside the repo (no `package.json` or lockfile change)
and pointed at an existing headless Chrome:

```sh
umask 002
MMDC_DIR=/var/tmp/$USER-mmdc    # anywhere outside the repo; a scratchpad works too
PUPPETEER_SKIP_DOWNLOAD=1 nice -n 10 npm install --prefix "$MMDC_DIR" --no-audit --no-fund @mermaid-js/mermaid-cli@12.2.0
CHROME=$(ls -d ~/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | tail -1)
printf '{"executablePath":"%s","args":["--no-sandbox"]}' "$CHROME" > "$MMDC_DIR/puppeteer.json"

# Render every mermaid block of a plan to PNGs next to out.md, outside the repo; exit 1 on any syntax error.
nice -n 10 "$MMDC_DIR/node_modules/.bin/mmdc" -q -p "$MMDC_DIR/puppeteer.json" \
  -i docs/plans/<plan>.md -o "$MMDC_DIR/out/<plan>.md" -e png
```

The blocks come out as `<plan>-1.png`, `<plan>-2.png`, … in file order; open them
(the Read tool shows images). On an error nothing is written, and the message
gives the line within the failing block only, so match its snippet to find the
block. If no cached Chrome exists, `npx puppeteer browsers install
chrome-headless-shell` fetches one into `~/.cache/puppeteer`.

## Mockups (when the plan has UI)

Drawn with `scripts/plans/mockup-kit` from the app's real theme, per
`docs/plans/CLAUDE.md`, "Diagrams and mockups". They exist so a person can review
the flow and the words in something that looks like Keyring.

- **Write the spec, not the SVG.** Create or edit
  `docs/plans/<plan>/mockups/mockups.ts`: one entry per screen or state, built
  from the kit's fragments (`header`, `tabBar`, `heading`, `body`, `display`,
  `primaryButton`, `secondaryButton`, `tertiaryButton`, `cardRow`, `layerRow`,
  `bottomSheet`, `errorNotice`, `placeholder`). Pick the fragment for the
  component the real screen would use. Run the spec to write the SVGs, then build
  the contact sheet with `kit.ts sheet` and look at it next to a real screenshot
  of a comparable screen (`e2e/artifacts/`, `docs/gate-evidence/`).
- **The app's chrome, or a reason.** Keyring's colour comes from three things,
  and a mockup without them reads as a wireframe: the gradient header with its
  centred white bold title, the filled purple primary button (with its shadow)
  for the screen's main action, and the near-black tab bar with the active tab
  white and bold. Each mockup draws each of them or says why not, in one of
  three ways:
  - **Drawn** from the plan's copy or the code: `header('<plan title>')`,
    `primaryButton('<plan label>', y)`, `tabBar('contacts')` where the code puts
    the screen in that tab (check the navigator: a screen in a stack above the
    tab navigator has no tab bar). An existing screen's own title is a token in
    `tokens.ts`, anchored to the app's strings.
  - **Assumed**: the screen has the element but the plan defines no words for
    it. Draw a stand-in in angle brackets, `header(undefined, { placeholder:
    '<title>', assumed: 'why' })` or `primaryButton('<action>', y, { assumed:
    'why' })`; the kit refuses a stand-in that is not `<…>`, outlines it with
    an orange "assumed" tag, and lists the reason in the notes. List every
    assumption under the sheet ("Assumed in these mockups").
  - **Omitted**: the screen has no such element (a screen above the tabs, a
    screen whose action is tapping a row or waiting). Declare it in the spec's
    `omits: { tabBar: 'why', primary: 'why' }`; the reason is shown in the
    notes and recorded in the SVG.
  `render` refuses a mockup that does none of these, and `check-plans.ts`
  flags a linked SVG that does not record them.
- **Words come only from the precision section.** Every visible string is copied
  verbatim from the copy for that screen. If you need words the plan does not
  have, add them to the precision section first, or leave the element out.
- **Skip screens you cannot draw.** A screen or state whose copy is not defined
  is not drawn; a title or main action that is not defined is an assumed
  `<…>` stand-in, as above, never invented words. List the undrawn screens under the contact sheet with the `§` that says the copy
  is missing. Do not fill the gap with grey bars or invented text.
- **Notes beside the phone** say what a picture cannot show (what the screen
  reader says, what happens on timeout, what is hidden on unsupported phones),
  and where the mockup made a choice the plan does not (a button tier, a sheet
  instead of a screen). They are annotations, never copy.
- Draw the states the precision section lists: the main path, at least one error,
  and empty or loading where they exist.
- **Build the contact sheet and look at it.** The sheet is what reviewers see:
  every screen with its notes, side by side, in the app's Source Sans 3, as a PNG
  that renders the same everywhere. An SVG on its own may not render correctly
  in some viewers (in VS Code the purple header and buttons were reported
  missing), so the SVGs are the editable source and the sheet is the review
  artifact. Regenerate it after any change to the spec, the kit or the theme, and
  commit `sheet.png` and `sheet.manifest.json` with the SVGs:

  ```sh
  node --experimental-strip-types docs/plans/<plan>/mockups/mockups.ts
  node --experimental-strip-types scripts/plans/mockup-kit/kit.ts sheet docs/plans/<plan>/mockups
  ```

  Then view `sheet.png`. Compare with a real screen (a screenshot under
  `docs/gate-evidence/`, or the component source) and fix the fragment, not the
  SVG, if a shape is wrong. (`kit.ts preview <dir> <out.png> [columns]` renders
  the same layout anywhere, for a look without touching the committed sheet.)
- **In the overview**, embed the sheet and link the sources:

  ```markdown
  ![Screens 1–N: 1. <one-line caption>; 2. <…>; …](./<plan>/mockups/sheet.png)

  Caption: <one line: what the screens show, in flow order>.
  Sources (SVG, generated from [`mockups.ts`](./<plan>/mockups/mockups.ts)):
  [1 <screen>](./<plan>/mockups/01-….svg) · [2 <screen>](./<plan>/mockups/02-….svg) · …
  ```

  The alt text names every screen, one `;`-separated item per SVG on the sheet,
  so the sheet still reads without the image. Do not also embed the SVGs one by
  one.
- An interactive prototype is an extra self-contained `.html` in the same folder,
  linked from the overview. The SVGs stay the reviewed record.

## The test summary

Built from the precision section's test plan, never wider than it:

```markdown
| Claim | Proved by | Runs where | Status |
|---|---|---|---|
| A draft is restored after the app is closed | jest, `draftStore.test.ts` (§8.1) | CI | Planned |
| A draft is never sent before Send is tapped | jest, mocked transport (§8.2) | CI | Planned |
| Drafts survive an OS-killed app on a real phone | Device run (§8.4) | Physical phones, by hand | Not run |
```

Where a claim can only be proved on hardware, say so in the row. If the plan has
a claim with no test, do not leave the row out: write "Not covered" and raise it
as a gap in the precision section.

## A worked example

An invented plan, for illustration: saving a message as a draft. Its precision
section is accurate but opens with the storage schema, a sync table and two
quoted requirements before a reader knows what they are deciding. An overview
opening for it:

> If you leave a chat before sending, what you typed is kept. When you come back,
> it is in the message box as you left it, and the chat list shows "Draft" under
> that contact's name. Drafts stay on this phone and are never sent anywhere until
> you tap Send (§1, §4).
>
> This makes **no claim that a draft survives reinstalling the app**, and drafts
> do not move between your phones (§1.2, §6).

Things to notice: it says what a person does and sees, in the plan's copy
("Draft"); the non-claim is the one bolded fact; the `§` pointers close each
paragraph; there are no module, storage or protocol names. The schema, if a
reader needs it, comes later under "How it works underneath".

## Companion summaries

A companion's human section is a `## Summary`, opened by the human marker and
banner, with the precision marker and banner before its findings (the template
has both). It is never a full overview: what was
concluded, which plan sections it changes, and any decision it asks for and from
whom. It does not re-summarise the plan.

- **Small companion → one paragraph, nothing else.** Small means it changes no
  flow, architecture or screen **and** touches at most three numbered sections
  of the plan (the criterion in `docs/plans/CLAUDE.md`, "Writing a dated
  companion"). No diagram, mockup or test table.
- **Otherwise → up to a few short paragraphs.** Add a diagram only if the
  companion changes a flow, and then show the superseded one beside the new one,
  since the plan keeps only the current version.

## Self-check (run every time, including after a precision-section edit)

- [ ] The human and precision markers and banners are in place (the checker
      enforces them).
- [ ] The overview opens with what a person sees and the journey diagram, with no
      protocol jargon before them.
- [ ] Every paragraph ends with a `§` pointer, and every pointer lands on a
      section that says what the paragraph says. A `§` on a line naming another
      plan is written explicitly ("this plan's §2", `locality-plan §2.1`).
- [ ] No claim, number, name, version or date in the overview is missing from,
      or different in, the precision section.
- [ ] Every open decision is in the decisions table with its recommendation (or
      "none yet, because …"), who decides and what it blocks; every conditional
      design, blocker and non-claim appears, with conditions intact.
- [ ] Each diagram's components and arrows exist in the precision section, and
      it renders (offline command above), with no `;` or `#` in sequence messages.
- [ ] Each mockup string appears verbatim in the precision section's copy (or is
      the app's own string, from a token); each listed state has a mockup or is
      listed as not drawn, with the reason; the mockups are regenerated from the
      spec, and the contact sheet is regenerated after them (`kit.ts sheet`),
      embedded with a caption and alt text naming each screen, with each SVG
      linked as its source.
- [ ] Each mockup draws the header title, the primary button and the tab bar, or
      marks them "assumed", or declares in `omits` why it has none; the
      assumptions are listed under the sheet; you have opened `sheet.png` itself
      (not the SVGs in an editor) and, next to a real screenshot, it reads as
      Keyring.
- [ ] The test table has a row per claim, including "Not covered" rows, and says
      what needs physical phones.
- [ ] One screen of prose. Nothing from the "what to remove" list survives a
      read-aloud.
- [ ] No AI, Claude or tool attribution anywhere.
- [ ] `node --experimental-strip-types scripts/plans/check-plans.ts <file>`
      passes: headings, markers, `§` references, Mermaid headers, mockup paths
      and fingerprints, and a contact sheet that is embedded and current (`docs/plans/CLAUDE.md`, "Checking a plan's structure").

If an item fails because the precision section is missing something, fix the
precision section first, then come back.
