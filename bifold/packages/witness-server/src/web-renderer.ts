/**
 * web-renderer.ts — barrel re-export for all HTML page generators
 *
 * WebServer.ts imports from this single entry point so it doesn't need
 * to know which file each page lives in.  Each page has its own module:
 *
 *   page-invitation.ts   → generateInvitationPage  (GET /)
 *   page-activity-log.ts → generateActivityLogPage  (GET /log)
 *   page-network.ts      → generateNetworkPage      (GET /network)
 *   page-berkolator.ts   → getWitnessVizHtml        (GET /berkolator)
 *   page-connect.ts      → getConnectFallbackHtml   (GET /connect)
 *
 * getLogoBuffer lives here because it is a generic asset helper that
 * isn't tied to any single page.
 */

import * as fs from 'fs'
import * as path from 'path'

export { generateInvitationPage } from './page-invitation'
export { generateActivityLogPage, formatDate } from './page-activity-log'
export { generateNetworkPage } from './page-network'
export { getWitnessVizHtml } from './page-berkolator'
export { getConnectFallbackHtml } from './page-connect'

// ─── Logo asset ──────────────────────────────────────────────────────────────

let cachedLogoBuffer: Buffer | null = null

export function getLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer) return cachedLogoBuffer
  try {
    const logoPath = path.resolve(__dirname, '..', 'assets', 'asml-logo.png')
    cachedLogoBuffer = fs.readFileSync(logoPath)
    return cachedLogoBuffer
  } catch {
    return null
  }
}
