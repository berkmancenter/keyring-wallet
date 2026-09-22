/**
 * The app's one scanner — camera plus its paste-link button — for scanning an
 * agent link, an invitation or a vetting ticket.
 *
 * @module trust-tasks/screens/openScanner
 */

import { Screens, Stacks } from '../../../types/navigators'

export function openScanner(navigation: unknown): void {
  const root = navigation as { navigate: (name: string, params?: object) => void }
  // Params are explicit: without them the Scan route can keep the
  // `defaultToConnect` of an earlier "show my QR" visit and open this wallet's
  // own invitation QR, with no camera and no paste-link button.
  root.navigate(Stacks.ConnectStack, { screen: Screens.Scan, params: { defaultToConnect: false } })
}
