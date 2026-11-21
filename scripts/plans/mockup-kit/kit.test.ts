// Tests for kit.ts. Run: node --experimental-strip-types --test scripts/plans/mockup-kit/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ASSUMED, CHROME_MARK, esc, H, KIT_MARK, OMITS_MARK, NOTE_SIZE, NOTE_W, NOTE_X, pngSize, previewHtml, render, sha256, SHEET_COLUMNS, SHEET_FILE, SHEET_LAYOUT, sheetCommand, sheetManifest, sheetSize, svgTitle, SYSTEM_WIDTH, textWidth, W, wrap, writeMockups } from './kit.ts'
import { fingerprint, tok } from './tokens.ts'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')

/** Omit every piece of chrome, for tests about something else. */
const NONE = { title: 'not this test’s subject.', tabBar: 'not this test’s subject.', primary: 'not this test’s subject.' }

const sample = render({
  file: '01-x.svg',
  title: 'X: a state (x-plan §4)',
  omits: { tabBar: 'it is outside the tabs.' },
  draw: (s) => {
    s.header('A title')
    const y = s.heading('Pick one <now>', 150)
    s.primaryButton('Keep going', y + 20)
    s.secondaryButton('Stop', y + 90)
    s.tertiaryButton('Use a QR code instead', 700)
  },
  notes: ['An annotation.'],
})

test('a mockup records its title, theme, components, tokens and the token fingerprint', () => {
  assert.match(sample, /<title>X: a state \(x-plan §4\)<\/title>/)
  assert.match(sample, /<desc>Keyring plan mockup, theme light\. Components: Header \(GradientHeaderBackground, HeaderTitle\); ThemedText headingThree; Button \(ButtonType\.Primary\); Button \(ButtonType\.Secondary\); Button \(ButtonType\.Tertiary\)\./)
  assert.match(sample, /Tokens: [^<]*button\.primary\.fill/)
  assert.ok(sample.includes(`<!-- ${KIT_MARK}${fingerprint()} `))
})

test('fragments use the theme values', () => {
  assert.ok(sample.includes(`fill="${tok('button.primary.fill')}"`))
  assert.ok(sample.includes(`stop-color="${tok('header.gradient.0')}"`))
  assert.ok(sample.includes(`height="48" rx="10"`)) // primary: 12 + 24 + 12
  assert.ok(sample.includes(`stroke="${tok('button.secondary.borderColor')}" stroke-width="2"`))
  assert.ok(sample.includes(`fill="${tok('color.background')}"`))
})

