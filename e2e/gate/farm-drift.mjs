#!/usr/bin/env node
// Does the pnm that CI runners use still match the Farm? The CI build (.github/workflows/pnm-linux.yml) is pinned by
// hand to a VTI commit and its vta-service version (FARM_VTI_REF, FARM_VTI_VERSION): it moves with the Farm, never ahead.
// The Farm's own record is FARM_VERSIONS in the private farm.env, free text ("vta-service 0.56.0 (openapi …) · …").
// This compares the two versions; the workflow itself checks that the commit is that version's release tag.
//
//   node e2e/gate/farm-drift.mjs --farm "$FARM_VERSIONS"   -> prints one line; exit 0 match, 1 drift, 2 unknown
// gate.sh writes the line into every run's meta (farm-drift=), so a drifted pin shows on the report, loudly.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WORKFLOW = path.join(here, '..', '..', '.github', 'workflows', 'pnm-linux.yml');

/** The CI pin: { ref, version } from the workflow's env block. */
export function ciPin(text) {
  const get = (k) => (String(text).match(new RegExp(`^\\s*${k}:\\s*"?([^"\\s#]+)"?`, 'm')) || [])[1];
  return { ref: get('FARM_VTI_REF'), version: get('FARM_VTI_VERSION') };
}

/** The vta-service version in the Farm's free-text record, or undefined. */
export const farmVersion = (s) => (String(s || '').match(/vta-service\s+v?(\d+\.\d+\.\d+)/) || [])[1];

/** { exit, line }: 0 the pin matches the Farm, 1 they differ, 2 either side is unknown. */
export function drift({ pin, farm }) {
  const f = farmVersion(farm);
  if (!pin.version) return { exit: 2, line: 'UNKNOWN: pnm-linux.yml has no FARM_VTI_VERSION' };
  if (!f) return { exit: 2, line: `UNKNOWN: no "vta-service X.Y.Z" in the Farm's record ("${String(farm || 'unrecorded').slice(0, 60)}")` };
  if (f === pin.version) return { exit: 0, line: `OK: CI's pnm is pinned to vta-service ${pin.version} (${(pin.ref || '?').slice(0, 8)}), the Farm's version` };
  return { exit: 1, line: `DRIFT: CI's pnm is pinned to vta-service ${pin.version} (${(pin.ref || '?').slice(0, 8)}) but the Farm runs ${f}: move FARM_VTI_REF and FARM_VTI_VERSION in pnm-linux.yml with the Farm` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--farm');
  const farm = i > 0 ? process.argv[i + 1] : process.env.FARM_VERSIONS;
  let r;
  try { r = drift({ pin: ciPin(readFileSync(WORKFLOW, 'utf8')), farm }); } catch (e) { r = { exit: 2, line: `UNKNOWN: ${e.message}` }; }
  console.log(r.line);
  process.exitCode = r.exit;
}
