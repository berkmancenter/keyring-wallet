/**
 * Where "My Agent" is for this phone: the "Your agent" home once an agent is
 * linked, the old panel (which offers the link) until then. The My Agent
 * stack lands here, and every button that sends a person "to My Agent" goes
 * here too — never straight to the panel. The vetting done card did, and a
 * person admitted a moment before read "You are being vetted", raw DIDs and
 * the agent host's name there (225 gate).
 *
 * @module trust-tasks/screens/agentHome
 */
import { Screens } from '../../../types/navigators'
import type { VtaLinkState } from '../module/vtaLinkMachine'
import { vtaAgent } from '../module/vtaAgent'

export function agentHomeScreen(
  link: Pick<VtaLinkState, 'kind'> = vtaAgent.getState().link
): Screens.VtaAgent | Screens.MyAgent {
  return link.kind === 'linked' ? Screens.VtaAgent : Screens.MyAgent
}
