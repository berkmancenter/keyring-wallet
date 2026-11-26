#!/usr/bin/env node
// kit.ts — draws plan mockups from Keyring's real theme tokens and component shapes
// (docs/plans/CLAUDE.md, "Diagrams and mockups"). A plan's mockups are written by a small spec file,
// `docs/plans/<plan>/mockups/mockups.ts`, that builds each screen from these fragments and calls `writeMockups`.
//
// Each fragment is named after the component it imitates and adds that name, with the tokens it used, to the
// mockup's legend and `<desc>`. Every SVG records the token fingerprint it was drawn with; check-plans.ts flags
// one whose fingerprint is not the current one, so a theme change means regenerating the mockups.
//
//   node --experimental-strip-types docs/plans/<plan>/mockups/mockups.ts             → write the SVGs
//   node --experimental-strip-types scripts/plans/mockup-kit/kit.ts sheet docs/plans/<plan>/mockups
//        → the contact sheet: every SVG side by side with its notes, in the app's Source Sans 3, written to
//          <dir>/sheet.png with sheet.manifest.json (what it was built from); commit both (needs chromium)
//   node --experimental-strip-types scripts/plans/mockup-kit/kit.ts preview <dir> <out.png> [columns]
//        → the same render to any path, for a look before committing

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { fingerprint, THEME, tok, type TokenName } from './tokens.ts'

export const KIT_MARK = 'mockup-kit tokens:'

// Canvas: a 360×780 phone at (20, 20), and a notes column to its right.
export const W = 640
export const H = 820
const PX = 20
const PY = 20
const PW = 360
const PH = 780
export const CONTENT_X = PX + (tok('space.md') as number)
export const CONTENT_W = PW - 2 * (tok('space.md') as number)
/** Status bar (44) plus a 56 navigation header: where screen content starts. */
export const HEADER_BOTTOM = PY + 44 + 56
/** Top of the tab bar (55, TabTheme) above the 34 home-indicator inset; a screen with `tabBar` ends content here. */
export const TAB_TOP = PY + PH - 34 - 55
/** The notes column beside the phone, and the size its notes and legend are set in (system-ui). */
export const NOTE_X = 404
export const NOTE_W = W - NOTE_X - 12
export const NOTE_SIZE = 13
/** Baseline of the first note line. */
const NOTES_Y = 56
const NOTE = '#8A8A8A' // annotation colour: outside the phone, not a theme token
/** The colour of an "assumed" marker: an annotation drawn on the phone, deliberately not a theme colour. */
export const ASSUMED = '#C25E00'

/** The app chrome every mockup either draws or declares it omits (docs/plans/CLAUDE.md, "Diagrams and mockups"). */
export const CHROME = ['title', 'tabBar', 'primary'] as const
export type Chrome = (typeof CHROME)[number]
/** drawn: from the plan or the code; assumed: a marked stand-in the plan does not define; omitted: declared in `omits`. */
export type ChromeState = 'drawn' | 'assumed' | 'omitted'
const CHROME_WORDS: Record<Chrome, string> = { title: 'header title', tabBar: 'tab bar', primary: 'primary button' }

const FONT = `'Source Sans 3', '${tok('font.family')}', system-ui, sans-serif`
const SYSTEM_FONT = 'system-ui, sans-serif'

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * How much wider than Source Sans 3 the system font may be. Notes and the legend are set in `system-ui`, which is
 * whatever the viewer's machine has: measured in Chromium at 13 px against `textWidth`, Noto Sans (Linux system-ui)
 * ran up to 1.19× and DejaVu Sans 1.26× (Arial/Liberation 1.15×). 1.3 covers all of them, so a note never clips.
 */
export const SYSTEM_WIDTH = 1.3

/**
 * Width of a string at `size` px. `app` is Source Sans 3, the phone's font: within 4% of the real font's advance
 * widths (measured in Chromium), enough to wrap copy the way a phone would. `system` is a conservative bound for
 * `system-ui` (SYSTEM_WIDTH), for text that must never overflow its column.
 */
export const textWidth = (s: string, size: number, bold = false, font: 'app' | 'system' = 'app'): number => {
  let w = 0
  for (const ch of s) {
    if (/\p{Extended_Pictographic}/u.test(ch)) w += 1.15
    else if (/[‍️]/.test(ch)) continue
    else if (/[ il.,'’|!:;]/.test(ch)) w += 0.26
    else if (/[mwMW]/.test(ch)) w += 0.78
    else if (/[A-Z0-9]/.test(ch)) w += 0.58
    else w += 0.49
  }
  return w * size * (bold ? 1.05 : 1) * (font === 'system' ? SYSTEM_WIDTH : 1)
}

/** Greedy word wrap to `max` px; a word too wide for `max` on its own breaks at its camel-case humps. */
export const wrap = (s: string, max: number, size: number, bold = false, font: 'app' | 'system' = 'app'): string[] => {
  const out: string[] = []
  let line = ''
  const fits = (w: string): boolean => textWidth(w, size, bold, font) <= max
  const words = s.split(/\s+/).flatMap((w) => {
    if (fits(w)) return [w]
    const pieces: string[] = []
    for (const hump of w.split(/(?=[A-Z])/)) {
      const last = pieces.at(-1)
      if (last !== undefined && fits(last + hump)) pieces[pieces.length - 1] = last + hump
      else pieces.push(hump)
    }
    return pieces // each is as long as fits, so consecutive pieces always fall on separate lines
  })
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, size, bold, font) > max) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  return out
}

/** One screen being drawn: its fragments, and the components and tokens they used. */
export class Screen {
  readonly parts: string[] = []
  readonly components = new Set<string>()
  readonly tokens = new Set<TokenName>()
  /** Which chrome this screen drew, and how. */
  readonly chrome: Partial<Record<Chrome, 'drawn' | 'assumed'>> = {}
  /** Why each assumed stand-in is there; listed in the notes. */
  readonly assumptions: string[] = []

