#!/usr/bin/env node
// check-plans.ts — structure check for plans under docs/plans/ written in the two-part format
// (docs/plans/CLAUDE.md, "Two parts" and "Checking a plan's structure").
//
// Which files it checks (everything else is legacy and skipped, so no existing plan fails):
//   - a plan or subtask plan: any docs/plans/**/*.md that is not a dated companion and has a `## Overview` heading;
//   - a dated companion (`YYYY-MM-DD-<initials>.md`) dated on or after FORMAT_START.
// docs/plans/CLAUDE.md, README.md and PLAN_TEMPLATE.md are guidance, not plans, and are never checked.
//
// What it checks:
//   plans:      one unnumbered `## Overview`, the first `##` heading, closed by a `---` rule before `## 1.`;
//               every later `##` heading numbered `## N.` from 1 with no gaps (an `## Appendix …` may follow);
//               every local `§N` / `§N.M` reference resolves to a heading carrying that number.
//   companions: a `## Summary` as the first `##` heading. Bare `§` references mean the parent plan's and are
//               not resolved (the parent is not read), only checked for ambiguity.
//   both:       the two parts open with their markers and banners (`<!-- plan-part: human -->` after
//               `## Overview` / `## Summary`, `<!-- plan-part: precision -->` before the numbered sections or
//               the findings); a bare `§` on a line that names another plan or document must be written in the
//               explicit form; every ```mermaid block is non-empty and starts with a known diagram type; every
//               relative image, `.svg` or `mockups/` path it links exists, and every linked mockup SVG was drawn
//               by scripts/plans/mockup-kit with the current theme-token fingerprint; a file that links a
//               mockups/ folder embeds its contact sheet, `![<screens, one per mockup, ;-separated>](…/sheet.png)`,
//               links every SVG in it, and the sheet's manifest matches the SVGs and tokens (a hash compare: the
//               check needs no browser; `kit.ts sheet` regenerates the sheet).
//
//   tiers:      a plan that carries `<!-- plan-format: tiers -->` in its header block (before `## Overview`) is also checked
//               for the iterative-MVP format (docs/plans/CLAUDE.md, "Tiers, lanes and upstream asks"): §7 opens with
//               `### 7.0 Tiers, lanes and order` holding a tiers table, a lanes table, a ```mermaid dependency graph and a
//               stack table; every other `###` step heading ends in a tier `(P0)`, `(P1)` or `(P2)` and has an
//               `**Owner:**` line; no step starts after a later-tier step; a step that names a `VTI-` id has a
//               `**Fallback:**` line; the Overview has a `**Decisions made**` table whose Who cells name a person, never
//               "the user", "the product owner" or "the owner"; the upstream section is
//               "Upstream asks and blocked on whom" with the table `Ask | Id | Blocks (step, tier) | Fallback meanwhile`;
//               every `VTI-Q…` / `VTI-NN` the plan names is registered in docs/VTI_UPSTREAM_FINDINGS.md and every one
//               named in §7 is in that table. The marker is opt-in, so plans written before it keep passing.
//
//   roles:      a plan's text, and a dated companion's from ROLE_CHECK_START (2026-11-26) on, credits no decision, ask,
//               review or word to a role ("the product owner", "decided with the user", "the user's word", "(the user,"),
//               and a Who / Owner / Decided by / By table cell is never just a role; text in backticks or double quotes
//               is not read. Plans in ROLE_CREDIT_ALLOW are exempt.
//
//   node --experimental-strip-types scripts/plans/check-plans.ts            → every plan under docs/plans/
//   node --experimental-strip-types scripts/plans/check-plans.ts <file…>    → only these files
//   (Node 22.6 or later; `bun scripts/plans/check-plans.ts` also works.) Exit 1 on any error.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { CHROME, CHROME_MARK, OMITS_MARK, sha256, SHEET_FILE, SHEET_LAYOUT, SHEET_MANIFEST, sheetCommand, type SheetManifest } from './mockup-kit/kit.ts'
import { fingerprint } from './mockup-kit/tokens.ts'

const KIT_MARK = /<!-- mockup-kit tokens:([0-9a-f]+)/

/** Dated companions from this day on follow the two-part form (docs/plans/CLAUDE.md, "Existing plans"). */
export const FORMAT_START = '2026-11-20'

const GUIDANCE = new Set(['CLAUDE.md', 'README.md', 'PLAN_TEMPLATE.md'])
const DATED = /^(\d{4}-\d{2}-\d{2})-.+\.md$/

/** Diagram types Mermaid recognises as the first statement of a diagram. */
export const MERMAID_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'stateDiagram-v2',
  'stateDiagram',
  'classDiagram',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'requirementDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'architecture-beta',
  'kanban',
]

export type Kind = 'plan' | 'companion' | 'skip'

export interface Problem {
  file: string
  line: number
  message: string
}

/** Whether a file is checked, and as what. `rel` is the path relative to docs/plans/. */
export const classify = (rel: string, text: string): Kind => {
  const base = path.basename(rel)
  if (!base.endsWith('.md')) return 'skip'
  if (!rel.includes('/') && GUIDANCE.has(base)) return 'skip'
  if (rel.split('/').includes('mockups')) return 'skip'
  const dated = DATED.exec(base)
  if (dated) return dated[1] >= FORMAT_START ? 'companion' : 'skip'
  return /^## Overview[ \t]*$/m.test(text) ? 'plan' : 'skip'
}

interface Line {
  n: number // 1-based
  text: string
  inFence: boolean // inside a fenced code block (fence lines themselves count as inside)
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/

const scan = (text: string): Line[] => {
  const out: Line[] = []
  let fence: string | null = null
  text.split(/\r?\n/).forEach((t, i) => {
    const m = FENCE.exec(t)
    if (fence === null && m) {
      fence = m[1]
      out.push({ n: i + 1, text: t, inFence: true })
    } else if (fence !== null) {
      out.push({ n: i + 1, text: t, inFence: true })
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && m[2].trim() === '') fence = null
    } else out.push({ n: i + 1, text: t, inFence: false })
  })
  return out
}

