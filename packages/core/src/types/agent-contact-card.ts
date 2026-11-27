/**
 * Props for the component that draws one of the owner's connected AI agents in the contacts list and, from step 7.9,
 * in Messages (docs/plans/agent-connect-plan.md §3.14 and §6).
 *
 * An agent is not an R-Card: it has no photo, no organisation and no verification badge, so it gets its own token,
 * `TOKENS.COMPONENT_AGENT_CONTACT_CARD`, beside `COMPONENT_CONTACT_CARD`, and an app may draw it differently.
 */
export interface AgentContactCardProps {
  /** The name the owner gave the agent. */
  name: string
  /** A second line under the name; the contacts row passes nothing and gets "Your AI agent". */
  subtitle?: string
  onPress: () => void
  /** Test id for the pressable card; the default renderer falls back to `AgentContactCard`. */
  testID?: string
}