  private mark(part: Chrome, assumed: string | undefined): void {
    if (assumed) {
      this.chrome[part] = 'assumed'
      this.assumptions.push(assumed)
    } else if (this.chrome[part] !== 'assumed') this.chrome[part] = 'drawn'
  }

  /**
   * The "assumed" marker: a dashed outline round a stand-in and a small tag at (tagX, tagY). It is an annotation
   * in a colour the app never uses, so it cannot be mistaken for the screen.
   */
  private assumedMark(x: number, y: number, w: number, h: number, tagX: number, tagY: number): void {
    const label = 'assumed'
    const tw = textWidth(label, 10, true, 'system') + 10
    this.parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="${ASSUMED}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
      `<rect x="${tagX}" y="${tagY}" width="${tw}" height="15" rx="7.5" fill="${ASSUMED}"/>`,
      `<text x="${tagX + tw / 2}" y="${tagY + 11}" font-family="${SYSTEM_FONT}" font-size="10" font-weight="700" fill="#FFFFFF" text-anchor="middle">${label}</text>`,
    )
  }

  private use(component: string, ...tokens: TokenName[]): void {
    this.components.add(component)
    for (const t of tokens) this.tokens.add(t)
  }

  private t(name: TokenName): string | number {
    this.tokens.add(name)
    return tok(name)
  }

  /** Text at (x, y) wrapped to `width`; returns the y below it. */
  text(
    s: string,
    y: number,
    o: { size?: number; bold?: boolean; color?: string; x?: number; width?: number; anchor?: 'start' | 'middle'; lineHeight?: number; family?: string } = {},
  ): number {
    const size = o.size ?? (this.t('text.normal.size') as number)
    const x = o.x ?? CONTENT_X
    const width = o.width ?? CONTENT_W
    const lh = o.lineHeight ?? Math.round(size * 1.3)
    const lines = wrap(s, width, size, o.bold)
    const ax = o.anchor === 'middle' ? x + width / 2 : x
    const attrs = `font-size="${size}"${o.bold ? ' font-weight="700"' : ''} fill="${o.color ?? this.t('text.color')}"${o.anchor === 'middle' ? ' text-anchor="middle"' : ''}${o.family ? ` font-family="${o.family}"` : ''}`
    this.parts.push(
      `<text ${attrs}>${lines.map((l, i) => `<tspan x="${ax}" ${i === 0 ? `y="${y + size}"` : `dy="${lh}"`}>${esc(l)}</tspan>`).join('')}</text>`,
    )
    return y + size + (lines.length - 1) * lh + (lh - size)
  }

  /** ThemedText headingThree (26 bold). */
  heading(s: string, y: number): number {
    this.use('ThemedText headingThree', 'text.headingThree.size')
    return this.text(s, y, { size: tok('text.headingThree.size') as number, bold: true, lineHeight: 32 })
  }

  /** ThemedText normal (18). */
  body(s: string, y: number, color?: string): number {
    this.use('ThemedText normal', 'text.normal.size', 'text.color')
    return this.text(s, y, { color, lineHeight: 24 })
  }

  /** ThemedText labelSubtitle (14), muted. */
  label(s: string, y: number): number {
    this.use('ThemedText labelSubtitle', 'text.labelSubtitle.size', 'color.mediumGrey')
    return this.text(s, y, { size: tok('text.labelSubtitle.size') as number, color: tok('color.mediumGrey') as string })
  }

  /** A large number, ThemedText headingOne (38 bold), e.g. a confirmation code. */
  display(s: string, y: number): number {
    this.use('ThemedText headingOne', 'text.headingOne.size', 'color.text')
    return this.text(s, y, { size: tok('text.headingOne.size') as number, bold: true, color: tok('color.text') as string, anchor: 'middle', lineHeight: 46 })
  }

  private button(kind: 'primary' | 'secondary' | 'tertiary', label: string, y: number, x = CONTENT_X, w = CONTENT_W, assumed?: string): number {
    const lh = this.t('button.text.lineHeight') as number
    const size = this.t('text.normal.size') as number
    let h: number
    let fg: string
    if (kind === 'primary') {
      this.use('Button (ButtonType.Primary)', 'button.primary.fill', 'button.primary.radius', 'button.primary.paddingVertical', 'button.primary.text', 'button.primary.textWeight', 'button.primary.shadowColor', 'button.primary.shadowOffsetY', 'button.primary.shadowOpacity', 'button.primary.shadowRadius')
      this.mark('primary', assumed)
      h = 2 * (tok('button.primary.paddingVertical') as number) + lh
      fg = tok('button.primary.text') as string
      // The shadow is its own blurred rect, so a viewer without filters loses only the shadow, never the button.
      this.parts.push(
        `<rect x="${x}" y="${y + (tok('button.primary.shadowOffsetY') as number)}" width="${w}" height="${h}" rx="${tok('button.primary.radius')}" fill="${tok('button.primary.shadowColor')}" fill-opacity="${tok('button.primary.shadowOpacity')}" filter="url(#kr-button-shadow)"/>`,
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${tok('button.primary.radius')}" fill="${tok('button.primary.fill')}"/>`,
      )
      if (assumed) this.assumedMark(x - 3, y - 3, w + 6, h + 6, x + w - 62, y - 10)
    } else if (kind === 'secondary') {
      this.use('Button (ButtonType.Secondary)', 'button.secondary.padding', 'button.secondary.border', 'button.secondary.radius', 'button.secondary.borderColor', 'button.secondary.text')
      const b = tok('button.secondary.border') as number
      h = 2 * (tok('button.secondary.padding') as number) + lh + 2 * b
      fg = tok('button.secondary.text') as string
      this.parts.push(
        `<rect x="${x + b / 2}" y="${y + b / 2}" width="${w - b}" height="${h - b}" rx="${tok('button.secondary.radius')}" fill="none" stroke="${tok('button.secondary.borderColor')}" stroke-width="${b}"/>`,
      )
    } else {
      this.use('Button (ButtonType.Tertiary)', 'button.tertiary.padding', 'color.primary')
      h = 2 * (tok('button.tertiary.padding') as number) + lh
      fg = tok('color.primary') as string
    }
    this.parts.push(
      `<text x="${x + w / 2}" y="${y + h / 2 + size * 0.35}" font-size="${size}" font-weight="700" fill="${fg}" text-anchor="middle">${esc(label)}</text>`,
    )
    return y + h
  }

  /**
   * Button (ButtonType.Primary): the filled purple button with its shadow. Pass `assumed` (why) when the plan
   * defines no label for the screen's main action: draw `label` as a non-copy stand-in such as `<action>`, and the
   * button gets the "assumed" marker and a note.
   */
  primaryButton(label: string, y: number, o: { assumed?: string } = {}): number {
    if (o.assumed && !/^<[^<>]+>$/.test(label)) throw new Error(`an assumed primary button's label must be a <stand-in>, not copy: ${label}`)
    return this.button('primary', label, y, CONTENT_X, CONTENT_W, o.assumed)
  }

  secondaryButton(label: string, y: number): number {
    return this.button('secondary', label, y)
  }

  tertiaryButton(label: string, y: number): number {
    return this.button('tertiary', label, y)
  }

  /**
   * A ContactCard-shaped row: card with its drop shadow, a 36 circle holding `badge` (or the account-outline
   * person icon the card shows when there is no photo), the name, and an optional trailing mark.
   */
  cardRow(name: string, y: number, o: { badge?: string; trailing?: 'signal' | 'chevron'; outline?: string } = {}): number {
    this.use('ContactCard (row shape)', 'card.fill', 'card.border', 'card.avatar', 'card.name', 'card.height', 'card.radius', 'card.shadowOffsetY', 'card.shadowOpacity', 'card.shadowRadius')
    const h = tok('card.height') as number
    const x = PX + 14
    const w = PW - 28
    const cx = x + 14 + 18
    const cy = y + h / 2
    this.parts.push(
      `<rect x="${x}" y="${y + (tok('card.shadowOffsetY') as number)}" width="${w}" height="${h}" rx="${tok('card.radius')}" fill="#000000" fill-opacity="${tok('card.shadowOpacity')}" filter="url(#kr-card-shadow)"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${tok('card.radius')}" fill="${tok('card.fill')}" stroke="${o.outline ?? tok('card.border')}" stroke-width="${o.outline ? 2 : 1}"/>`,
      `<circle cx="${cx}" cy="${cy}" r="18" fill="${tok('card.avatar')}"/>`,
    )
    if (o.badge) this.parts.push(`<text x="${cx}" y="${cy + 6}" font-size="16" text-anchor="middle">${esc(o.badge)}</text>`)
    else {
      this.parts.push(
        `<g fill="none" stroke="${this.t('card.avatarIcon')}" stroke-width="1.6"><circle cx="${cx}" cy="${cy - 4}" r="4"/><path d="M${cx - 7} ${cy + 8} a7 6 0 0 1 14 0"/></g>`,
      )
    }
    this.parts.push(`<text x="${x + 62}" y="${cy + 6}" font-size="16" fill="${tok('card.name')}">${esc(name)}</text>`)
    if (o.trailing === 'signal') {
      this.parts.push(
        `<g fill="${tok('color.secondary')}">${[0, 1, 2, 3].map((i) => `<rect x="${x + w - 40 + i * 7}" y="${cy + 8 - (i + 1) * 4}" width="4" height="${(i + 1) * 4}" rx="1"/>`).join('')}</g>`,
      )
      this.tokens.add('color.secondary')
    } else if (o.trailing === 'chevron') {
      this.parts.push(`<path d="M${x + w - 24} ${cy - 6} l6 6 l-6 6" fill="none" stroke="${tok('color.mediumGrey')}" stroke-width="2"/>`)
    }
    return y + h
  }

  /** A RelationshipLayers day row: a bold title over a muted line (optional), min height 44. */
  layerRow(title: string, y: number, o: { muted?: string; outline?: string } = {}): number {
    this.use('RelationshipLayers (day row)', 'layer.minHeight', 'layer.paddingVertical', 'text.normal.size', 'color.mediumGrey')
    const pad = tok('layer.paddingVertical') as number
    const start = y
    let yy = this.text(title, y + pad, { bold: true, lineHeight: 24 })
    if (o.muted) yy = this.text(o.muted, yy + 2, { color: tok('color.mediumGrey') as string, lineHeight: 24 })
    const end = Math.max(start + (tok('layer.minHeight') as number), yy + pad)
    if (o.outline) {
      this.parts.push(`<rect x="${CONTENT_X - 6}" y="${start}" width="${CONTENT_W + 12}" height="${end - start}" rx="6" fill="none" stroke="${o.outline}" stroke-width="2"/>`)
    }
    return end
  }

  /** Grey bars standing for content the mockup is not about (or whose copy is not defined): no words. */
  placeholder(y: number, widths: number[] = [CONTENT_W * 0.7], x = CONTENT_X): number {
    widths.forEach((w, i) => this.parts.push(`<rect x="${x}" y="${y + i * 18}" width="${w}" height="10" rx="5" fill="${tok('color.lightGrey')}"/>`))
    this.tokens.add('color.lightGrey')
    return y + widths.length * 18
  }

  /** A dashed rule between alternatives drawn on one screen (an annotation: the app draws no such line). */
  alternatives(y: number): number {
    this.parts.push(`<line x1="${CONTENT_X}" y1="${y}" x2="${CONTENT_X + CONTENT_W}" y2="${y}" stroke="${NOTE}" stroke-width="1.5" stroke-dasharray="6 5"/>`)
    return y
  }

  /**
   * An error box, InfoBox (InfoBoxType.Error): the `error` icon with a bold title beside it, and an optional body
   * indented below the icon, in the notification error colours.
   */
  errorNotice(title: string, y: number, body?: string): number {
    this.use('InfoBox (error)', 'notice.error.fill', 'notice.error.border', 'notice.error.text', 'notice.error.icon', 'infobox.radius', 'infobox.border', 'infobox.padding', 'infobox.iconSize')
    const pad = tok('infobox.padding') as number
    const icon = tok('infobox.iconSize') as number
    const fg = tok('notice.error.text') as string
    const parts: string[] = []
    const into = new Screen()
    // Header row: padding + 5, the icon, then the title 7 after it (InfoBox headerContainer, icon, headerText).
    const iconX = CONTENT_X + pad + 5
    const top = y + pad + 5
    const titleX = iconX + icon + 7
    const titleW = CONTENT_X + CONTENT_W - pad - 5 - titleX
    const titleLines = wrap(title, titleW, 18, true).length
    const titleTop = titleLines === 1 ? top + (icon - 24) / 2 : top
    let bottom = into.text(title, titleTop - 3, { x: titleX, width: titleW, bold: true, color: fg, lineHeight: 24 })
    bottom = Math.max(bottom, top + icon)
    if (body) bottom = into.text(body, bottom + 16 - 3, { x: CONTENT_X + pad + 10 + icon + 5, width: CONTENT_W - 2 * pad - 10 - icon - 10, color: fg, lineHeight: 24 }) + 16
    const h = bottom + 5 + pad - y
    parts.push(
      `<rect x="${CONTENT_X}" y="${y}" width="${CONTENT_W}" height="${h}" rx="${tok('infobox.radius')}" fill="${tok('notice.error.fill')}" stroke="${tok('notice.error.border')}" stroke-width="${tok('infobox.border')}"/>`,
      `<circle cx="${iconX + icon / 2}" cy="${top + icon / 2}" r="${icon * 0.42}" fill="${tok('notice.error.icon')}"/>`,
      `<path d="M${iconX + icon / 2} ${top + icon * 0.3} v${icon * 0.25}" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>`,
      `<circle cx="${iconX + icon / 2}" cy="${top + icon * 0.7}" r="1.6" fill="#FFFFFF"/>`,
    )
    this.parts.push(...parts, ...into.parts)
    return y + h
  }

  /**
   * A bottom sheet (DeleteChatSheet in SafeAreaModal) over a dimmed screen. `draw` lays out its content from
   * the y it is given, inside the sheet's padding; the sheet is sized to fit and anchored to the bottom.
   */
  bottomSheet(draw: (s: Screen, y: number) => number): void {
    this.use('Bottom sheet (DeleteChatSheet, SafeAreaModal)', 'sheet.backdrop', 'sheet.radius', 'sheet.padding', 'sheet.gap', 'color.modalBackground')
    const probe = new Screen()
    const pad = tok('sheet.padding') as number
    const height = draw(probe, 0) + pad + 34
    const top = PY + PH - height
    this.parts.push(`<rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" fill="${tok('sheet.backdrop')}"/>`)
    this.parts.push(`<path d="M${PX} ${top + 20} a20 20 0 0 1 20 -20 h${PW - 40} a20 20 0 0 1 20 20 V${PY + PH} H${PX} Z" fill="${tok('color.modalBackground')}"/>`)
    const inner = new Screen()
    draw(inner, top + pad)
    this.parts.push(...inner.parts)
    for (const c of inner.components) this.components.add(c)
    for (const t of inner.tokens) this.tokens.add(t)
    for (const [k, v] of Object.entries(inner.chrome)) this.chrome[k as Chrome] = v
    this.assumptions.push(...inner.assumptions)
  }

  /** The phone status bar: the time and the signal, Wi-Fi and battery marks, in `color`. */
  private statusBar(color: string): void {
    const y = PY + 30
    const r = PX + PW - 30
    this.parts.push(
      `<text x="${PX + 48}" y="${y}" font-family="${SYSTEM_FONT}" font-size="15" font-weight="600" fill="${color}" text-anchor="middle">9:41</text>`,
      `<g fill="${color}">${[0, 1, 2, 3].map((i) => `<rect x="${r - 62 + i * 4.5}" y="${y - 3 - (i + 1) * 2.5}" width="3" height="${(i + 1) * 2.5}" rx="0.8"/>`).join('')}</g>`,
      `<path d="M${r - 38} ${y - 8} a9 9 0 0 1 12 0 M${r - 35.5} ${y - 5.5} a5 5 0 0 1 7 0" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/><circle cx="${r - 32}" cy="${y - 3}" r="1.3" fill="${color}"/>`,
      `<rect x="${r - 22}" y="${y - 12}" width="22" height="11" rx="3" fill="none" stroke="${color}" stroke-opacity="0.5"/><rect x="${r - 20}" y="${y - 10}" width="16" height="7" rx="1.5" fill="${color}"/>`,
    )
  }

  /**
   * The gradient navigation header (GradientHeaderBackground + HeaderTitle) under the status bar, with a back
   * chevron and the centred white bold title (TextTheme headerTitle, the system font). `title` is drawn verbatim.
   * When the plan defines no title, pass `placeholder`, a non-copy stand-in in angle brackets (`<title>`, or
   * `<contact name>` for a name the mockup is not about), drawn in the title's style; add `assumed` (why) when it
   * stands for copy the plan has not defined, which marks it and lists it in the notes. `kebab` adds the ⋮ menu a
   * contact's screen has. With neither title nor placeholder, the mockup must declare `omits.title`.
   */
  header(title?: string, o: { placeholder?: string; assumed?: string; kebab?: boolean } = {}): void {
    this.use('Header (GradientHeaderBackground, HeaderTitle)', 'header.gradient.0', 'header.gradient.1', 'header.gradient.2', 'header.gradient.stop1', 'header.text', 'text.headerTitle.size', 'text.headerTitle.weight', 'text.headerTitle.color')
    const fg = tok('header.text') as string
    this.parts.push(`<rect x="${PX}" y="${PY}" width="${PW}" height="${HEADER_BOTTOM - PY}" fill="url(#kr-header)"/>`)
    this.statusBar(fg)
    this.parts.push(`<path d="M${PX + 26} ${PY + 74} l-9 9 l9 9" fill="none" stroke="${fg}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`)
    if (o.placeholder !== undefined && !/^<[^<>]+>$/.test(o.placeholder)) throw new Error(`a header placeholder must be a <stand-in>, not copy: ${o.placeholder}`)
    const shown = title ?? o.placeholder
    if (shown !== undefined) {
      const size = tok('text.headerTitle.size') as number
      const weight = tok('text.headerTitle.weight') === 'bold' ? 700 : 400
      this.mark('title', o.assumed)
      this.parts.push(
        `<text x="${PX + PW / 2}" y="${PY + 90}" font-family="${SYSTEM_FONT}" font-size="${size}" font-weight="${weight}" fill="${tok('text.headerTitle.color')}" text-anchor="middle">${esc(shown)}</text>`,
      )
      if (o.assumed) {
        const w = textWidth(shown, size, true, 'system') + 16
        this.assumedMark(PX + PW / 2 - w / 2, PY + 70, w, 28, PX + PW / 2 + w / 2 - 20, PY + 60)
      }
    } else if (o.assumed) throw new Error('an assumed header title needs a <placeholder>')
    if (o.kebab) this.parts.push(`<g fill="${fg}">${[-6, 0, 6].map((d) => `<circle cx="${PX + PW - 26}" cy="${PY + 83 + d}" r="2"/>`).join('')}</g>`)
  }

  /**
   * The bottom tab bar (TabStack with TabTheme): six tabs, `active` white and bold, the others grey, running under
   * the home indicator. Content above it should end by TAB_TOP.
   */
  tabBar(active: TabName, o: { assumed?: string } = {}): void {
    this.mark('tabBar', o.assumed)
    this.use('Tab bar (TabStack, TabTheme)', 'tab.fill', 'tab.height', 'tab.active', 'tab.inactive', 'tab.label.size', ...TABS.map((n) => `tab.label.${n}` as TokenName))
    this.darkBottom = true
    this.parts.push(`<rect x="${PX}" y="${TAB_TOP}" width="${PW}" height="${PY + PH - TAB_TOP}" fill="${tok('tab.fill')}"/>`)
    const slot = PW / TABS.length
    TABS.forEach((name, i) => {
      const on = name === active
      const color = (on ? tok('tab.active') : tok('tab.inactive')) as string
      const cx = PX + slot * i + slot / 2
      const label = tok(`tab.label.${name}` as TokenName) as string
      const base = tok('tab.label.size') as number
      // adjustsFontSizeToFit, minimumFontScale 0.7, inside a 2-point gap each side; measured as the widest system
      // font, so neighbouring labels never collide in a viewer without Source Sans 3 (GitHub, VS Code)
      const size = Math.max(base * 0.7, Math.min(base, (base * (slot - 4)) / textWidth(label, base, on, 'system')))
      this.parts.push(
        `<g fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[name](cx, TAB_TOP + 19)}</g>`,
        `<text x="${cx}" y="${TAB_TOP + 46}" font-size="${size.toFixed(1)}"${on ? ' font-weight="700"' : ''} fill="${color}" text-anchor="middle">${esc(label)}</text>`,
      )
      if (on && o.assumed) this.assumedMark(cx - slot / 2 + 2, TAB_TOP + 3, slot - 4, 50, cx - 24, TAB_TOP - 12)
    })
  }

  /** Set when the bottom of the screen is dark (the tab bar), so the home indicator is drawn light. */
  darkBottom = false
}