interface Heading {
  n: number
  level: number
  title: string
  number: string | null // "3", "3.2" — the leading section number, if any
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const NUMBERED = /^(\d+(?:\.\d+)*)\.?(?=\s|$)/

const headings = (lines: Line[]): Heading[] =>
  lines.flatMap((l) => {
    if (l.inFence) return []
    const m = HEADING.exec(l.text)
    if (!m) return []
    const title = m[2]
    const num = NUMBERED.exec(title)
    return [{ n: l.n, level: m[1].length, title, number: num ? num[1] : null }]
  })

/** Text with inline code spans blanked out, so a `§` or a link inside backticks is not read as one. */
const withoutCode = (s: string): string => s.replace(/(`+)[^`]*?\1/g, (c) => ' '.repeat(c.length))

/**
 * A `§` reference points into another document when what comes right before it is a link, a code span,
 * a document name (`*.md`, `*-plan`, `*_subtask`) or a version number ("framework 0.3 §7"). After it,
 * "there" or "of <document>" does the same ("§5.3 there", "§2 of the rooms subtask").
 */
export const isExternalRef = (before: string): boolean => {
  const b = before.replace(/[\s*_"'’]+$/, '')
  if (/\]\([^)]*\)$/.test(b)) return true // [doc](./doc.md) §3
  if (/`$/.test(b)) return true // `doc.md` §3
  const token = (/(\S+)$/.exec(b) ?? ['', ''])[1].replace(/^[(\["'“]+/, '').replace(/[)'’]+$/, '')
  if (/\.(md|html)$/i.test(token)) return true
  if (/[-_](plan|subtask)$/i.test(token)) return true
  if (/^v?\d+(\.\d+)*[,;:]?$/.test(token)) return true
  if (/^RFC$/i.test(token)) return true
  return false
}

/**
 * Marks a bare `§` as this file's (a companion's: its parent plan's) on a line that also names another
 * document: "this plan's §3", "the plan's §3", "plan §3", "§3 of this plan", "§3 here".
 */
const LOCAL_BEFORE = /(\b(this|the) (plan|file|document|companion|subtask)['’]s?|(^|[\s(])plan)\s*$/i
const LOCAL_AFTER = /^\)?\s*(of this (plan|file|document|companion|subtask)|here|above|below)\b/i
/** Between two references, a range or list joiner: the second belongs to the same document as the first. */
const JOINER = /^\s*(–|—|-|to|,|and|or|&|\/)\s*$/i

/**
 * Other documents a line names: a link to a `.md`, a `*.md` file, a `*-plan` or `*_subtask` name, or an RFC.
 * `self` (the file's own plan name, e.g. "x-plan") is not another document.
 */
export const namedDocuments = (line: string, self: string[] = []): string[] => {
  const t = line.replace(/(`+)([^`]*?)\1/g, ' $2 ')
  const found = new Set<string>()
  for (const m of t.matchAll(/\]\(\s*<?([^)\s>]+)/g)) {
    const target = m[1].split(/[#?]/)[0]
    if (/\.md$/i.test(target)) found.add(path.basename(target, '.md'))
  }
  for (const m of t.matchAll(/(?<![\w./-])((?:[\w.-]+\/)*[\w-]+?(?:\.md|-plan|_subtask))(?![\w-])/gi)) {
    found.add(path.basename(m[1], '.md'))
  }
  for (const m of t.matchAll(/\bRFC\s?\d+/g)) found.add(m[0])
  return [...found].filter((d) => !self.includes(d))
}

const SECTION_REF = /§§?\s?(\d+(?:\.\d+)*)(?:\s?[–—]\s?§?(\d+(?:\.\d+)*))?/g

interface Ref {
  line: number
  refs: string[] // the number, and a range end ("§5.1–5.4") when there is one
  external: boolean
  ambiguous: string[] // other documents named on the same line, when this bare reference reads as local
}

/**
 * Every `§` reference outside code and fences, with whether it points into another document. Lines of a
 * paragraph are joined first, so a link or a document name split from its `§` by a line break still counts.
 */
export const sectionRefs = (text: string, self: string[] = []): Ref[] => {
  const lines = scan(text)
  const out: Ref[] = []
  let para: Line[] = []
  const flush = (): void => {
    if (para.length === 0) return
    const starts: number[] = []
    let joined = ''
    for (const l of para) {
      starts.push(joined.length)
      joined += withoutCode(l.text) + ' '
    }
    const raw = para.map((l) => l.text).join(' ')
    const lineAt = (at: number): number => {
      let i = 0
      while (i + 1 < starts.length && starts[i + 1] <= at) i++
      return i
    }
    let prevEnd = -1
    let prevExternal = false
    let prevLocal = false
    for (const m of joined.matchAll(SECTION_REF)) {
      const at = m.index ?? 0
      const before = raw.slice(0, at)
      const after = raw.slice(at + m[0].length)
      let external = isExternalRef(before) || /^\)?\s+(there\b|of\s+(?!this\b))/i.test(after)
      let local = LOCAL_BEFORE.test(before) || LOCAL_AFTER.test(after)
      if (!external && !local && prevEnd >= 0 && JOINER.test(joined.slice(prevEnd, at))) {
        external = prevExternal
        local = prevLocal
      }
      const i = lineAt(at)
      // The line itself, plus the line before when the reference opens this one.
      const context = para[i].text + (i > 0 && /^[\s(\[,;:–—-]*$/.test(joined.slice(starts[i], at)) ? ' ' + para[i - 1].text : '')
      const ambiguous = external || local ? [] : namedDocuments(context, self)
      out.push({ line: para[i].n, refs: [m[1], m[2]].filter((r): r is string => r !== undefined).map((r) => r.replace(/\.$/, '')), external, ambiguous })
      prevEnd = at + m[0].length
      prevExternal = external
      prevLocal = local
    }
    para = []
  }
  for (const l of lines) {
    if (l.inFence || l.text.trim() === '' || HEADING.test(l.text) || /^\s*(\||<!--)/.test(l.text)) {
      flush()
      if (!l.inFence && l.text.trim() !== '') {
        para = [l]
        flush()
      }
    } else para.push(l)
  }
  flush()
  return out
}

/** Plan names a file treats as its own: a plan's base name; for a file in a plan's folder, that folder. */
const selfNames = (file: string): string[] => {
  const base = path.basename(file, '.md')
  const parent = path.basename(path.dirname(file))
  return parent === 'plans' ? [base] : [base, parent]
}

const checkSectionRefs = (
  file: string,
  text: string,
  hs: Heading[] | null,
  problem: (n: number, m: string) => void,
): void => {
  const known = hs === null ? null : new Set(hs.filter((h) => h.number !== null).map((h) => h.number as string))
  for (const r of sectionRefs(text, selfNames(file))) {
    if (r.external) continue
    if (r.ambiguous.length > 0) {
      const mine = hs === null ? `"plan §${r.refs[0]}" for the parent plan's` : `"this plan's §${r.refs[0]}" for this file's`
      problem(
        r.line,
        `bare §${r.refs[0]} on a line that names ${r.ambiguous.join(', ')}: write \`${r.ambiguous[0]} §${r.refs[0]}\` ` +
          `for that document's section, or ${mine}`,
      )
      continue
    }
    if (known === null) continue
    for (const ref of r.refs) if (!known.has(ref)) problem(r.line, `§${ref} does not match any numbered heading in this file`)
  }
}

const checkMermaid = (lines: Line[], problem: (n: number, m: string) => void): void => {
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i].text)
    if (!lines[i].inFence || !open || open[2].trim() !== 'mermaid') continue
    const start = lines[i].n
    const body: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      const close = FENCE.exec(lines[j].text)
      if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length && close[2].trim() === '') break
      body.push(lines[j].text)
    }
    i = j
    // Drop an optional front-matter block (--- … ---) and %% comments / directives.
    let content = body.map((s) => s.trim())
    if (content[0] === '---') {
      const end = content.indexOf('---', 1)
      content = end === -1 ? [] : content.slice(end + 1)
    }
    content = content.filter((s) => s !== '' && !s.startsWith('%%'))
    if (content.length === 0) {
      problem(start, 'mermaid block is empty')
      continue
    }
    const first = content[0].split(/[\s;]/)[0]
    if (!MERMAID_TYPES.includes(first)) {
      problem(start, `mermaid block starts with "${first}", not a diagram type (${MERMAID_TYPES.slice(0, 6).join(', ')}, …)`)
    }
  }
}

