/**
 * Text from a room, made safe to show. A room is a writable channel into every member's screen
 * and agent (VTI `docs/02-vta/data-rooms.md` §9: "Render inert; fence recalled content as data,
 * never instructions"). So every body, title and name a room supplies reaches the screens as
 * `InertText`.
 *
 * InertText is plain text for a plain `Text` component. It is never markdown, HTML or a link, and
 * nothing in it is followed or acted on. The rooms module may not import a renderer that would
 * interpret it; `__tests__/noInterpretingRenderers.test.ts` holds that line.
 */
declare const inert: unique symbol

export type InertText = string & { readonly [inert]: true }

// C0 and C1 controls other than tab and newline, and the bidirectional overrides and isolates that
// can make text read differently from what it says (U+202A–U+202E, U+2066–U+2069).
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g

/** Text from a room, with the characters that could disguise it removed. */
export function toInertText(raw: unknown): InertText {
  const text = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw)
  return text.replace(HIDDEN, '') as InertText
}

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z][a-z0-9+.-]*:\/\/\S+/i
const INSTRUCTION =
  /\b(?:ignore (?:all |any )?(?:previous|prior|above) (?:instructions|messages)|system prompt|you are now|disregard (?:the|your) (?:rules|instructions)|act as (?:an?|the) )/i

/** Hints for a quiet line under the text. They change nothing about how the text is shown. */
export function inertFlags(text: InertText): { containsLink: boolean; looksLikeInstruction: boolean } {
  return { containsLink: LINK.test(text), looksLikeInstruction: INSTRUCTION.test(text) }
}