const TABS = ['contacts', 'messages', 'qrCode', 'wallet', 'myAgent', 'menu'] as const
export type TabName = (typeof TABS)[number]

/** Outline stand-ins for the tab icons (TabStack's SVG and MaterialCommunityIcons glyphs), centred on (x, y). */
const TAB_ICONS: Record<TabName, (x: number, y: number) => string> = {
  contacts: (x, y) => `<circle cx="${x - 3}" cy="${y - 4}" r="4"/><path d="M${x - 10} ${y + 9} a7 6 0 0 1 14 0"/><path d="M${x + 2} ${y - 10} a4 4 0 1 1 1 7.6 M${x + 6} ${y + 1} a6 6 0 0 1 4 6"/>`,
  messages: (x, y) => `<path d="M${x - 9} ${y - 8} h18 v13 h-11 l-4 4 v-4 h-3 z"/><path d="M${x - 5} ${y - 3} h10 M${x - 5} ${y + 1} h6"/>`,
  qrCode: (x, y) => `<rect x="${x - 9}" y="${y - 9}" width="7" height="7"/><rect x="${x + 2}" y="${y - 9}" width="7" height="7"/><rect x="${x - 9}" y="${y + 2}" width="7" height="7"/><path d="M${x + 2} ${y + 2} h3 v3 M${x + 9} ${y + 2} v3 M${x + 5} ${y + 9} h4"/>`,
  wallet: (x, y) => `<rect x="${x - 9}" y="${y - 6}" width="18" height="15" rx="2"/><path d="M${x - 7} ${y - 6} l11 -4 l2 4 M${x + 3} ${y + 1} h6 v4 h-6 z"/>`,
  myAgent: (x, y) => `<path d="M${x} ${y - 10} l8 3 v6 c0 5 -4 8 -8 10 c-4 -2 -8 -5 -8 -10 v-6 z"/><circle cx="${x}" cy="${y - 1}" r="2.5"/><path d="M${x - 4} ${y + 5} a4 3 0 0 1 8 0"/>`,
  menu: (x, y) => `<circle cx="${x}" cy="${y}" r="10"/><circle cx="${x}" cy="${y - 3}" r="3.2"/><path d="M${x - 6} ${y + 7} a6 5 0 0 1 12 0"/>`,
}

