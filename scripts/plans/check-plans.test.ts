// Tests for check-plans.ts. Run: node --experimental-strip-types --test scripts/plans/check-plans.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { sha256, sheetManifest } from './mockup-kit/kit.ts'
import { fingerprint } from './mockup-kit/tokens.ts'
import { checkText, classify, mockupProblem, FORMAT_START, HUMAN_MARKER, isExternalRef, namedDocuments, PRECISION_MARKER, run, sectionRefs } from './check-plans.ts'

const HUMAN = `${HUMAN_MARKER}\n\n> **Human part: for people deciding and reviewing.** The precision part wins.\n`
const PRECISION = `${PRECISION_MARKER}\n\n> **Precision part: for implementers and agents.** Implement from this.\n`

const plan = (body: string, overview = 'A short overview (§1).\n'): string =>
  `# Thing — does a thing\n\n**Status:** Draft.\n\n## Overview\n${HUMAN}\n${overview}\n---\n\n${PRECISION}\n${body}`

const companion = (summary: string, findings = '## Findings\n\n### 1. A finding\n'): string =>
  `# 2026 — t\n\n## Summary\n${HUMAN}\n${summary}\n\n${PRECISION}\n${findings}`

const GOOD = plan('## 1. Scope\n\nSee §2 and §2.1.\n\n## 2. Design\n\n### 2.1 Detail\n\nText.\n')

const CHROME_OK = '<!-- mockup-chrome: title=drawn tabBar=omitted primary=assumed --><!-- mockup-omits tabBar: outside the tabs. -->'
const KIT_SVG = `<svg><!-- mockup-kit tokens:${fingerprint()} -->${CHROME_OK}</svg>`

/** A plan's mockups folder with SVGs, sheet.png and a manifest that matches them, as fake file-system access. */
const sheetFs = (svgs: Record<string, string> = { '01-a.svg': KIT_SVG }, edit: (m: ReturnType<typeof sheetManifest>) => void = () => {}) => {
  const dir = path.join('docs/plans', 'x-plan/mockups')
  const manifest = sheetManifest('docs/plans/x-plan/mockups', svgs, sha256('png'), 3)
  edit(manifest)
  const files: Record<string, string> = { ...Object.fromEntries(Object.entries(svgs).map(([n, v]) => [path.join(dir, n), v])), [path.join(dir, 'sheet.png')]: 'png', [path.join(dir, 'sheet.manifest.json')]: JSON.stringify(manifest) }
  return {
    files,
    exists: (p: string): boolean => p in files,
    read: (p: string): string => files[p] ?? '',
    io: { list: (d: string) => (d === dir ? Object.keys(svgs) : []), hash: (p: string) => sha256(files[p] ?? '') },
  }
}
const SHEET_MD = '![1. A screen](./x-plan/mockups/sheet.png)\n\nSources: [01-a.svg](./x-plan/mockups/01-a.svg)'
const sheetMessages = (text: string, f = sheetFs()): string[] =>
  checkText('docs/plans/x-plan.md', 'plan', text, f.exists, f.read, f.io).map((p) => `${p.line}: ${p.message}`)

const messages = (text: string, exists: (p: string) => boolean = () => true, read: (p: string) => string = () => KIT_SVG): string[] =>
  checkText('docs/plans/x-plan.md', 'plan', text, exists, read).map((p) => `${p.line}: ${p.message}`)

test('classify: legacy plans, guidance files and old companions are skipped', () => {
  assert.equal(classify('x-plan.md', '# X\n\n## 1. Overview\n'), 'skip')
  assert.equal(classify('x-plan.md', '# X\n\n## Summary\n'), 'skip')
  assert.equal(classify('CLAUDE.md', '## Overview\n'), 'skip')
  assert.equal(classify('PLAN_TEMPLATE.md', '## Overview\n'), 'skip')
  assert.equal(classify('README.md', '## Overview\n'), 'skip')
  assert.equal(classify('x-plan/2026-11-16-al.md', '## Summary\n'), 'skip')
  assert.equal(classify('x-plan/mockups/notes.md', '## Overview\n'), 'skip')
})

test('classify: a plan with ## Overview and a companion dated from FORMAT_START are checked', () => {
  assert.equal(classify('x-plan.md', GOOD), 'plan')
  assert.equal(classify('x-plan/y_subtask.md', GOOD), 'plan')
  assert.equal(classify('x-plan/CLAUDE.md', GOOD), 'plan') // only the top-level guidance files are exempt
  assert.equal(classify(`x-plan/${FORMAT_START}-bam.md`, 'anything'), 'companion')
  assert.equal(classify('x-plan/2027-01-02-al.md', 'anything'), 'companion')
})