test('copy is escaped and appears verbatim; the SVG is self-contained', () => {
  assert.ok(sample.includes('Pick one &lt;now&gt;'))
  assert.ok(sample.includes('>Use a QR code instead<'))
  assert.doesNotMatch(sample, /<script|<image|href=|@import|url\(http/)
  assert.equal(esc(`a & "b"`), 'a &amp; &quot;b&quot;')
})

test('wrap keeps words whole and within the width', () => {
  const lines = wrap('Which code is on their phone?', 200, 26, true)
  assert.ok(lines.length > 1)
  assert.equal(lines.join(' '), 'Which code is on their phone?')
  assert.deepEqual(wrap('short', 300, 18), ['short'])
  // a word too long for the column breaks at its camel-case humps rather than overflowing
  const humps = wrap('· (GradientHeaderBackground, HeaderTitle)', 120, 13, false, 'system')
  assert.ok(humps.length > 2 && humps.every((l) => textWidth(l, 13, false, 'system') <= 120), JSON.stringify(humps))
  assert.equal(humps.join('').replace(/ /g, ''), '·(GradientHeaderBackground,HeaderTitle)')
})

test('a bottom sheet dims the screen and carries its own content', () => {
  const svg = render({ file: '02-y.svg', title: 'Y', omits: { title: 'x', tabBar: 'x' }, draw: (s) => s.bottomSheet((sheet, y) => sheet.primaryButton('Go', y)) })
  assert.ok(svg.includes(`fill="${tok('sheet.backdrop')}"`))
  assert.match(svg, /Bottom sheet \(DeleteChatSheet, SafeAreaModal\); Button \(ButtonType\.Primary\)/)
})

test('writeMockups enforces the file name and writes each file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-kit-'))
  try {
    assert.throws(() => writeMockups(dir, [{ file: 'Bad Name.svg', title: 't', draw: () => {} }]), /NN-<screen>/)
    assert.throws(() => writeMockups(dir, [{ file: '01-a.svg', title: 't', draw: (s) => s.header() }]), /draws no header title/)
    const out = writeMockups(dir, [{ file: '01-a.svg', title: 't', omits: NONE, draw: (s) => s.header() }])
    assert.equal(path.basename(out[0]), '01-a.svg')
    assert.match(fs.readFileSync(out[0], 'utf8'), /^<svg /)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('previewHtml lays SVGs out side by side with the app font, captioned with file name and title', () => {
  const html = previewHtml([{ name: '01-a.svg', svg: '<svg><title>A: one &amp; two</title></svg>' }], '/fonts', 3)
  assert.match(html, /repeat\(3,640px\)/)
  assert.match(html, /SourceSans3-Regular\.ttf/)
  assert.match(html, /<figcaption><b>01-a\.svg<\/b><br>A: one &amp; two<\/figcaption>/)
  assert.equal(svgTitle('<svg><title>x &lt;y&gt;</title></svg>'), 'x <y>')
  assert.equal(svgTitle('<svg/>'), '')
})

test('the contact sheet is about 2000 px wide and sized from its screens', () => {
  const s = sheetSize(7, SHEET_COLUMNS)
  assert.equal(s.width, 2 * 16 + 3 * W + 2 * 8)
  assert.ok(s.width >= 1800 && s.width <= 2100, `${s.width} px wide`)
  assert.equal(s.height, 2 * 16 + 3 * (H + 36) + 2 * 8)
  // Fewer screens than columns: the sheet is only as wide as they are.
  assert.equal(sheetSize(2, 3).width, 2 * 16 + 2 * W + 8)
  assert.equal(sheetSize(1, 3).height, 2 * 16 + H + 36)
})

test('the sheet manifest records the SVG hashes, the token fingerprint, the layout and the PNG hash', () => {
  const m = sheetManifest('docs/plans/x-plan/mockups', { '02-b.svg': '<svg>b</svg>', '01-a.svg': Buffer.from('<svg>a</svg>') }, 'f'.repeat(64), 3)
  assert.deepEqual(Object.keys(m.svgs), ['01-a.svg', '02-b.svg'])
  assert.equal(m.svgs['01-a.svg'], sha256('<svg>a</svg>'))
  assert.equal(sha256(Buffer.from('<svg>é</svg>')), sha256('<svg>é</svg>')) // a string and its UTF-8 bytes hash alike
  assert.equal(m.tokens, fingerprint())
  assert.equal(m.layout, SHEET_LAYOUT)
  assert.deepEqual(m.sheet, { file: SHEET_FILE, sha256: 'f'.repeat(64) })
  assert.equal(m.regenerate, sheetCommand('docs/plans/x-plan/mockups'))
  assert.match(m.regenerate, /kit\.ts sheet docs\/plans\/x-plan\/mockups$/)
  assert.deepEqual([m.width, m.height], [sheetSize(2, 3).width, sheetSize(2, 3).height])
})

test('pngSize reads the IHDR size', () => {
  const png = Buffer.alloc(24)
  png.write('\x89PNG\r\n\x1a\n', 0, 'latin1')
  png.writeUInt32BE(1968, 16)
  png.writeUInt32BE(2616, 20)
  assert.deepEqual(pngSize(png), { width: 1968, height: 2616 })
  assert.throws(() => pngSize(Buffer.from('<svg/>')), /not a PNG/)
})

test('every committed sheet manifest matches its folder', () => {
  const plans = path.join(root, 'docs', 'plans')
  for (const f of fs.readdirSync(plans, { recursive: true, encoding: 'utf8' }).filter((f) => /(^|\/)mockups\/sheet\.manifest\.json$/.test(f))) {
    const dir = path.dirname(path.join(plans, f))
    const m = JSON.parse(fs.readFileSync(path.join(plans, f), 'utf8'))
    assert.deepEqual(pngSize(fs.readFileSync(path.join(dir, SHEET_FILE))), { width: m.width, height: m.height }, f)
  }
})

/** The notes-column text blocks of an SVG: each block's first y and its lines, entities decoded. */
const noteBlocks = (svg: string): { y: number; lines: string[] }[] =>
  [...svg.matchAll(new RegExp(`<text font-family="[^"]*" font-size="${NOTE_SIZE}"[^>]*>(.*?)</text>`, 'g'))].map((m) => ({
    y: Number(/y="(\d+(?:\.\d+)?)"/.exec(m[1])?.[1]),
    lines: [...m[1].matchAll(new RegExp(`<tspan x="${NOTE_X}"[^>]*>(.*?)</tspan>`, 'g'))].map((t) =>
      t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    ),
  }))

const assertNotesFit = (svg: string, name: string): void => {
  const blocks = noteBlocks(svg)
  assert.equal(blocks.length, 2, `${name}: a notes block and a legend block`)
  for (const b of blocks) {
    for (const l of b.lines) {
      const w = textWidth(l, NOTE_SIZE, false, 'system')
      assert.ok(w <= NOTE_W, `${name}: "${l}" is ${w.toFixed(0)} px wide in a ${NOTE_W} px column`)
    }
  }
  const [notes, legend] = blocks
  assert.ok(notes.y + (notes.lines.length - 1) * 18 < legend.y - 12, `${name}: the notes run into the legend`)
}

test('no note or legend line exceeds the notes column, measured as the widest system font', () => {
  assert.ok(NOTE_X + NOTE_W <= 640)
  // the note that clipped at 'the plan names the prompt anc' when notes were measured as Source Sans
  const long = 'Drawn as a bottom sheet, a mockup choice: the plan names the prompt and its two buttons only.'
  const svg = render({ file: '03-z.svg', title: 'Z', omits: { title: 'x', tabBar: 'x' }, draw: (s) => s.bottomSheet((sheet, y) => sheet.primaryButton('Go', y)), notes: [long, 'Supercalifragilistic expialidocious words.'] })
  assertNotesFit(svg, 'sample')
  assert.ok(noteBlocks(svg)[0].lines.join(' ').includes('the plan names the prompt and its two buttons only.'))
  // the bound is conservative: the system measure is the Source Sans one scaled up
  assert.equal(textWidth(long, 13, false, 'system'), textWidth(long, 13) * SYSTEM_WIDTH)
})

test('every committed mockup keeps its notes inside the column', () => {
  const plans = path.join(root, 'docs', 'plans')
  const svgs = fs
    .readdirSync(plans, { recursive: true, encoding: 'utf8' })
    .filter((f) => /(^|\/)mockups\/\d{2}-[^/]+\.svg$/.test(f))
  for (const f of svgs) {
    const svg = fs.readFileSync(path.join(plans, f), 'utf8')
    if (svg.includes(KIT_MARK)) assertNotesFit(svg, f)
  }
})

test('the tab bar, InfoBox error and contact card draw the app\'s chrome', () => {
  const svg = render({
    file: '04-w.svg',
    title: 'W',
    omits: { primary: 'x' },
    draw: (s) => {
      s.header(undefined, { placeholder: '<contact name>', kebab: true })
      s.cardRow('Alice', 140)
      s.errorNotice('Something failed.', 220, 'A longer body under the icon.')
      s.tabBar('contacts')
    },
  })
  assert.ok(svg.includes(`fill="${tok('tab.fill')}"`))
  for (const label of ['Contacts', 'Message', 'QR Code', 'Wallet', 'My Agent', 'Menu']) assert.ok(svg.includes(`>${label}<`), label)
  assert.match(svg, /font-weight="700" fill="#FFFFFF" text-anchor="middle">Contacts</)
  assert.match(svg, /fill="#FFFFFF" opacity="0\.6"/) // the home indicator turns light over the tab bar
  assert.ok(svg.includes(`fill="${tok('notice.error.icon')}"`))
  assert.ok(svg.includes('>Something failed.<') && svg.includes('A longer body'))
  // the card's shadow is a separate blurred rect, offset and as opaque as the tokens say
  assert.match(svg, /<rect x="34" y="144" width="332" height="62" rx="12" fill="#000000" fill-opacity="0\.1" filter="url\(#kr-card-shadow\)"\/>/)
  assert.match(svg, /<filter id="kr-card-shadow"[^>]*><feGaussianBlur stdDeviation="2"\/><\/filter>/)
  assert.match(svg, />&lt;contact name&gt;</)
  assert.match(svg, />9:41</)
  assert.match(svg, /Tab bar \(TabStack, TabTheme\)/)
  assert.match(svg, /InfoBox \(error\)/)
})

test('the header title is centred, white and bold in the system font, from the headerTitle tokens', () => {
  assert.match(sample, new RegExp(`font-family="system-ui, sans-serif" font-size="${tok('text.headerTitle.size')}" font-weight="700" fill="${tok('text.headerTitle.color')}" text-anchor="middle">A title<`))
  assert.match(sample, /Tokens: [^<]*text\.headerTitle\.weight/)
})

test('the primary button has its theme shadow, drawn as a separate blurred rect', () => {
  const [, y] = new RegExp(`<rect x="36" y="(\\d+)" width="\\d+" height="48" rx="10" fill="${tok('button.primary.fill')}"/>`).exec(sample) ?? []
  assert.ok(y, 'primary button')
  const shadowY = Number(y) + tok('button.primary.shadowOffsetY')
  assert.match(sample, new RegExp(`y="${shadowY}" width="\\d+" height="48" rx="10" fill="${tok('button.primary.shadowColor')}" fill-opacity="${tok('button.primary.shadowOpacity')}" filter="url\\(#kr-button-shadow\\)"`))
  assert.match(sample, new RegExp(`<filter id="kr-button-shadow"[^>]*><feGaussianBlur stdDeviation="${tok('button.primary.shadowRadius') / 2}"/></filter>`))
})

test('each piece of chrome is drawn, an assumed stand-in, or omitted with a reason', () => {
  const draw = (s: Parameters<NonNullable<Parameters<typeof render>[0]['draw']>>[0]): void => s.header('T')
  assert.throws(() => render({ file: '01-a.svg', title: 't', draw }), /draws no tab bar; .* omits\.tabBar/)
  assert.throws(() => render({ file: '01-a.svg', title: 't', omits: { ...NONE }, draw }), /draws a header title but also declares omits\.title/)
  assert.throws(() => render({ file: '01-a.svg', title: 't', omits: { tabBar: ' ', primary: 'x' }, draw }), /draws no tab bar/)
  const svg = render({ file: '01-a.svg', title: 't', omits: { tabBar: 'it is outside the tabs.', primary: 'it only waits.' }, draw })
  assert.ok(svg.includes(`<!-- ${CHROME_MARK} title=drawn tabBar=omitted primary=omitted -->`))
  assert.ok(svg.includes(`<!-- ${OMITS_MARK} tabBar: it is outside the tabs. -->`))
  assert.ok(noteBlocks(svg)[0].lines.join(' ').includes('No tab bar: it is outside the tabs.'))
  assert.ok(noteBlocks(svg)[0].lines.join(' ').includes('No primary button: it only waits.'))
})

test('an assumed stand-in is non-copy, marked on the phone, and listed in the notes', () => {
  assert.throws(() => render({ file: '01-a.svg', title: 't', omits: NONE, draw: (s) => s.header(undefined, { placeholder: 'Nearby', assumed: 'x' }) }), /<stand-in>, not copy/)
  assert.throws(() => render({ file: '01-a.svg', title: 't', draw: (s) => s.primaryButton('Go', 300, { assumed: 'x' }) }), /<stand-in>, not copy/)
  const svg = render({
    file: '01-a.svg',
    title: 't',
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: 'the title; the plan has none.' })
      s.primaryButton('<action>', 600, { assumed: 'a main action.' })
      s.tabBar('qrCode', { assumed: 'the tab.' })
    },
  })
  assert.ok(svg.includes(`<!-- ${CHROME_MARK} title=assumed tabBar=assumed primary=assumed -->`))
  assert.equal(svg.match(new RegExp(`stroke="${ASSUMED}" stroke-width="1.5" stroke-dasharray`, 'g'))?.length, 3)
  assert.equal(svg.match(/>assumed</g)?.length, 3)
  const notes = noteBlocks(svg)[0].lines.join(' ')
  for (const a of ['Assumed: the title; the plan has none.', 'Assumed: a main action.', 'Assumed: the tab.']) assert.ok(notes.includes(a), a)
  assert.ok(svg.includes('>&lt;title&gt;<') && svg.includes('>&lt;action&gt;<'))
})