export interface Mockup {
  file: string // NN-<screen>[-<state>].svg
  title: string // "<screen>: <state> (<plan> §n)"
  draw: (s: Screen) => void
  notes?: string[] // what a picture cannot show; annotations, not copy
  /**
   * Why this screen draws no header title, tab bar or primary button. Each piece of chrome is either drawn (from
   * the plan or the code), drawn as a marked "assumed" stand-in, or omitted with its reason here; `render` refuses
   * anything else, and the reason is shown in the notes and recorded in the SVG for check-plans.ts.
   */
  omits?: Partial<Record<Chrome, string>>
}

/** The SVG comment recording how a mockup treats each piece of chrome, which check-plans.ts reads. */
export const CHROME_MARK = 'mockup-chrome:'
/** The SVG comment carrying the reason for each omitted piece of chrome. */
export const OMITS_MARK = 'mockup-omits'

/** How a drawn screen treats each piece of chrome; throws when one is missing without a reason, or both. */
export const chromeOf = (m: Mockup, s: Screen): Record<Chrome, ChromeState> => {
  const out = {} as Record<Chrome, ChromeState>
  for (const c of CHROME) {
    const why = m.omits?.[c]?.trim()
    const drawn = s.chrome[c]
    if (drawn && why) throw new Error(`${m.file}: draws a ${CHROME_WORDS[c]} but also declares omits.${c}`)
    if (!drawn && !why) throw new Error(`${m.file}: draws no ${CHROME_WORDS[c]}; draw one (an assumed stand-in if the plan defines none) or declare why in omits.${c}`)
    out[c] = drawn ?? 'omitted'
  }
  return out
}

