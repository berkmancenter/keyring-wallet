// tokens.ts — the Keyring theme values plan mockups are drawn with (docs/plans/CLAUDE.md, "Diagrams and mockups").
//
// Each token is the value the app renders, plus an anchor: the source file, the blocks to step into, and a
// pattern that must match there. A pattern with a capture group must capture exactly the token's value; one
// without (an alias such as `backgroundColor: ColorPalette.brand.primary`) must simply still be there.
// `tokens.test.ts` checks every anchor against the real theme source, so a theme change fails the test until
// this file is updated, and updating it changes `fingerprint()`, which check-plans.ts uses to flag every
// mockup drawn with the old values.
//
// The values are snapshots rather than an evaluated theme because the effective theme is built at run time
// (ThemeBuilder deep-merges bifold's generated theme with Keyring's overrides, and needs React Native to load).
// Keyring has one theme, light; there is no dark variant (app/src/theme.ts).

import crypto from 'node:crypto'

export interface Anchor {
  file: string // repo-relative
  path: string[] // substrings opening nested blocks, searched in order; the pattern is matched inside the last
  pattern: RegExp
}

export interface Token {
  value: string | number
  anchors: Anchor[]
}

const KT = 'app/src/keyring-theme/theme.ts'
const HEADER = 'app/src/keyring-theme/components/GradientHeaderBackground.tsx'
const CARD = 'packages/core/src/modules/vrc/components/ContactCard.tsx'
const LAYERS = 'packages/core/src/modules/vrc/components/RelationshipLayers.tsx'
const SHEET = 'packages/core/src/components/listItems/DeleteChatSheet.tsx'
const BT = 'packages/core/src/theme.ts'
const INFOBOX = 'packages/core/src/components/misc/InfoBox.tsx'
const BIFOLD_EN = 'packages/core/src/localization/en/en.json'
const APP_EN = 'app/src/localization/en/index.ts'

const at = (file: string, path: string[], pattern: RegExp): Anchor => ({ file, path, pattern })
const t = (value: string | number, ...anchors: Anchor[]): Token => ({ value, anchors })

export const THEME = 'light' as const

