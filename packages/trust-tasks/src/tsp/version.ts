/**
 * The TSP versions this package names, and the version marker at the head of
 * every frame — owned here rather than read from `@openvtc/vti-tsp-js`.
 *
 * The marker is `YTSP` followed by a count code whose identifier is MAJOR and
 * whose 12-bit count is MINOR (spec §9.1): `YTSP-AAB` is 0.1 (Rev 2),
 * `YTSP-AAC` is 0.2 (Rev 3) and `YTSP-BAA` is 1.0 (the released
 * specification, trustoverip/tswg-tsp-specification@`ccda6b3`).
 *
 * Why the constants are ours. tsp-js carries one `TSP_VERSION`, the version it
 * packs, and its peek refuses every other MAJOR. That is right for a package
 * that speaks one version, and wrong for a codec that has to read two across
 * the TSP 1.0 cutover: tsp-js 0.4.0 moved `TSP_VERSION` to 1.0 and refuses
 * Rev 3, so reading it would switch what we write and what we accept in one
 * step. The CESR primitives stay tsp-js's; only which version to write, and how
 * to read one without judging it, live here.
 *
 * @module trust-tasks/tsp/version
 */

import { cesr, TspRevisionError } from '@openvtc/vti-tsp-js'

/** A TSP wire version: MAJOR gates processing, MINOR is carried. */
export interface TspVersion {
  readonly major: number
  readonly minor: number
}

/** Rev 2, `YTSP-AAB`. Read by the frozen Rev 2 codec, never packed by the wallet. */
export const TSP_REV2: TspVersion = Object.freeze({ major: 0, minor: 1 })
/** Rev 3, `YTSP-AAC`. What the wallet packs today. */
export const TSP_REV3: TspVersion = Object.freeze({ major: 0, minor: 2 })
/** TSP 1.0, `YTSP-BAA`. Named here so the marker is testable; nothing packs it yet. */
export const TSP_V1: TspVersion = Object.freeze({ major: 1, minor: 0 })

/** Write the `YTSP-###` marker for `version`. */
export function encodeTspVersion(version: TspVersion, out: number[]): void {
  for (const b of cesr.YTSP) out.push(b)
  cesr.encodeCount(version.major, version.minor, out)
}

/** The marker for `version` as bytes, e.g. `61 34 8f f8 00 02` for Rev 3. */
export function tspVersionBytes(version: TspVersion): Uint8Array {
  const out: number[] = []
  encodeTspVersion(version, out)
  return new Uint8Array(out)
}

/**
 * Read the version marker at the head of a frame, without keys and without
 * judging it: any MAJOR comes back as read. Throws `TspRevisionError` only when
 * the bytes are not a TSP frame, or the marker is missing or malformed.
 *
 * The marker follows the `-E` count code, whose width the leading byte gives
 * (3 bytes short, 6 long, `0xFB`); that framing is the same in Rev 2, Rev 3
 * and 1.0, so this runs before the version is known.
 */
export function readTspVersion(bytes: Uint8Array): TspVersion {
  if (!cesr.isTsp(bytes)) throw new TspRevisionError('tsp: not a TSP frame (no -E count code)')
  const cur: cesr.Cursor = { pos: bytes[0] === cesr.TSP_MAGIC_BYTE_LONG ? 6 : 3 }
  const version = cesr.readVersion(bytes, cur)
  if (version === undefined) throw new TspRevisionError('tsp: missing or malformed YTSP version marker')
  return { major: version.major, minor: version.minor }
}

/** Whether two versions are the same MAJOR.MINOR. */
export function sameTspVersion(a: TspVersion, b: TspVersion): boolean {
  return a.major === b.major && a.minor === b.minor
}