test('a well-formed plan passes', () => {
  assert.deepEqual(messages(GOOD), [])
})

test('the Overview must be first, single and unnumbered', () => {
  assert.match(messages(`# T\n\n## Background\n\n${GOOD.slice(GOOD.indexOf('## Overview'))}`).join('\n'), /must be the first/)
  assert.match(messages(GOOD.replace('## 1. Scope', '## Overview\n\n## 1. Scope')).join('\n'), /more than one/)
  assert.match(messages(GOOD.replace('## 1. Scope', '## 1. Overview')).join('\n'), /unnumbered/)
})

test('the Overview ends with a --- rule before ## 1.', () => {
  assert.match(messages(GOOD.replace('\n---\n', '\n')).join('\n'), /end with a `---` rule/)
})

test('the precision section is numbered from 1 without gaps', () => {
  assert.match(messages(GOOD.replace('## 2. Design', '## 3. Design').replace('§2 and §2.1', 'x')).join('\n'), /numbered 3, expected 2/)
  assert.match(messages(GOOD.replace('## 2. Design', '## Design').replace('§2 and §2.1', 'x')).join('\n'), /must be numbered/)
  assert.match(messages(plan('Just prose.\n')).join('\n'), /no numbered precision section/)
  assert.match(messages(GOOD.replace('## 2. Design', '## 2.1 Design')).join('\n'), /whole number/)
})

test('an appendix may follow the numbered sections', () => {
  assert.deepEqual(messages(`${GOOD}\n## Appendix A — raw data\n\nx\n`), [])
  assert.match(messages(`${GOOD}\n## Appendix A\n\n## 3. Late\n`).join('\n'), /after an appendix/)
})

test('§ references must resolve to a numbered heading', () => {
  const out = messages(GOOD.replace('See §2 and §2.1.', 'See §2.2, §§7 and §9 of this plan.'))
  assert.deepEqual(
    out.map((m) => m.replace(/^\d+: /, '')),
    [
      '§2.2 does not match any numbered heading in this file',
      '§7 does not match any numbered heading in this file',
      '§9 does not match any numbered heading in this file',
    ],
  )
})

test('§ references to other documents, in code, or in fences are not checked', () => {
  const body =
    '## 1. Scope\n\n' +
    'See [the release plan](./release-flow-plan.md) §5, `vta-carriage_subtask.md` §3, locality-plan §2.1,\n' +
    'locality-plan.md §4, framework 0.3 §7.3, RFC 9110 §15, §5.3 there, (§6 of the rooms subtask) and `§99`.\n\n' +
    '```text\n§42 in a fence\n```\n'
  assert.deepEqual(messages(plan(body)), [])
})

test('isExternalRef', () => {
  assert.equal(isExternalRef('see [x](./a.md) '), true)
  assert.equal(isExternalRef('see `a.md` '), true)
  assert.equal(isExternalRef('see (locality-plan '), true)
  assert.equal(isExternalRef('see trust_tasks_subtask '), true)
  assert.equal(isExternalRef('see its '), false)
  assert.equal(isExternalRef('('), false)
})

test('mermaid blocks must be non-empty and start with a diagram type', () => {
  const ok = GOOD.replace('Text.', '```mermaid\n%%{init: {}}%%\nflowchart TD\n  a --> b\n```\n\n```mermaid\n---\ntitle: x\n---\nsequenceDiagram\n  A->>B: hi\n```')
  assert.deepEqual(messages(ok), [])
  assert.match(messages(GOOD.replace('Text.', '```mermaid\n\n%% nothing\n```')).join('\n'), /mermaid block is empty/)
  assert.match(messages(GOOD.replace('Text.', '```mermaid\nflowchat TD\n  a --> b\n```')).join('\n'), /starts with "flowchat"/)
  assert.match(messages(GOOD.replace('Text.', '~~~~mermaid\ngraf\n~~~~')).join('\n'), /starts with "graf"/)
})

