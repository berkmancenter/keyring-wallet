/**
 * page-berkolator.ts — Berkolator witness visualisation page (served at /berkolator)
 *
 * Reads the pre-built Three.js visualisation from the assets/witness-viz.html
 * template file and injects the witness name at runtime.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { WebServerConfig } from './WebServer'

const assetsDir = path.resolve(__dirname, '..', 'assets')

export function getWitnessVizHtml(config: WebServerConfig): string {
  return fs.readFileSync(path.join(assetsDir, 'witness-viz.html'), 'utf-8').replace(/\{\{WITNESS_NAME\}\}/g, config.name)
}
