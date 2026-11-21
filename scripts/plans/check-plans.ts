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
  } else {
    if (h2.length === 0 || h2[0].title !== 'Summary') {
      problem(h2[0]?.n ?? 1, `a dated companion from ${FORMAT_START} on opens with \`## Summary\` as its first \`##\` heading`)
    } else checkParts('companion', lines, h2, problem)
    // A companion's bare `§` means its parent plan's, so it is not resolved here, only checked for ambiguity.
    checkSectionRefs(file, text, null, problem)
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