const defs = (): string =>
  `<defs><linearGradient id="kr-header" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0.00962" stop-color="${tok('header.gradient.0')}"/><stop offset="${tok('header.gradient.stop1')}" stop-color="${tok('header.gradient.1')}"/>` +
  `<stop offset="1" stop-color="${tok('header.gradient.2')}"/></linearGradient>` +
  // SVG 1.1 Gaussian blurs only (no feDropShadow), applied to separate shadow shapes: see SHADOWS in kit.test.ts.
  `<filter id="kr-card-shadow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="${(tok('card.shadowRadius') as number) / 2}"/></filter>` +
  `<filter id="kr-button-shadow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="${(tok('button.primary.shadowRadius') as number) / 2}"/></filter>` +
  `<clipPath id="kr-phone"><rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="36"/></clipPath></defs>`

/**
 * Wrap paragraphs for the notes column, measured as system-ui (conservatively, SYSTEM_WIDTH) so no line runs past
 * the canvas. `gap` puts an empty line after each paragraph; a legend's continuation lines are indented.
 */
export const noteWrap = (paras: string[], gap: boolean): string[] =>
  paras.flatMap((p) => {
    const indent = '\u00a0\u00a0\u00a0' // SVG collapses ordinary leading spaces
    const lines = wrap(p, gap ? NOTE_W : NOTE_W - textWidth(indent, NOTE_SIZE, false, 'system'), NOTE_SIZE, false, 'system')
    const out = gap ? lines : lines.map((l, i) => (i === 0 ? l : `${indent}${l}`))
    return gap ? [...out, ''] : out
  })