test('referenced SVGs and mockups must exist; other links and URLs are left alone', () => {
  const body = GOOD.replace(
    'Text.',
    '![a](./x-plan/mockups/01-a.svg)\n![b](./x-plan/mockups/02-b.svg "title")\n' +
      '[proto](./x-plan/mockups/flow.html#start)\n<img src="x-plan/pic.png">\n' +
      '[doc](./other.md) [web](https://example.com/a.svg) ![remote](https://example.com/b.png) `![c](./nope.svg)`',
  )
  const seen: string[] = []
  const exists = (p: string): boolean => {
    seen.push(p)
    return p.endsWith('01-a.svg')
  }
  // The contact-sheet rules are tested below.
  const out = messages(body, exists).filter((m) => !/sheet/.test(m))
  assert.deepEqual(
    out.map((m) => m.replace(/^\d+: /, '')),
    [
      './x-plan/mockups/02-b.svg does not exist',
      './x-plan/mockups/flow.html#start does not exist',
      'x-plan/pic.png does not exist',
    ],
  )
  assert.ok(seen.includes(path.join('docs/plans', 'x-plan/mockups/01-a.svg')))
  assert.ok(!seen.some((p) => p.includes('other.md') || p.includes('example.com') || p.includes('nope')))
})

test('linked mockups must come from the mockup kit, drawn with the current tokens', () => {
  const body = GOOD.replace('Text.', '![a](./x-plan/mockups/01-a.svg)')
  assert.deepEqual(sheetMessages(GOOD.replace('Text.', SHEET_MD)), [])
  assert.match(messages(body, () => true, () => '<svg/>').join('\n'), /not drawn with scripts\/plans\/mockup-kit/)
  assert.match(messages(body, () => true, () => '<svg><!-- mockup-kit tokens:000000000000 --></svg>').join('\n'), /drawn with theme tokens 000000000000, now [0-9a-f]{12}: regenerate/)
  assert.equal(mockupProblem('a.svg', KIT_SVG), null)
  // An SVG outside a mockups/ folder (a diagram export, say) is only checked for existence.
  assert.deepEqual(messages(GOOD.replace('Text.', '![d](./x-plan/diagram.svg)'), () => true, () => '<svg/>'), [])
})

test('a new companion must open with ## Summary; § references in it are not checked', () => {
  const file = `docs/plans/x-plan/${FORMAT_START}-bam.md`
  assert.deepEqual(checkText(file, 'companion', companion('Changes §42.')), [])
  const bad = checkText(file, 'companion', '# t\n\n## Findings\n\n## Summary\n')
  assert.equal(bad.length, 1)
  assert.match(bad[0].message, /opens with `## Summary`/)
  assert.equal(checkText(file, 'companion', '# t\n\nno headings').length, 1)
})

const companionMessages = (text: string): string[] =>
  checkText(`docs/plans/x-plan/${FORMAT_START}-bam.md`, 'companion', text).map((p) => p.message)