test('notes that would run into the legend are refused', () => {
  assert.throws(() => render({ file: '01-a.svg', title: 't', omits: NONE, draw: () => {}, notes: Array(40).fill('A note.') }), /run into the legend/)
})

/**
 * What an SVG shown as an image (GitHub's <img>, VS Code's Markdown preview, a file viewer) may rely on: no
 * scripts, styles, CSS variables, foreignObject, external references, or filters beyond an SVG 1.1 Gaussian blur,
 * and a filter only on a shadow shape, so a viewer that drops filters loses only the shadow.
 */
export const viewerRisks = (svg: string): string[] => {
  const out: string[] = []
  for (const [re, what] of [
    [/<script|<style|<foreignObject|<image|<use\b|<a\b/, 'an element viewers drop'],
    [/var\(--|@import|@font-face|url\((?!#)/, 'CSS or an external reference'],
    [/(?:xlink:)?href=/, 'a link'],
    [/<fe(?!GaussianBlur\b)[A-Z]\w*/, 'a filter primitive other than feGaussianBlur'],
  ] as const) {
    if (re.test(svg)) out.push(what)
  }
  for (const m of svg.matchAll(/<[^>]*filter="url\(#[^)]*\)"[^>]*>/g)) if (!/fill-opacity="/.test(m[0])) out.push(`a filter on a visible shape: ${m[0].slice(0, 60)}`)
  return out
}

test('every committed mockup degrades safely in image viewers', () => {
  assert.deepEqual(viewerRisks('<svg><rect filter="url(#s)" fill="#000"/></svg>'), ['a filter on a visible shape: <rect filter="url(#s)" fill="#000"/>'])
  assert.deepEqual(viewerRisks('<svg><filter><feDropShadow/></filter></svg>'), ['a filter primitive other than feGaussianBlur'])
  assert.deepEqual(viewerRisks('<svg><text fill="var(--x)">a</text></svg>'), ['CSS or an external reference'])
  const plans = path.join(root, 'docs', 'plans')
  for (const f of fs.readdirSync(plans, { recursive: true, encoding: 'utf8' }).filter((f) => /(^|\/)mockups\/\d{2}-[^/]+\.svg$/.test(f))) {
    const svg = fs.readFileSync(path.join(plans, f), 'utf8')
    if (svg.includes(KIT_MARK)) assert.deepEqual(viewerRisks(svg), [], f)
  }
  assert.deepEqual(viewerRisks(sample), [])
})