const LINK = /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const IMG_SRC = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi

/** Why a mockup SVG is not current with the theme tokens, or null (docs/plans/CLAUDE.md, "Diagrams and mockups"). */
export const mockupProblem = (target: string, svg: string, current = fingerprint()): string | null => {
  const m = KIT_MARK.exec(svg)
  if (!m) return `${target} was not drawn with scripts/plans/mockup-kit (no token fingerprint)`
  if (m[1] !== current) return `${target} was drawn with theme tokens ${m[1]}, now ${current}: regenerate it from its spec`
  // Header title, tab bar and primary button: each drawn, an assumed stand-in, or omitted with a declared reason.
  const chrome = new RegExp(`<!-- ${CHROME_MARK} ([^>]*?) -->`).exec(svg)
  if (!chrome) return `${target} does not record its header title, tab bar and primary button (${CHROME_MARK}): regenerate it from its spec`
  const states = Object.fromEntries(chrome[1].split(/\s+/).map((kv) => kv.split('=')))
  for (const c of CHROME) {
    const state = states[c]
    if (state === 'drawn' || state === 'assumed') continue
    if (state !== 'omitted') return `${target} says nothing about its ${c} (${CHROME_MARK}): draw it or declare omits.${c} in the spec`
    const why = new RegExp(`<!-- ${OMITS_MARK} ${c}: ([^>]*?) -->`).exec(svg)
    if (!why || why[1].trim() === '') return `${target} omits its ${c} without saying why: declare omits.${c} in the spec`
  }
  return null
}