/** The complete SVG for one mockup. */
export const render = (m: Mockup): string => {
  const s = new Screen()
  m.draw(s)
  const chrome = chromeOf(m, s)
  const components = [...s.components]
  const legend = [`Theme: ${THEME} (Keyring's only theme).`, 'Drawn with:', ...components.map((c) => `· ${c}`)]
  const legendLines = noteWrap(legend, false)
  const omitted = CHROME.filter((c) => chrome[c] === 'omitted').map((c) => `No ${CHROME_WORDS[c]}: ${m.omits?.[c]?.trim()}`)
  const noteLines = noteWrap([...(m.notes ?? []), ...s.assumptions.map((a) => `Assumed: ${a}`), ...omitted], true)
  const note = (lines: string[], y: number, color = NOTE): string =>
    `<text font-family="${SYSTEM_FONT}" font-size="${NOTE_SIZE}" fill="${color}">${lines.map((l, i) => `<tspan x="${NOTE_X}" ${i === 0 ? `y="${y}"` : 'dy="18"'}>${l === '' ? '\u00a0' : esc(l)}</tspan>`).join('')}</text>`
  const legendY = H - 30 - (legendLines.length - 1) * 18
  const notesEnd = NOTES_Y + (noteLines.length - 1) * 18
  if (notesEnd > legendY - 24) throw new Error(`${m.file}: the notes run into the legend (${noteLines.length} lines); shorten them`)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`,
    `  <title>${esc(m.title)}</title>`,
    `  <desc>Keyring plan mockup, theme ${THEME}. Components: ${esc(components.join('; '))}. Tokens: ${esc([...s.tokens].sort().join(', '))}.</desc>`,
    `  <!-- ${KIT_MARK}${fingerprint()} — generated by scripts/plans/mockup-kit; edit the spec, not this file -->`,
    `  <!-- ${CHROME_MARK} ${CHROME.map((c) => `${c}=${chrome[c]}`).join(' ')} -->`,
    ...CHROME.filter((c) => chrome[c] === 'omitted').map((c) => `  <!-- ${OMITS_MARK} ${c}: ${esc(m.omits?.[c]?.trim() ?? '').replace(/--/g, '—')} -->`),
    `  ${defs()}`,
    `  <rect width="${W}" height="${H}" fill="#FFFFFF"/>`,
    `  <g clip-path="url(#kr-phone)">`,
    `    <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" fill="${tok('color.background')}"/>`,
    ...s.parts.map((p) => `    ${p}`),
    s.darkBottom
      ? `    <rect x="${PX + PW / 2 - 60}" y="${PY + PH - 12}" width="120" height="5" rx="2.5" fill="#FFFFFF" opacity="0.6"/>`
      : `    <rect x="${PX + PW / 2 - 60}" y="${PY + PH - 12}" width="120" height="5" rx="2.5" fill="${tok('color.text')}" opacity="0.35"/>`,
    `  </g>`,
    `  <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="36" fill="none" stroke="#9A9A9A" stroke-width="2"/>`,
    `  <line x1="392" y1="40" x2="392" y2="780" stroke="#E0E0E0" stroke-width="1"/>`,
    `  ${note(noteLines, NOTES_Y)}`,
    `  ${note(legendLines, legendY, '#A0A0A0')}`,
    `</svg>`,
    '',
  ].join('\n')
}

