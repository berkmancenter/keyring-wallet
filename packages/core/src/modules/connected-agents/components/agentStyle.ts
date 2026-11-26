/**
 * The colours the agent connect screens share, as drawn on the UI/UX canvas (docs/plans/agent-connect-plan/canvas/,
 * the design the screens are built to, D41). Kept in one place so the list, the details, the contact card and the
 * notices cannot drift apart.
 *
 * @module connected-agents/components/agentStyle
 */

export const AGENT_COLORS = {
  /** Keyring's purple: links, the agent mark's outline, the selected checkbox. */
  primary: '#622C62',
  /** The avatar circle behind the robot. */
  avatar: '#EFE6EF',
  /** The dashed edge an agent's card has where a person's has a solid one (§6, Contacts). */
  edge: '#8A5A8A',
  text: '#010B13',
  muted: '#5C5C66',
  disabled: '#9A9AA2',
  danger: '#A5182A',
  /** Status chips: green, amber, grey, always with the word (canvas note o1, item 7). */
  okBg: '#E3F3E6',
  okText: '#1F6B33',
  warnBg: '#FFF4DC',
  warnText: '#6C4A00',
  quietBg: '#ECECEE',
  quietText: '#4A4A52',
} as const

/** The MaterialCommunityIcons glyph for a connected agent (§6, "The agent icon"); never drawn without the words. */
export const AGENT_ICON = 'robot-outline'
