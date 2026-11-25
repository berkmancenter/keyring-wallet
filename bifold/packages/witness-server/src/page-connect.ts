/**
 * page-connect.ts — Universal-link fallback page (served at /connect)
 *
 * Serves a static HTML page that handles the DIDComm universal-link deep-link
 * for users who don't yet have the wallet app installed.
 */

import * as fs from 'fs'
import * as path from 'path'

const assetsDir = path.resolve(__dirname, '..', 'assets')

let cachedConnectHtml: string | null = null

export function getConnectFallbackHtml(): string {
  if (!cachedConnectHtml) {
    cachedConnectHtml = fs.readFileSync(path.join(assetsDir, 'connect.html'), 'utf-8')
  }
  return cachedConnectHtml
}