/** Write every mockup into `dir` (the spec file's folder). Returns the paths written. */
export const writeMockups = (dir: string, mockups: Mockup[]): string[] =>
  mockups.map((m) => {
    if (!/^\d{2}-[a-z0-9-]+\.svg$/.test(m.file)) throw new Error(`${m.file}: name mockups NN-<screen>[-<state>].svg`)
    const out = path.join(dir, m.file)
    fs.writeFileSync(out, render(m))
    return out
  })

/** Spacing of the contact sheet: the page padding, the gap between screens, and each caption's height. */
const SHEET_PAD = 16
const SHEET_GAP = 8
const CAPTION_H = 36
/** Bump when the sheet's layout changes, so the checker asks for every plan's sheet to be regenerated. */
export const SHEET_LAYOUT = 1
/** Screens per row on the committed sheet: 3 keeps it about 2000 px wide (1968 px). */
export const SHEET_COLUMNS = 3
export const SHEET_FILE = 'sheet.png'
export const SHEET_MANIFEST = 'sheet.manifest.json'

/** The sheet's pixel size for `count` screens in `columns`. */
export const sheetSize = (count: number, columns: number): { width: number; height: number } => {
  const cols = Math.max(1, Math.min(columns, count))
  const rows = Math.max(1, Math.ceil(count / cols))
  return {
    width: 2 * SHEET_PAD + cols * W + (cols - 1) * SHEET_GAP,
    height: 2 * SHEET_PAD + rows * (H + CAPTION_H) + (rows - 1) * SHEET_GAP,
  }
}