export const TOKENS = {
  // Palette (KT: brand constants, GrayscaleColors, BrandColors, NotificationColors).
  'color.primary': t('#622C62', at(KT, [], /const BRAND_PURPLE = '(#[0-9A-Fa-f]{6})'/), at(KT, ['export const BrandColors'], /primary: BRAND_PURPLE,/)),
  'color.secondary': t('#4D7A8B', at(KT, [], /const HARVARD_BLUE = '(#[0-9A-Fa-f]{6})'/), at(KT, ['export const BrandColors'], /secondary: HARVARD_BLUE,/)),
  'color.text': t('#010B13', at(KT, [], /const BKC_BLACK = '(#[0-9A-Fa-f]{6})'/), at(KT, ['export const BrandColors'], /text: BKC_BLACK,/)),
  'color.darkGrey': t('#4A4A4A', at(KT, [], /const NEUTRAL_CHARCOAL_GRAY = '(#[0-9A-Fa-f]{6})'/)),
  'color.mediumGrey': t('#666666', at(KT, [], /const MEDIUM_GRAY = '(#[0-9A-Fa-f]{6})'/)),
  'color.lightGrey': t('#D3D3D3', at(KT, ['export const GrayscaleColors'], /lightGrey: '(#[0-9A-Fa-f]{6})'/)),
  'color.white': t('#FFFFFF', at(KT, ['export const GrayscaleColors'], /white: '(#[0-9A-Fa-f]{6})'/)),
  'color.background': t('#F5F5F5', at(KT, ['export const BrandColors'], /primaryBackground: '(#[0-9A-Fa-f]{6})'/)),
  'color.modalBackground': t('#FFFFFF', at(KT, ['export const BrandColors'], /modalPrimaryBackground: GrayscaleColors\.white,/)),
  'color.error': t('#D21E30', at(KT, [], /const BRIGHT_CRIMSON = '(#[0-9A-Fa-f]{6})'/)),
  'notice.error.fill': t('#FDF0F1', at(KT, ['export const NotificationColors'], /\berror: '(#[0-9A-Fa-f]{6})'/)),
  'notice.error.border': t('#D21E30', at(KT, ['export const NotificationColors'], /errorBorder: BRIGHT_CRIMSON,/)),
  'notice.error.text': t('#4A0D15', at(KT, ['export const NotificationColors'], /errorText: '(#[0-9A-Fa-f]{6})'/)),

  // Type (KT TextTheme). Every style uses one family; headerTitle sets none, so it is the system font.
  'font.family': t('SourceSans3-Regular', at(KT, ['export const TextTheme', 'normal: {'], /fontFamily: '([\w-]+)'/)),
  'text.color': t('#4A4A4A', at(KT, ['export const TextTheme', 'normal: {'], /color: ColorPalette\.grayscale\.darkGrey,/)),
  'text.normal.size': t(18, at(KT, ['export const TextTheme', 'normal: {'], /fontSize: (\d+)/)),
  'text.headingOne.size': t(38, at(KT, ['export const TextTheme', 'headingOne: {'], /fontSize: (\d+)/)),
  'text.headingThree.size': t(26, at(KT, ['export const TextTheme', 'headingThree: {'], /fontSize: (\d+)/)),
  'text.headingFour.size': t(21, at(KT, ['export const TextTheme', 'headingFour: {'], /fontSize: (\d+)/)),
  'text.labelSubtitle.size': t(14, at(KT, ['export const TextTheme', 'labelSubtitle: {'], /fontSize: (\d+)/)),
  'text.headerTitle.size': t(20, at(KT, ['export const TextTheme', 'headerTitle: {'], /fontSize: (\d+)/)),
  'text.headerTitle.weight': t('bold', at(KT, ['export const TextTheme', 'headerTitle: {'], /fontWeight: '(\w+)'/)),
  'text.headerTitle.color': t('#FFFFFF', at(KT, ['export const TextTheme', 'headerTitle: {'], /color: ColorPalette\.brand\.headerText,/), at(KT, ['export const BrandColors'], /headerText: GrayscaleColors\.white,/)),

  // Spacing (KT Spacing; ScreenWrapper pads with md).
  'space.md': t(16, at(KT, ['export const Spacing'], /md: (\d+)/)),
  'space.lg': t(24, at(KT, ['export const Spacing'], /lg: (\d+)/)),

  // Header (GradientHeaderBackground: a left-to-right gradient behind a white HeaderTitle).
  'header.gradient.0': t('#2E4953', at(HEADER, [], /GRADIENT_COLORS = \['(#[0-9A-Fa-f]{6})'/)),
  'header.gradient.1': t('#622C62', at(HEADER, [], /GRADIENT_COLORS = \['#\w+', '(#[0-9A-Fa-f]{6})'/)),
  'header.gradient.2': t('#6E121D', at(HEADER, [], /GRADIENT_COLORS = \['#\w+', '#\w+', '(#[0-9A-Fa-f]{6})'/)),
  'header.gradient.stop1': t(0.50962, at(HEADER, [], /GRADIENT_LOCATIONS = \[[\d.]+, ([\d.]+)/)),
  'header.text': t('#FFFFFF', at(KT, ['export const BrandColors'], /headerText: GrayscaleColors\.white,/)),

  // Buttons (KT Buttons; Button.tsx). Heights follow from padding + lineHeight 24 (+ border).
  'button.primary.fill': t('#622C62', at(KT, ['export const Buttons', '  primary: {'], /backgroundColor: ColorPalette\.brand\.primary,/)),
  'button.primary.radius': t(10, at(KT, ['export const Buttons', '  primary: {'], /borderRadius: (\d+)/)),
  'button.primary.paddingVertical': t(12, at(KT, ['export const Buttons', '  primary: {'], /paddingVertical: (\d+)/)),
  'button.text.lineHeight': t(24, at(KT, ['export const Buttons', '  primaryText: {'], /lineHeight: (\d+)/)),
  'button.primary.text': t('#FFFFFF', at(KT, ['export const Buttons', '  primaryText: {'], /color: ColorPalette\.brand\.buttonText,/)),
  'button.primary.textWeight': t('bold', at(KT, ['export const Buttons', '  primaryText: {'], /fontWeight: '(\w+)'/)),
  'button.primary.shadowColor': t('#000000', at(KT, ['export const Buttons', '  primary: {'], /shadowColor: '(#[0-9A-Fa-f]{6})'/)),
  'button.primary.shadowOffsetY': t(4, at(KT, ['export const Buttons', '  primary: {'], /shadowOffset: \{ width: 0, height: (\d+) \}/)),
  'button.primary.shadowRadius': t(4, at(KT, ['export const Buttons', '  primary: {'], /shadowRadius: (\d+)/)),
  'button.primary.shadowOpacity': t(0.15, at(KT, ['export const Buttons', '  primary: {'], /shadowOpacity: ([\d.]+)/)),
  'button.secondary.radius': t(10, at(KT, ['export const Buttons', '  secondary: {'], /borderRadius: (\d+)/)),
  'button.secondary.padding': t(16, at(KT, ['export const Buttons', '  secondary: {'], /padding: (\d+)/)),
  'button.secondary.border': t(2, at(KT, ['export const Buttons', '  secondary: {'], /borderWidth: (\d+)/)),
  'button.secondary.borderColor': t('#622C62', at(KT, ['export const Buttons', '  secondary: {'], /borderColor: ColorPalette\.brand\.primary,/)),
  'button.secondary.text': t('#622C62', at(KT, ['export const Buttons', '  secondaryText: {'], /color: ColorPalette\.brand\.primary,/)),
  'button.tertiary.padding': t(16, at(BT, ['tertiary: {'], /padding: (\d+)/)),

  // Contact card (ContactCard): the list row shape used for people and phones.
  'card.fill': t('#F5F5F5', at(CARD, [], /const CARD_BG = '(#[0-9A-Fa-f]{6})'/)),
  'card.border': t('rgba(170, 170, 170, 0.4)', at(CARD, [], /const CARD_BORDER = '(rgba\([^)]*\))'/)),
  'card.avatar': t('#E8E0E8', at(CARD, [], /const AVATAR_BG = '(#[0-9A-Fa-f]{6})'/)),
  'card.name': t('#010B13', at(CARD, [], /const NAME_COLOR = '(#[0-9A-Fa-f]{6})'/)),
  'card.height': t(62, at(CARD, ['itemContainer: {'], /height: (\d+)/)),
  'card.radius': t(12, at(CARD, ['itemContainer: {'], /borderRadius: (\d+)/)),

  // Relationship layer rows (RelationshipLayers, on ContactDetails).
  'layer.minHeight': t(44, at(LAYERS, ['day: {'], /minHeight: (\d+)/)),
  'layer.paddingVertical': t(8, at(LAYERS, ['day: {'], /paddingVertical: (\d+)/)),

  // Contact card shadow (ContactCard itemContainer, iOS; Android uses elevation 3).
  'card.shadowOffsetY': t(4, at(CARD, ['itemContainer: {', 'ios: {'], /shadowOffset: \{ width: 0, height: (\d+) \}/)),
  'card.shadowOpacity': t(0.1, at(CARD, ['itemContainer: {', 'ios: {'], /shadowOpacity: ([\d.]+)/)),
  'card.shadowRadius': t(4, at(CARD, ['itemContainer: {', 'ios: {'], /shadowRadius: (\d+)/)),
  'card.avatarIcon': t('#666666', at(CARD, [], /<Icon name="account-outline" size=\{22\} color="(#[0-9A-Fa-f]{6})"/)),

  // Tab bar (KT TabTheme; TabStack.tsx draws a 20-24 icon over a 14 label, bold when focused).
  'tab.fill': t('#010B13', at(KT, ['export const TabTheme', 'tabBarStyle: {'], /backgroundColor: BKC_BLACK,/)),
  'tab.height': t(55, at(KT, ['export const TabTheme', 'tabBarStyle: {'], /height: (\d+)/)),
  'tab.active': t('#FFFFFF', at(KT, ['export const TabTheme'], /tabBarActiveTintColor: ColorPalette\.grayscale\.white,/)),
  'tab.inactive': t('#666666', at(KT, ['export const TabTheme'], /tabBarInactiveTintColor: ColorPalette\.grayscale\.mediumGrey,/)),
  'tab.label.size': t(14, at(KT, ['export const TextTheme', '  label: {'], /fontSize: (\d+)/), at(KT, ['export const TabTheme', 'tabBarTextStyle: {'], /\.\.\.TextTheme\.label,/)),
  'tab.label.contacts': t('Contacts', at(BIFOLD_EN, ['"TabStack": {'], /"Contacts": "([^"]+)"/)),
  'tab.label.messages': t('Message', at(BIFOLD_EN, ['"TabStack": {'], /"Messages": "([^"]+)"/)),
  'tab.label.qrCode': t('QR Code', at(BIFOLD_EN, ['"TabStack": {'], /"QRCode": "([^"]+)"/)),
  'tab.label.wallet': t('Wallet', at(BIFOLD_EN, ['"TabStack": {'], /"Wallet": "([^"]+)"/)),
  'tab.label.myAgent': t('My Agent', at(BIFOLD_EN, ['"TabStack": {'], /"MyAgent": "([^"]+)"/)),
  // Header titles of existing screens a plan's mockup shows (the app's own strings, never plan copy).
  'title.contactDetails': t('Contact Details', at(BIFOLD_EN, ['"Screens": {'], /"ContactDetails": "([^"]+)"/)),
  'tab.label.menu': t('Menu', at(APP_EN, ['"Screens": {'], /"Settings": "([^"]+)"/)),

  // Error box (InfoBox, InfoBoxType.Error): an `error` icon, a bold title beside it, the body indented below.
  'infobox.radius': t(5, at(INFOBOX, ['container: {'], /borderRadius: (\d+)/)),
  'infobox.border': t(1, at(INFOBOX, ['container: {'], /borderWidth: (\d+)/)),
  'infobox.padding': t(10, at(INFOBOX, ['container: {'], /padding: (\d+)/)),
  'infobox.iconSize': t(30, at(INFOBOX, [], /const iconSize = (\d+)/)),
  'notice.error.icon': t('#D21E30', at(KT, ['export const NotificationColors'], /errorIcon: BRIGHT_CRIMSON,/)),

  // Bottom sheet (DeleteChatSheet inside SafeAreaModal).
  'sheet.backdrop': t('rgba(1,11,19,0.42)', at(SHEET, ['back: {'], /backgroundColor: '(rgba\([^)]*\))'/)),
  'sheet.radius': t(20, at(SHEET, ['sheet: {'], /borderTopLeftRadius: (\d+)/)),
  'sheet.padding': t(20, at(SHEET, ['sheet: {'], /padding: (\d+)/)),
  'sheet.gap': t(14, at(SHEET, ['sheet: {'], /gap: (\d+)/)),
} satisfies Record<string, Token>

export type TokenName = keyof typeof TOKENS

/** A token's value. */
export const tok = <N extends TokenName>(name: N): (typeof TOKENS)[N]['value'] => TOKENS[name].value

/** The text of the block that opens at `start`: up to the line, at the same or less indentation, that closes it. */
const blockAt = (text: string, start: number): string => {
  const lineStart = text.lastIndexOf('\n', start) + 1
  const indent = /^\s*/.exec(text.slice(lineStart))?.[0].length ?? 0
  const lines = text.slice(lineStart).split('\n')
  const out = [lines[0]]
  for (const l of lines.slice(1)) {
    out.push(l)
    const ind = /^\s*/.exec(l)?.[0].length ?? 0
    if (l.trim() !== '' && ind <= indent && /^\s*[}\])]/.test(l)) break
  }
  return out.join('\n')
}

/** Why an anchor does not hold against `source` (the file's text), or null when it does. */
export const checkAnchor = (token: Token, anchor: Anchor, source: string): string | null => {
  let scope = source
  for (const p of anchor.path) {
    const i = scope.indexOf(p)
    if (i === -1) return `block "${p}" not found in ${anchor.file}`
    scope = blockAt(scope, i)
  }
  const m = anchor.pattern.exec(scope)
  if (!m) return `${anchor.pattern} no longer matches in ${anchor.file}${anchor.path.length ? ` (${anchor.path.join(' › ')})` : ''}`
  if (m.length > 1 && m[1] !== undefined) {
    const norm = (v: string | number): string => String(v).toLowerCase().replace(/\s+/g, '')
    if (norm(m[1]) !== norm(token.value)) return `${anchor.file} has ${m[1]}, the token has ${token.value}`
  }
  return null
}

/** A short hash of every token value. A mockup records the one it was drawn with. */
export const fingerprint = (tokens: Record<string, Token> = TOKENS): string =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(Object.entries(tokens).map(([k, v]) => [k, v.value])))
    .digest('hex')
    .slice(0, 12)