test('plan parts: each opens with its marker and banner', () => {
  assert.match(messages(GOOD.replace(HUMAN, '\n')).join('\n'), /must be followed by `<!-- plan-part: human -->`/)
  assert.match(messages(GOOD.replace(PRECISION, '')).join('\n'), /precision part must open with/)
  assert.match(messages(GOOD.replace(`## Overview\n${HUMAN}`, `## Overview\n\nIntro.\n\n${HUMAN}`)).join('\n'), /must be the first line after `## Overview`/)
  assert.match(messages(GOOD.replace('> **Human part', '> **For people')).join('\n'), /human part's banner/)
  assert.match(messages(GOOD.replace('> **Precision part', 'Implement this.')).join('\n'), /precision part's banner/)
  // The precision marker above the rule, or after `## 1.`.
  assert.match(messages(GOOD.replace(`\n---\n\n${PRECISION}`, `\n${PRECISION}\n---\n`)).join('\n'), /after the Overview's closing `---` rule/)
  assert.match(messages(GOOD.replace(PRECISION, '').replace('Text.', `Text.\n\n${PRECISION}`)).join('\n'), /must sit between/)
  assert.match(messages(GOOD.replace('Text.', `Text.\n\n${HUMAN_MARKER}`)).join('\n'), /more than one `<!-- plan-part: human -->`/)
  // A marker inside a code fence does not count.
  assert.match(messages(GOOD.replace(PRECISION, '```\n' + PRECISION + '```\n')).join('\n'), /precision part must open with/)
})

test('companion parts: Summary is human, findings are precision', () => {
  assert.deepEqual(companionMessages(companion('One paragraph.')), [])
  assert.match(companionMessages(companion('x').replace(HUMAN, '\n')).join('\n'), /`## Summary` must be followed by/)
  assert.match(companionMessages(companion('x').replace(PRECISION, '')).join('\n'), /before "## Findings"/)
})

test('legacy plans and old companions need no markers', () => {
  assert.equal(classify('x-plan/2026-11-19-al.md', '## Summary\n'), 'skip')
  assert.deepEqual(checkText('docs/plans/x-plan.md', 'skip', '## Overview\n'), [])
})

test('a bare § on a line that names another plan is flagged, with the explicit form suggested', () => {
  const out = messages(GOOD.replace('See §2 and §2.1.', 'This follows locality-plan.md, so see §2.'))
  assert.equal(out.length, 1)
  assert.match(out[0], /bare §2 on a line that names locality-plan: write `locality-plan §2`/)
  // The same with a link, a subtask, an RFC, and the plan named in a code span.
  for (const line of ['[the locality plan](./locality-plan.md) says so (§2).', 'trust_tasks_subtask has it; see §2.', 'RFC 9110 covers it; §2 here does not.', 'As `locality-plan.md` says; §2.']) {
    const m = messages(GOOD.replace('See §2 and §2.1.', line))
    if (line.includes('here')) assert.deepEqual(m, [], line)
    else assert.equal(m.length, 1, line)
  }
})

test('the explicit local forms are accepted on a line that names another plan', () => {
  for (const line of [
    "locality-plan §2.1 and this plan's §2 agree.",
    'locality-plan §2.1 and §2 of this plan agree.',
    "locality-plan §2.1 and the plan's §2 agree.",
    'locality-plan §2.1 agrees with §2 above.',
  ]) {
    assert.deepEqual(messages(GOOD.replace('See §2 and §2.1.', line)), [], line)
  }
})

test('the plan’s own name and folder are not another document', () => {
  const own = GOOD.replace('See §2 and §2.1.', 'The mockups in [x-plan/mockups](./x-plan/mockups/) follow §2.')
  assert.deepEqual(messages(own), [])
  assert.deepEqual(namedDocuments('see x-plan.md and §2', ['x-plan']), [])
  assert.deepEqual(namedDocuments('see [a](./locality-plan.md), `rooms_subtask.md` and RFC 6189', ['x-plan']).sort(), ['RFC 6189', 'locality-plan', 'rooms_subtask'])
})

test('a link or document name split from its § by a line break is still another document’s', () => {
  const split = GOOD.replace('See §2 and §2.1.', 'See [the locality\nplan](./locality-plan.md) §9 and\n[`locality-plan.md`](./locality-plan.md)\n§9.2, then locality-plan\n§8.')
  assert.deepEqual(messages(split), [])
  const refs = sectionRefs('a [b](./locality-plan.md)\n§9.2 c\n', ['x-plan'])
  assert.deepEqual(refs.map((r) => [r.line, r.external]), [[2, true]])
  // A bare § opening the line after one that names a plan is ambiguous too.
  assert.match(messages(GOOD.replace('See §2 and §2.1.', 'This is what locality-plan.md describes.\n(§2) applies.')).join('\n'), /bare §2/)
})

test('ranges and lists inherit the document of their first reference', () => {
  assert.deepEqual(messages(GOOD.replace('See §2 and §2.1.', 'See `locality-plan.md` §5.1–§5.4, locality-plan §9.1, §9.2 and §9.3.')), [])
  assert.deepEqual(messages(GOOD.replace('See §2 and §2.1.', 'See locality-plan.md §5.1–5.4.')), [])
  // A local range is checked at both ends.
  assert.deepEqual(
    messages(GOOD.replace('See §2 and §2.1.', 'See §1–§3.')).map((m) => m.replace(/^\d+: /, '')),
    ['§3 does not match any numbered heading in this file'],
  )
  assert.deepEqual(messages(GOOD.replace('See §2 and §2.1.', 'See §1–2.')), [])
})

test('companions: bare § means the parent plan, but ambiguity is still flagged', () => {
  assert.deepEqual(companionMessages(companion('Changes plan §4 and §99; locality-plan §2.1 and plan §7.')), [])
  assert.deepEqual(companionMessages(companion('In x-plan, §4 changed.')), []) // the parent plan's own name
  const out = companionMessages(companion('`locality-plan/2026-07-20-bam.md` §8.5 is one line; §4.4 says nothing.'))
  assert.equal(out.length, 1)
  assert.match(out[0], /bare §4.4 .* "plan §4.4" for the parent plan's/)
})

test('run: walks docs/plans, skips legacy files, reports problems with repo-relative paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-plans-'))
  try {
    const plans = path.join(root, 'docs', 'plans')
    fs.mkdirSync(path.join(plans, 'good-plan', 'mockups'), { recursive: true })
    fs.writeFileSync(path.join(plans, 'good-plan', 'mockups', '01-a.svg'), KIT_SVG)
    fs.writeFileSync(path.join(plans, 'good-plan', 'mockups', 'sheet.png'), 'png')
    fs.writeFileSync(
      path.join(plans, 'good-plan', 'mockups', 'sheet.manifest.json'),
      JSON.stringify(sheetManifest('docs/plans/good-plan/mockups', { '01-a.svg': KIT_SVG }, sha256('png'), 3)),
    )
    fs.writeFileSync(path.join(plans, 'good-plan.md'), GOOD.replace('Text.', '![1. A](./good-plan/mockups/sheet.png) [01-a.svg](./good-plan/mockups/01-a.svg)'))
    fs.writeFileSync(path.join(plans, 'legacy-plan.md'), '# Legacy\n\n## 1. Overview\n\n§99 and ![x](./missing.svg)\n')
    fs.writeFileSync(path.join(plans, 'CLAUDE.md'), '## Overview\n\n§99\n')
    fs.writeFileSync(path.join(plans, 'bad-plan.md'), GOOD.replace('See §2', 'See §8'))
    fs.mkdirSync(path.join(plans, 'bad-plan'))
    fs.writeFileSync(path.join(plans, 'bad-plan', '2026-01-01-al.md'), 'old, no summary')
    fs.writeFileSync(path.join(plans, 'bad-plan', `${FORMAT_START}-bam.md`), '# t\n\n## Findings\n')
    fs.writeFileSync(path.join(plans, 'good-plan', `${FORMAT_START}-bam.md`), companion('Fine.'))

    const all = run(root)
    assert.equal(all.checked.length, 4)
    assert.deepEqual(
      all.problems.map((p) => p.file).sort(),
      [path.join('docs/plans/bad-plan.md'), path.join('docs/plans/bad-plan', `${FORMAT_START}-bam.md`)].sort(),
    )

    const one = run(root, [path.join(plans, 'good-plan.md'), path.join(plans, 'legacy-plan.md')])
    assert.equal(one.checked.length, 1)
    assert.deepEqual(one.problems, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a linked mockup must draw, assume or declare why it omits its header title, tab bar and primary button', () => {
  const kit = `<!-- mockup-kit tokens:${fingerprint()} -->`
  assert.match(mockupProblem('a.svg', `<svg>${kit}</svg>`) ?? '', /does not record its header title, tab bar and primary button/)
  assert.match(mockupProblem('a.svg', `<svg>${kit}<!-- mockup-chrome: title=drawn primary=drawn --></svg>`) ?? '', /says nothing about its tabBar/)
  assert.match(mockupProblem('a.svg', `<svg>${kit}<!-- mockup-chrome: title=drawn tabBar=omitted primary=drawn --></svg>`) ?? '', /omits its tabBar without saying why/)
  assert.match(mockupProblem('a.svg', `<svg>${kit}<!-- mockup-chrome: title=drawn tabBar=omitted primary=drawn --><!-- mockup-omits tabBar:   --></svg>`) ?? '', /without saying why/)
  assert.equal(mockupProblem('a.svg', `<svg>${kit}<!-- mockup-chrome: title=assumed tabBar=drawn primary=drawn --></svg>`), null)
})

test('contact sheet: a file that links mockups embeds a current sheet.png and links every SVG', () => {
  const ok = GOOD.replace('Text.', SHEET_MD)
  assert.deepEqual(sheetMessages(ok), [])
  // Linked with an <img> or a plain link counts the same; a title on the image is allowed.
  assert.deepEqual(sheetMessages(GOOD.replace('Text.', '![1. A](x-plan/mockups/sheet.png "all screens")\n<img src="./x-plan/mockups/01-a.svg">')), [])
})

test('contact sheet: missing sheet.png', () => {
  const f = sheetFs()
  delete f.files[path.join('docs/plans', 'x-plan/mockups/sheet.png')]
  const out = sheetMessages(GOOD.replace('Text.', SHEET_MD), f).join('\n')
  assert.match(out, /x-plan\/mockups\/sheet\.png does not exist: the contact sheet is what reviewers see; generate it with `node --experimental-strip-types scripts\/plans\/mockup-kit\/kit\.ts sheet docs\/plans\/x-plan\/mockups`/)
  // Linking only an SVG still asks for the sheet.
  assert.match(sheetMessages(GOOD.replace('Text.', '[01-a.svg](./x-plan/mockups/01-a.svg)'), f).join('\n'), /sheet\.png does not exist/)
})

test('contact sheet: missing embed, alt text that does not list the screens, an unlinked SVG', () => {
  assert.match(sheetMessages(GOOD.replace('Text.', '[01-a.svg](./x-plan/mockups/01-a.svg)')).join('\n'), /embed the contact sheet for x-plan\/mockups: `!\[<the screens/)
  // A plain link to the sheet is not an embed.
  assert.match(sheetMessages(GOOD.replace('Text.', '[sheet](./x-plan/mockups/sheet.png) [01-a.svg](./x-plan/mockups/01-a.svg)')).join('\n'), /embed the contact sheet/)
  const two = sheetFs({ '01-a.svg': KIT_SVG, '02-b.svg': KIT_SVG })
  const both = '[01-a.svg](./x-plan/mockups/01-a.svg) [02-b.svg](./x-plan/mockups/02-b.svg)'
  assert.deepEqual(sheetMessages(GOOD.replace('Text.', `![1. A; 2. B](./x-plan/mockups/sheet.png)\n${both}`), two), [])
  assert.match(sheetMessages(GOOD.replace('Text.', `![Mockups](./x-plan/mockups/sheet.png)\n${both}`), two).join('\n'), /alt text lists 1 screen\(s\), but x-plan\/mockups has 2/)
  assert.match(sheetMessages(GOOD.replace('Text.', `![](./x-plan/mockups/sheet.png)\n${both}`), two).join('\n'), /alt text lists 0 screen/)
  assert.match(sheetMessages(GOOD.replace('Text.', '![1. A; 2. B](./x-plan/mockups/sheet.png) [01-a.svg](./x-plan/mockups/01-a.svg)'), two).join('\n'), /not linked: 02-b\.svg/)
})

test('contact sheet: a stale sheet fails with the regeneration command; no browser is needed', () => {
  const md = GOOD.replace('Text.', SHEET_MD)
  const stale = (f: ReturnType<typeof sheetFs>): string => sheetMessages(md, f).join('\n')
  const changed = sheetFs()
  changed.files[path.join('docs/plans', 'x-plan/mockups/01-a.svg')] = KIT_SVG.replace('</svg>', '<text>new</text></svg>')
  assert.match(stale(changed), /x-plan\/mockups\/sheet\.png is stale \(01-a\.svg changed\): regenerate it with `node --experimental-strip-types scripts\/plans\/mockup-kit\/kit\.ts sheet docs\/plans\/x-plan\/mockups` and commit it with the SVGs/)
  assert.match(stale(sheetFs(undefined, (m) => (m.tokens = '000000000000'))), /stale \(theme tokens 000000000000, now [0-9a-f]{12}\)/)
  assert.match(stale(sheetFs(undefined, (m) => (m.layout = 0))), /stale \(sheet layout 0, now 1\)/)
  assert.match(stale(sheetFs(undefined, (m) => (m.sheet.sha256 = 'f'.repeat(64)))), /sheet\.png is not the image the manifest describes/)
  assert.match(stale(sheetFs(undefined, (m) => (m.svgs['00-gone.svg'] = 'x'))), /00-gone\.svg is on it but no longer in the folder/)
  const added = sheetFs()
  const io = { ...added.io, list: () => ['01-a.svg', '02-b.svg'] }
  added.files[path.join('docs/plans', 'x-plan/mockups/02-b.svg')] = KIT_SVG
  assert.match(sheetMessages(GOOD.replace('Text.', '![1. A; 2. B](./x-plan/mockups/sheet.png) [01-a.svg](./x-plan/mockups/01-a.svg) [02-b.svg](./x-plan/mockups/02-b.svg)'), { ...added, io }).join('\n'), /stale \(02-b\.svg is not on it\)/)
  const noManifest = sheetFs()
  delete noManifest.files[path.join('docs/plans', 'x-plan/mockups/sheet.manifest.json')]
  assert.match(stale(noManifest), /sheet\.manifest\.json is missing or unreadable: regenerate it/)
})

test('contact sheet: legacy plans and files without mockups are not asked for one', () => {
  assert.deepEqual(checkText('docs/plans/x-plan.md', 'skip', '# Legacy\n\n![a](./x-plan/mockups/01-a.svg)\n'), [])
  assert.deepEqual(sheetMessages(GOOD.replace('Text.', '[web](https://example.com/mockups/01-a.svg)')), [])
})