/** The text of an SVG's `<title>`, entities decoded, or ''. */
export const svgTitle = (svg: string): string =>
  (/<title>([\s\S]*?)<\/title>/.exec(svg)?.[1] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/**
 * An HTML page showing SVGs side by side in the app's font: the contact sheet (`kit.ts sheet`) and the ad-hoc
 * preview. Each screen is captioned with its file name and its `<title>`. Every size is fixed, so the page is
 * exactly `sheetSize` and renders the same each time.
 */
export const previewHtml = (svgs: { name: string; svg: string }[], fontDir: string, columns = 4): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>` +
  `@font-face{font-family:'Source Sans 3';font-weight:400;src:url('${pathToFileURL(path.join(fontDir, 'SourceSans3-Regular.ttf')).href}')}` +
  `@font-face{font-family:'Source Sans 3';font-weight:700;src:url('${pathToFileURL(path.join(fontDir, 'SourceSans3-Bold.ttf')).href}')}` +
  `html,body{margin:0;background:#fff}` +
  `body{padding:${SHEET_PAD}px;display:grid;grid-template-columns:repeat(${columns},${W}px);gap:${SHEET_GAP}px;width:max-content}` +
  `figure{margin:0}svg{display:block}` +
  `figcaption{font:14px/18px 'Source Sans 3',sans-serif;color:#555;padding:0 20px;height:${CAPTION_H}px;overflow:hidden}` +
  `figcaption b{color:#333}</style></head><body>` +
  svgs.map((s) => `<figure>${s.svg}<figcaption><b>${esc(s.name)}</b><br>${esc(svgTitle(s.svg))}</figcaption></figure>`).join('') +
  `</body></html>`

export const sha256 = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex')

/** What `sheet.manifest.json` records: what the sheet was built from, so check-plans.ts can tell a stale one. */
export interface SheetManifest {
  regenerate: string
  layout: number
  tokens: string
  columns: number
  width: number
  height: number
  sheet: { file: string; sha256: string }
  svgs: Record<string, string>
}

/** The command that regenerates the sheet in `dir` (as written, relative to the repo root). */
export const sheetCommand = (dir: string): string => `node --experimental-strip-types scripts/plans/mockup-kit/kit.ts sheet ${dir}`

/** The manifest for a sheet built from `svgs` (name → contents) into a PNG whose bytes hash to `png`. */
export const sheetManifest = (dir: string, svgs: Record<string, string | Buffer>, png: string, columns: number): SheetManifest => {
  const names = Object.keys(svgs).sort()
  return {
    regenerate: sheetCommand(dir),
    layout: SHEET_LAYOUT,
    tokens: fingerprint(),
    columns,
    ...sheetSize(names.length, columns),
    sheet: { file: SHEET_FILE, sha256: png },
    svgs: Object.fromEntries(names.map((n) => [n, sha256(svgs[n])])),
  }
}

/** The mockup SVGs in a folder, in flow order. */
export const mockupFiles = (dir: string): string[] => fs.readdirSync(dir).filter((f) => /^\d{2}-[a-z0-9-]+\.svg$/.test(f)).sort()

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Width and height from a PNG's IHDR chunk. */
export const pngSize = (png: Buffer): { width: number; height: number } => {
  if (png.length < 24 || png.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** Render `files` (in `dir`) to a PNG at `out` with headless Chromium. Returns the PNG size. */
const screenshot = (dir: string, files: string[], out: string, columns: number): { width: number; height: number } => {
  const cols = Math.max(1, Math.min(columns, files.length))
  const html = previewHtml(
    files.map((f) => ({ name: f, svg: fs.readFileSync(path.join(dir, f), 'utf8') })),
    path.join(repoRoot, 'app', 'src', 'assets', 'fonts'),
    cols,
  )
  const size = sheetSize(files.length, cols)
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'mockup-sheet-'))
  try {
    const page = path.join(tmp, 'sheet.html')
    fs.writeFileSync(page, html)
    // --headless=new with a file:// HTML wrapper: a plain --screenshot of one SVG is clamped to 800×600, and the
    // wrapper needs --allow-file-access-from-files to load the font files.
    const shoot = (w: number, h: number): { width: number; height: number } => {
      execFileSync(process.env.CHROMIUM ?? '/usr/bin/chromium', [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files',
        '--force-device-scale-factor=1', '--font-render-hinting=none', `--user-data-dir=${path.join(tmp, 'profile')}`,
        `--window-size=${w},${h}`, `--screenshot=${path.resolve(out)}`, pathToFileURL(page).href,
      ], { stdio: 'ignore' })
      return pngSize(fs.readFileSync(out))
    }
    // The window size includes some browser chrome (about 100 px of height in headless=new), so the first shot
    // can come out short; the second asks for the difference more and is then exactly the sheet's size.
    let got = shoot(size.width, size.height)
    if (got.width !== size.width || got.height !== size.height) got = shoot(2 * size.width - got.width, 2 * size.height - got.height)
    if (got.width !== size.width || got.height !== size.height) throw new Error(`chromium rendered ${got.width}×${got.height}, expected ${size.width}×${size.height}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return size
}

/** Shrink a PNG losslessly-or-nearly with whichever optimiser is installed (pngquant, then optipng); else leave it. */
const optimise = (png: string): string | null => {
  const has = (cmd: string): boolean => {
    try {
      execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  if (has('pngquant')) {
    execFileSync('pngquant', ['--force', '--skip-if-larger', '--speed', '1', '--quality', '80-100', '--strip', '--output', png, png], { stdio: 'ignore' })
    return 'pngquant'
  }
  if (has('optipng')) {
    execFileSync('optipng', ['-quiet', '-o2', '-strip', 'all', png], { stdio: 'ignore' })
    return 'optipng'
  }
  return null
}

/**
 * Write `<dir>/sheet.png`, the contact sheet reviewers look at, and `<dir>/sheet.manifest.json` beside it. `dir`
 * is a plan's mockups folder; it is recorded relative to the repo root in the manifest's regenerate command.
 */
export const writeSheet = (dir: string, columns = SHEET_COLUMNS): { png: string; manifest: SheetManifest; optimiser: string | null } => {
  const files = mockupFiles(dir)
  if (files.length === 0) throw new Error(`${dir}: no NN-<screen>.svg mockups to put on a sheet`)
  const png = path.join(dir, SHEET_FILE)
  screenshot(dir, files, png, columns)
  const optimiser = optimise(png)
  const rel = path.relative(repoRoot, path.resolve(dir)).split(path.sep).join('/')
  const manifest = sheetManifest(rel, Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f))])), sha256(fs.readFileSync(png)), Math.min(columns, files.length))
  fs.writeFileSync(path.join(dir, SHEET_MANIFEST), JSON.stringify(manifest, null, 2) + '\n')
  return { png, manifest, optimiser }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const [cmd, dir, ...rest] = process.argv.slice(2)
  if (cmd === 'sheet' && dir) {
    const { png, manifest, optimiser } = writeSheet(dir, Number(rest[0] ?? SHEET_COLUMNS))
    const kb = Math.round(fs.statSync(png).size / 1024)
    console.log(`${Object.keys(manifest.svgs).length} mockup(s) → ${png} (${manifest.width}×${manifest.height} px, ${kb} KB${optimiser ? `, ${optimiser}` : ', no PNG optimiser installed'}) and ${SHEET_MANIFEST}`)
  } else if (cmd === 'preview' && dir && rest[0]) {
    const files = mockupFiles(dir)
    screenshot(dir, files, rest[0], Number(rest[1] ?? Math.min(4, files.length)))
    console.log(`${files.length} mockup(s) → ${rest[0]}`)
  } else {
    console.error('usage: kit.ts sheet <mockups dir> [columns]        → <dir>/sheet.png and sheet.manifest.json (commit both)\n' +
      '       kit.ts preview <mockups dir> <out.png> [columns] → an ad-hoc render, not committed')
    process.exit(2)
  }
}