const checkAssets = (
  file: string,
  lines: Line[],
  exists: (p: string) => boolean,
  problem: (n: number, m: string) => void,
  read: (p: string) => string,
): void => {
  const dir = path.dirname(file)
  for (const l of lines) {
    if (l.inFence) continue
    const text = withoutCode(l.text)
    const targets: string[] = []
    for (const m of text.matchAll(LINK)) {
      const target = m[2]
      const isImage = m[1] === '!'
      const bare = target.split(/[#?]/)[0]
      if (isImage || /\.svg$/i.test(bare) || /(^|\/)mockups\//.test(bare)) targets.push(target)
    }
    for (const m of text.matchAll(IMG_SRC)) targets.push(m[1])
    for (const target of targets) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) continue
      const bare = decodeURIComponent(target.split(/[#?]/)[0])
      if (bare === '') continue
      if (!exists(path.join(dir, bare))) problem(l.n, `${target} does not exist`)
      else if (/(^|\/)mockups\/[^/]+\.svg$/i.test(bare)) {
        const why = mockupProblem(target, read(path.join(dir, bare)))
        if (why) problem(l.n, why)
      }
    }
  }
}

const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const MOCKUP_SVG = /^\d{2}-[a-z0-9-]+\.svg$/

/** File-system access beyond exists/read, injectable for tests: a folder listing and a file's sha256. */
export interface SheetIo {
  list?: (dir: string) => string[]
  hash?: (file: string) => string
}

const defaultList = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * The contact sheet (docs/plans/CLAUDE.md, "Diagrams and mockups"): every mockups/ folder a file links needs its
 * `sheet.png` embedded with alt text listing the screens (one `;`-separated item per mockup), a link to each SVG
 * source, and a `sheet.manifest.json` whose SVG hashes, token fingerprint and layout match what is there now.
 */
const checkSheets = (
  file: string,
  lines: Line[],
  exists: (p: string) => boolean,
  problem: (n: number, m: string) => void,
  read: (p: string) => string,
  io: SheetIo,
): void => {
  const base = path.dirname(file)
  interface Folder {
    first: number
    svgs: Set<string>
    embeds: { n: number; alt: string }[]
  }
  const folders = new Map<string, Folder>()
  const folder = (dir: string, n: number): Folder => {
    const key = path.normalize(dir)
    let f = folders.get(key)
    if (!f) folders.set(key, (f = { first: n, svgs: new Set(), embeds: [] }))
    return f
  }
  for (const l of lines) {
    if (l.inFence) continue
    const text = withoutCode(l.text)
    const targets = [...[...text.matchAll(LINK)].map((m) => m[2]), ...[...text.matchAll(IMG_SRC)].map((m) => m[1])]
    for (const target of targets) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue
      const bare = decodeURIComponent(target.split(/[#?]/)[0])
      const m = /^(.*(?:^|\/)mockups)\/([^/]+)$/.exec(bare)
      if (!m) continue
      if (MOCKUP_SVG.test(m[2])) folder(m[1], l.n).svgs.add(m[2])
      else if (m[2] === SHEET_FILE) folder(m[1], l.n)
    }
    for (const m of text.matchAll(IMAGE)) {
      const bare = decodeURIComponent(m[2].split(/[#?]/)[0])
      const s = /^(.*(?:^|\/)mockups)\/sheet\.png$/.exec(bare)
      if (s) folder(s[1], l.n).embeds.push({ n: l.n, alt: m[1] })
    }
  }
  const list = io.list ?? defaultList
  const hash = io.hash ?? ((p: string) => sha256(fs.readFileSync(p)))
  for (const [dir, f] of folders) {
    const abs = path.join(base, dir)
    const sheet = `${dir}/${SHEET_FILE}`
    const regen = `regenerate it with \`${sheetCommand(path.join(base, dir).split(path.sep).join('/'))}\` and commit it with the SVGs`
    const at = f.embeds[0]?.n ?? f.first
    if (!exists(path.join(abs, SHEET_FILE))) {
      problem(at, `${sheet} does not exist: the contact sheet is what reviewers see; ${regen.replace('regenerate it', 'generate it')}`)
      continue
    }
    let manifest: SheetManifest | null = null
    try {
      manifest = exists(path.join(abs, SHEET_MANIFEST)) ? (JSON.parse(read(path.join(abs, SHEET_MANIFEST))) as SheetManifest) : null
    } catch {
      manifest = null
    }
    const onDisk = list(abs).filter((n) => MOCKUP_SVG.test(n)).sort()
    const screens = onDisk.length > 0 ? onDisk : Object.keys(manifest?.svgs ?? {}).sort()
    if (f.embeds.length === 0) {
      problem(f.first, `embed the contact sheet for ${dir}: \`![<the screens, one per mockup, separated by ;>](${sheet})\`; link the SVGs as its sources`)
    } else {
      const items = f.embeds[0].alt.split(';').filter((s) => s.trim() !== '').length
      if (items !== screens.length) {
        problem(f.embeds[0].n, `the contact sheet's alt text lists ${items} screen(s), but ${dir} has ${screens.length}: name each, separated by ";"`)
      }
    }
    const unlinked = screens.filter((n) => !f.svgs.has(n))
    if (unlinked.length > 0) problem(at, `link each mockup's SVG source next to the sheet; not linked: ${unlinked.join(', ')}`)
    if (!manifest) {
      problem(at, `${dir}/${SHEET_MANIFEST} is missing or unreadable: ${regen}`)
      continue
    }
    const stale: string[] = []
    if (manifest.layout !== SHEET_LAYOUT) stale.push(`sheet layout ${manifest.layout}, now ${SHEET_LAYOUT}`)
    if (manifest.tokens !== fingerprint()) stale.push(`theme tokens ${manifest.tokens}, now ${fingerprint()}`)
    const recorded = Object.keys(manifest.svgs ?? {}).sort()
    for (const n of screens) {
      if (!recorded.includes(n)) stale.push(`${n} is not on it`)
      else if (manifest.svgs[n] !== sha256(read(path.join(abs, n)))) stale.push(`${n} changed`)
    }
    for (const n of recorded) if (!screens.includes(n)) stale.push(`${n} is on it but no longer in the folder`)
    if (manifest.sheet?.sha256 !== hash(path.join(abs, SHEET_FILE))) stale.push(`${SHEET_FILE} is not the image the manifest describes`)
    if (stale.length > 0) problem(at, `${sheet} is stale (${stale.join('; ')}): ${regen}`)
  }
}

/** The machine-readable markers that open each part (docs/plans/CLAUDE.md, "Telling the two parts apart"). */
export const HUMAN_MARKER = '<!-- plan-part: human -->'
export const PRECISION_MARKER = '<!-- plan-part: precision -->'
const BANNER = { human: /^> \*\*Human part\b/, precision: /^> \*\*Precision part\b/ }

/**
 * Each part opens with its marker and, as the next non-blank line, its visible banner. The human marker is the
 * first line after `## Overview` (plan) or `## Summary` (companion); the precision marker sits after that
 * section and before the next `##` heading, which for a plan is `## 1.`, after the `---` rule.
 */
const checkParts = (
  kind: 'plan' | 'companion',
  lines: Line[],
  h2: Heading[],
  problem: (n: number, m: string) => void,
): void => {
  const opener = h2[0]
  if (!opener) return
  const name = kind === 'plan' ? '## Overview' : '## Summary'
  const at = (marker: string): Line[] => lines.filter((l) => !l.inFence && l.text.trim() === marker)
  const nextNonBlank = (n: number): Line | undefined => lines.find((l) => l.n > n && l.text.trim() !== '')
  const human = at(HUMAN_MARKER)
  const precision = at(PRECISION_MARKER)
  for (const [marker, found] of [
    [HUMAN_MARKER, human],
    [PRECISION_MARKER, precision],
  ] as const) {
    if (found.length > 1) problem(found[1].n, `more than one \`${marker}\``)
  }
  const first = nextNonBlank(opener.n)
  if (human.length === 0) problem(opener.n, `\`${name}\` must be followed by \`${HUMAN_MARKER}\` and a "> **Human part…**" banner`)
  else if (first?.n !== human[0].n) problem(human[0].n, `\`${HUMAN_MARKER}\` must be the first line after \`${name}\``)
  const close = h2.find((h) => h.n > opener.n)
  if (precision.length === 0) {
    problem(close?.n ?? opener.n, `the precision part must open with \`${PRECISION_MARKER}\` and a "> **Precision part…**" banner before ${close ? `"## ${close.title}"` : 'its first `##` heading'}`)
  } else if (precision[0].n < opener.n || (close && precision[0].n > close.n)) {
    problem(precision[0].n, `\`${PRECISION_MARKER}\` must sit between \`${name}\` and the next \`##\` heading`)
  } else if (kind === 'plan') {
    const rule = lines.find((l) => l.n > opener.n && !l.inFence && /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l.text))
    if (rule && rule.n > precision[0].n) problem(precision[0].n, `\`${PRECISION_MARKER}\` goes after the Overview's closing \`---\` rule`)
  }
  for (const [part, found] of [
    ['human', human],
    ['precision', precision],
  ] as const) {
    if (found.length === 0) continue
    const banner = nextNonBlank(found[0].n)
    if (!banner || !BANNER[part].test(banner.text)) {
      problem(found[0].n, `the ${part} part's banner ("> **${part === 'human' ? 'Human' : 'Precision'} part…**") must follow its marker`)
    }
  }
}

const checkPlan = (hs: Heading[], lines: Line[], problem: (n: number, m: string) => void): void => {
  const h2 = hs.filter((h) => h.level === 2)
  const overviews = h2.filter((h) => /^Overview$/.test(h.title))
  if (overviews.length > 1) problem(overviews[1].n, 'more than one `## Overview`')
  const numberedOverview = h2.find((h) => h.number !== null && /^\d+(\.\d+)*\.?\s+Overview\b/.test(h.title))
  if (numberedOverview) problem(numberedOverview.n, 'the Overview is unnumbered: `## Overview`, not a numbered heading')
  const overview = overviews[0]
  if (!overview) {
    problem(1, 'no `## Overview` heading')
    return
  }
  if (h2[0] !== overview) problem(h2[0].n, `\`## Overview\` must be the first \`##\` heading (found "## ${h2[0].title}")`)

  const after = h2.filter((h) => h.n > overview.n && h !== overviews[1])
  const firstNumbered = after.find((h) => h.number !== null)
  if (!firstNumbered) {
    problem(overview.n, 'no numbered precision section (`## 1. …`) after the Overview')
  } else {
    const between = lines.filter((l) => l.n > overview.n && l.n < firstNumbered.n && !l.inFence)
    if (!between.some((l) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l.text))) {
      problem(firstNumbered.n, 'the Overview must end with a `---` rule before the precision section')
    }
  }

  let expected = 1
  let appendix = false
  for (const h of after) {
    if (/^Appendix\b/i.test(h.title)) {
      appendix = true
      continue
    }
    if (h.number === null) {
      problem(h.n, `"## ${h.title}" is in the precision section and must be numbered (\`## ${expected}. …\`)`)
      continue
    }
    if (appendix) {
      problem(h.n, `numbered section "## ${h.title}" after an appendix`)
      continue
    }
    if (h.number.includes('.')) {
      problem(h.n, `"## ${h.title}": a \`##\` heading takes a whole number; subsections are \`###\``)
      continue
    }
    const got = Number(h.number)
    if (got !== expected) problem(h.n, `section numbered ${got}, expected ${expected}`)
    expected = got + 1
  }
}


/** Opt-in marker (header block, before `## Overview`): the plan follows the tiers, lanes and upstream-asks format. */
export const TIERS_MARKER = '<!-- plan-format: tiers -->'
export const FINDINGS_FILE = 'docs/VTI_UPSTREAM_FINDINGS.md'
const TIER = /\((P[012])\)\s*$/
const VTI_ID = /\bVTI-(?:Q\d+|\d{2})\b/g

/** The `|` cells of a table row, trimmed; null when the line is not a row. */
const cells = (t: string): string[] | null => {
  const s = t.trim()
  if (!s.startsWith('|')) return null
  return s
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())
}

interface Table {
  n: number
  header: string[]
  rows: { n: number; cells: string[] }[]
}

/** Tables (header, separator, rows) among the lines given, outside fences. */
const tablesIn = (ls: Line[]): Table[] => {
  const out: Table[] = []
  for (let i = 0; i + 1 < ls.length; i++) {
    const h = ls[i].inFence ? null : cells(ls[i].text)
    const sep = ls[i + 1].inFence ? null : cells(ls[i + 1].text)
    if (!h || !sep || !sep.every((c) => /^:?-{3,}:?$/.test(c))) continue
    const t: Table = { n: ls[i].n, header: h, rows: [] }
    let j = i + 2
    for (; j < ls.length; j++) {
      const r = ls[j].inFence ? null : cells(ls[j].text)
      if (!r) break
      t.rows.push({ n: ls[j].n, cells: r })
    }
    out.push(t)
    i = j - 1
  }
  return out
}

const headerIs = (t: Table, want: string[]): boolean =>
  t.header.length === want.length && t.header.every((c, i) => c.toLowerCase().replace(/\s+/g, ' ') === want[i].toLowerCase())

export const TIERS_COLUMNS = ['Tier', 'Exit criterion', 'Demo or test']
export const LANES_COLUMNS = ['Lane', 'Owner', 'Steps']
export const STACK_COLUMNS = ['PR n of N', 'Step', 'Tier', 'Base', 'Can start after']
export const ASKS_COLUMNS = ['Ask', 'Id', 'Blocks (step, tier)', 'Fallback meanwhile']
export const DECISIONS_COLUMNS = ['Decision', 'Who', 'When', 'Why']
/** A role where a decisions register's Who cell should name a person. */
export const ROLE_CREDIT = /\b(?:the user|(?:the )?product owner|the owner)\b/i

// Name the person, never the role (docs/plans/CLAUDE.md, "Collaborative plan branches"), beyond the Who cell:
// phrases that credit a decision, ask, review or word to a role, in a living plan's text and in a dated
// companion from ROLE_CHECK_START on. "The owner" (of an agent, a room, a VTA) and "the user" (of the app)
// are ordinary product words, so only crediting phrases are flagged, never the words alone. Text inside
// backticks or double quotes is not read: that is how a line names the phrase rather than uses it.

/** Dated companions are point-in-time records, never edited; only those dated from this day on are checked for role credits. */
export const ROLE_CHECK_START = '2026-11-26'

/**
 * Living plans that predate the role-credit check and still credit a role; listed so the check can ship
 * without editing other people's plans. Paths are relative to the repository root. Remove an entry once
 * that plan names people.
 */
export const ROLE_CREDIT_ALLOW = new Set<string>([
  // Alberto's plan ("Reviewers: the product owner ...", the Product owner rows of its tables), written before this check.
  'docs/plans/single-codebase-plan.md',
  // Alberto's plan ("The product owner" in its header, review notes and tables), written before this check.
  'docs/plans/data-rooms-performance-plan.md',
])

export const ROLE_HINT = 'name the person, e.g. Brendan or Alberto; see docs/plans/CLAUDE.md, Collaborative plan branches'

/** Phrases that credit something to a role, read on a line with code spans and double-quoted strings removed. */
export const ROLE_PHRASES: RegExp[] = [
  /\b(?:the )?product owner\b/gi,
  // "Confirmed by the user", "approved by the user" and "the user's decision" are also app behaviour (the app's
  // user confirms a name, approves a request), so those are flagged only in their "with the user" form.
  /\b(?:decided|asked|suggested|approved|reviewed|confirmed|chose|said|agreed) with the (?:user|owner)\b/gi,
  /\b(?:decided|asked|suggested|reviewed|chose|said|agreed) by the (?:user|owner)\b/gi,
  /\bthe (?:user|owner)'s (?:word|ask|instruction|yes|go-ahead|sign-off)\b/gi,
  /\(the user[,)]/gi,
]

/** Column headers whose cells credit a person; a cell there that is exactly a role is flagged. */
const CREDIT_COLUMN = /^(?:who|owner|decided by|by)$/i
const ROLE_CELL = /^(?:the user|(?:the )?product owner|the owner)(?:\s*\([^)]*\))?$/i

const unquoted = (s: string): string => withoutCode(s).replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, (q) => ' '.repeat(q.length))

/** Whether role credits are checked in this file. `file` is relative to the repository root. */
export const roleCreditsChecked = (file: string, kind: Kind): boolean => {
  if (kind === 'skip' || ROLE_CREDIT_ALLOW.has(file)) return false
  const dated = DATED.exec(path.basename(file))
  return kind === 'plan' ? !dated : !!dated && dated[1] >= ROLE_CHECK_START
}

const checkRoleCredits = (lines: Line[], problem: (n: number, m: string) => void): void => {
  const hits = new Map<number, string[]>()
  const hit = (n: number, phrase: string): void => {
    const h = hits.get(n) ?? []
    if (!h.includes(phrase)) h.push(phrase)
    hits.set(n, h)
  }
  for (const l of lines) {
    if (l.inFence) continue
    const t = unquoted(l.text)
    for (const re of ROLE_PHRASES) for (const m of t.matchAll(re)) hit(l.n, m[0])
  }
  for (const t of tablesIn(lines)) {
    const cols = t.header.map((c, i) => (CREDIT_COLUMN.test(c.replace(/[*_]/g, '').trim()) ? i : -1)).filter((i) => i >= 0)
    for (const r of t.rows) {
      for (const i of cols) {
        const v = (r.cells[i] ?? '').replace(/[*_]/g, '').trim()
        if (ROLE_CELL.test(v)) hit(r.n, v)
      }
    }
  }
  for (const [n, phrases] of hits) problem(n, `${phrases.map((p) => `"${p}"`).join(', ')} credits a role: ${ROLE_HINT}`)
}

/** The lines of a `##` section: after its heading, up to the next `##`. */
const sectionLines = (lines: Line[], h2: Heading[], at: Heading): Line[] => {
  const next = h2.find((h) => h.n > at.n)
  return lines.filter((l) => l.n > at.n && (!next || l.n < next.n))
}

const checkTiers = (
  lines: Line[],
  hs: Heading[],
  exists: (p: string) => boolean,
  read: (p: string) => string,
  problem: (n: number, m: string) => void,
): void => {
  const h2 = hs.filter((h) => h.level === 2)
  const missing = (what: string, n: number, how: string): void => problem(n, `${what}: ${how}`)

  // The Overview carries a decisions register beside the open decisions.
  const overview = h2.find((h) => h.title === 'Overview')
  if (overview) {
    const ov = sectionLines(lines, h2, overview)
    const at = ov.findIndex((l) => !l.inFence && /^\*\*Decisions made\*\*\s*$/.test(l.text.trim()))
    if (at === -1) missing('Overview', overview.n, 'add `**Decisions made**` with the table `| Decision | Who | When | Why |` beside the open decisions (one row "None yet" is fine)')
    else {
      const t = tablesIn(ov.slice(at))[0]
      if (!t || !headerIs(t, DECISIONS_COLUMNS)) missing('Decisions made', ov[at].n, 'the table is `| Decision | Who | When | Why |`')
      else {
        // Name the person, never the role ("Collaborative plan branches"): only the Who cell is read.
        for (const r of t.rows) {
          const role = (r.cells[1] ?? '').match(ROLE_CREDIT)
          if (role) problem(r.n, `Decisions made: the Who cell says "${role[0]}"; name the person who decided, never the role: ${ROLE_HINT}`)
        }
      }
    }
  }

  // §7: tiers, lanes, graph, stack table, and the steps.
  const steps = h2.find((h) => /^7\.\s+Steps\b/.test(h.title))
  if (!steps) problem(1, 'no `## 7. Steps and acceptance criteria` section')
  else {
    const body = sectionLines(lines, h2, steps)
    const h3 = hs.filter((h) => h.level === 3 && body.some((l) => l.n === h.n))
    const zero = h3.find((h) => /^7\.0\b/.test(h.title))
    const stepHeads = h3.filter((h) => h !== zero)
    const stepTier = new Map<string, string>() // "7.2" -> "P1"
    if (!zero || !/^7\.0\s+Tiers, lanes and order\b/.test(zero.title)) {
      problem(h3[0]?.n ?? steps.n, '§7 must open with `### 7.0 Tiers, lanes and order`')
    }
    for (const h of stepHeads) {
      const m = TIER.exec(h.title)
      if (!m) problem(h.n, `step "### ${h.title}" must end with its tier: \`(P0)\`, \`(P1)\` or \`(P2)\``)
      else if (h.number) stepTier.set(h.number, m[1])
      const end = h3.find((x) => x.n > h.n)?.n ?? Infinity
      const sec = body.filter((l) => l.n > h.n && l.n < end && !l.inFence)
      if (!sec.some((l) => /^\s*[-*]?\s*\*\*Owner:\*\*\s*\S/.test(l.text))) problem(h.n, `step "### ${h.title}" names no owner: add a line \`**Owner:** <name or role>\``)
      const own = sec.map((l) => l.text).join('\n')
      if (own.match(VTI_ID) && !sec.some((l) => /^\s*[-*]?\s*\*\*Fallback:\*\*\s*\S/.test(l.text))) {
        problem(h.n, `step "### ${h.title}" depends on an upstream ask (${[...new Set(own.match(VTI_ID))].join(', ')}) and has no \`**Fallback:**\` that works in the same tier without it`)
      }
    }
    if (zero) {
      const end = h3.find((x) => x.n > zero.n)?.n ?? Infinity
      const z = body.filter((l) => l.n > zero.n && l.n < end)
      const tables = tablesIn(z)
      const need: [string, string[]][] = [
        ['tiers table', TIERS_COLUMNS],
        ['lanes table', LANES_COLUMNS],
      ]
      for (const [what, cols] of need) {
        if (!tables.some((t) => headerIs(t, cols))) problem(zero.n, `7.0 needs the ${what}: \`| ${cols.join(' | ')} |\``)
      }
      const tiersT = tables.find((t) => headerIs(t, TIERS_COLUMNS))
      if (tiersT) {
        const names = tiersT.rows.map((r) => r.cells[0].replace(/\W/g, ''))
        for (const t of ['P0', 'P1', 'P2']) if (!names.includes(t)) problem(tiersT.n, `the tiers table has no row for ${t}`)
        for (const r of tiersT.rows) if ((r.cells[1] ?? '') === '' || (r.cells[2] ?? '') === '') problem(r.n, 'every tier names an exit criterion and the demo or test that shows it')
      }
      const lanesT = tables.find((t) => headerIs(t, LANES_COLUMNS))
      if (lanesT) for (const r of lanesT.rows) if ((r.cells[1] ?? '') === '') problem(r.n, `lane "${r.cells[0]}" has no owner`)
      if (!z.some((l) => l.inFence && /^\s*`{3,}\s*mermaid\s*$/.test(l.text))) problem(zero.n, '7.0 needs a ```mermaid dependency graph with the critical path marked')
      const stackT = tables.find((t) => headerIs(t, STACK_COLUMNS))
      if (!stackT) problem(zero.n, `7.0 needs the stack table: \`| ${STACK_COLUMNS.join(' | ')} |\``)
      else {
        const byPr = new Map<number, { step: string; tier: string }>()
        for (const r of stackT.rows) {
          const pr = /^(\d+)\s+of\s+\d+$/.exec(r.cells[0])
          if (!pr) problem(r.n, `"${r.cells[0]}" must read \`<n> of <N>\``)
          else byPr.set(Number(pr[1]), { step: r.cells[1], tier: r.cells[2] })
          if (!/^P[012]$/.test(r.cells[2])) problem(r.n, `tier "${r.cells[2]}" must be P0, P1 or P2`)
          else if (stepTier.has(r.cells[1]) && stepTier.get(r.cells[1]) !== r.cells[2]) problem(r.n, `step ${r.cells[1]} is ${stepTier.get(r.cells[1])} in its heading but ${r.cells[2]} here`)
        }
        for (const r of stackT.rows) {
          for (const m of r.cells[4].matchAll(/\bPR\s?(\d+)/g)) {
            const dep = byPr.get(Number(m[1]))
            if (!dep) problem(r.n, `"can start after" names PR ${m[1]}, which is not in the table`)
            else if (dep.tier > r.cells[2]) problem(r.n, `step ${r.cells[1]} (${r.cells[2]}) cannot start after PR ${m[1]} (${dep.tier}): no tier depends on a later tier`)
          }
        }
        for (const [num] of stepTier) if (!stackT.rows.some((r) => r.cells[1] === num)) problem(stackT.n, `step ${num} is not in the stack table`)
      }
    }
  }

  // §10: upstream asks, and every VTI id registered.
  const asks = h2.find((h) => /^\d+\.\s+Upstream asks and blocked on whom\b/.test(h.title))
  if (!asks) problem(h2[h2.length - 1]?.n ?? 1, 'the upstream section is titled `## N. Upstream asks and blocked on whom`')
  else {
    const t = tablesIn(sectionLines(lines, h2, asks)).find((x) => headerIs(x, ASKS_COLUMNS))
    if (!t) problem(asks.n, `the upstream section needs the table \`| ${ASKS_COLUMNS.join(' | ')} |\` (an ask is recorded, not filed: no link, status or response columns)`)
    else {
      for (const r of t.rows) {
        if (!/^VTI-(Q\d+|\d{2})$/.test(r.cells[1])) problem(r.n, `ask id "${r.cells[1]}" must be a VTI-Qn or VTI-NN registered in ${FINDINGS_FILE}`)
        if (!/\bP[012]\b/.test(r.cells[2])) problem(r.n, 'say which step and tier the ask blocks, e.g. "7.3, P1"')
        if ((r.cells[3] ?? '') === '') problem(r.n, 'every ask has a fallback that works meanwhile')
      }
      if (steps) {
        const inSteps = new Set(sectionLines(lines, h2, steps).filter((l) => !l.inFence).flatMap((l) => l.text.match(VTI_ID) ?? []))
        const listed = new Set(t.rows.map((r) => r.cells[1]))
        for (const id of inSteps) if (!listed.has(id)) problem(t.n, `${id} is named in §7 but is not in the asks table`)
      }
    }
  }

  // Every id the plan names is registered upstream-findings-side.
  const ids = new Map<string, number>()
  for (const l of lines) if (!l.inFence) for (const m of l.text.matchAll(VTI_ID)) if (!ids.has(m[0])) ids.set(m[0], l.n)
  if (ids.size > 0) {
    if (!exists(FINDINGS_FILE)) problem([...ids.values()][0], `${FINDINGS_FILE} not found, so the plan's VTI ids cannot be checked`)
    else {
      const findings = read(FINDINGS_FILE)
      for (const [id, n] of ids) if (!new RegExp(`\\b${id}\\b`).test(findings)) problem(n, `${id} is not registered in ${FINDINGS_FILE}: add it there under this plan's feature`)
    }
  }
}

/** Every problem in one file. `file` is the path used for messages and for resolving links. */
export const checkText = (
  file: string,
  kind: Kind,
  text: string,
  exists: (p: string) => boolean = fs.existsSync,
  read: (p: string) => string = (p) => fs.readFileSync(p, 'utf8'),
  io: SheetIo = {},
): Problem[] => {
  if (kind === 'skip') return []
  const problems: Problem[] = []
  const problem = (line: number, message: string): void => {
    problems.push({ file, line, message })
  }
  const lines = scan(text)
  const hs = headings(lines)
  const h2 = hs.filter((h) => h.level === 2)
  if (kind === 'plan') {
    checkPlan(hs, lines, problem)
    if (h2[0]?.title === 'Overview') checkParts('plan', lines, h2, problem)
    checkSectionRefs(file, text, hs, problem)
    const firstH2 = h2[0]?.n ?? Infinity
    if (lines.some((l) => !l.inFence && l.n < firstH2 && l.text.trim() === TIERS_MARKER)) checkTiers(lines, hs, exists, read, problem)
  } else {
    if (h2.length === 0 || h2[0].title !== 'Summary') {
      problem(h2[0]?.n ?? 1, `a dated companion from ${FORMAT_START} on opens with \`## Summary\` as its first \`##\` heading`)
    } else checkParts('companion', lines, h2, problem)
    // A companion's bare `§` means its parent plan's, so it is not resolved here, only checked for ambiguity.
    checkSectionRefs(file, text, null, problem)
  }
  if (roleCreditsChecked(file, kind)) {
    // One role message per line: a tiers Who cell already flagged is not reported twice.
    const flagged = new Set(problems.filter((p) => p.message.includes(ROLE_HINT)).map((p) => p.line))
    checkRoleCredits(lines, (n, m) => {
      if (!flagged.has(n)) problem(n, m)
    })
  }
  checkMermaid(lines, problem)
  checkAssets(file, lines, exists, problem, read)
  checkSheets(file, lines, exists, problem, read, io)
  return problems.sort((a, b) => a.line - b.line)
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}

/** Check files (default: all of docs/plans/). Returns the problems and how many files were checked. */
export const run = (repoRoot: string, files: string[] = []): { problems: Problem[]; checked: string[] } => {
  const plansDir = path.join(repoRoot, 'docs', 'plans')
  const all = files.length > 0 ? files.map((f) => path.resolve(f)) : walk(plansDir).sort()
  const problems: Problem[] = []
  const checked: string[] = []
  for (const abs of all) {
    const rel = path.relative(plansDir, abs).split(path.sep).join('/')
    if (rel.startsWith('..') || !fs.existsSync(abs)) continue
    const text = fs.readFileSync(abs, 'utf8')
    const kind = classify(rel, text)
    if (kind === 'skip') continue
    checked.push(abs)
    problems.push(
      ...checkText(
        path.relative(repoRoot, abs),
        kind,
        text,
        (p) => fs.existsSync(path.resolve(repoRoot, p)),
        (p) => fs.readFileSync(path.resolve(repoRoot, p), 'utf8'),
        { list: (p) => defaultList(path.resolve(repoRoot, p)), hash: (p) => sha256(fs.readFileSync(path.resolve(repoRoot, p))) },
      ),
    )
  }
  return { problems, checked }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const { problems, checked } = run(repoRoot, process.argv.slice(2))
  for (const p of problems) {
    console.log(`${p.file}:${p.line}: ${p.message}`)
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error file=${p.file},line=${p.line}::${p.message}`)
  }
  console.log(`${checked.length} plan file(s) in the two-part format checked, ${problems.length} problem(s)`)
  process.exit(problems.length > 0 ? 1 : 0)
}
