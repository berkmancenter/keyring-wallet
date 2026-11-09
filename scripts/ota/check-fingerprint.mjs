/**
 * The native fingerprint a store build recorded, and the check that a bundle is
 * built for it (ota-publish.yml, ota-deploy.mjs).
 *
 *   node scripts/ota/check-fingerprint.mjs recorded --build <N> --platform <ios|android>
 *       prints the hash staging.yaml recorded in build N's tag (staging-v*-N),
 *       or exits 1 when the build recorded none
 *   node scripts/ota/check-fingerprint.mjs verify --platform <p> --expected <hash> [--recorded <fingerprint.json>]
 *       checks this checkout's app/fingerprint.json against it; exit 1, naming
 *       the differing sources when it can, if it is not the same
 *
 * Store builds record "OTA fingerprint <platform>: <hash>" in their annotated
 * tag (scripts/ota/record-fingerprint.sh). A phone is offered a bundle only when
 * the bundle's fingerprint equals its build's, so a publish for anything else
 * reaches nobody, silently. This makes that a refusal.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { diffFingerprints } from './fingerprint-report.mjs'

const HASH = /^[0-9a-f]{40}$/

/** The hash for `platform` in a tag message, or undefined. */
export const parseRecorded = (message, platform) => {
  const m = String(message ?? '').match(new RegExp(`^OTA fingerprint ${platform}: ([0-9a-f]{40})$`, 'm'))
  return m?.[1]
}

/**
 * Refuses (throws) unless the bundle's fingerprint is the expected one. With the
 * recorded fingerprint.json as well, the error names the sources that differ.
 * @param {{platform: string, actual: object, expected: string, recorded?: object}} input
 */
export const assertFingerprint = ({ platform, actual, expected, recorded }) => {
  if (!HASH.test(String(expected ?? ''))) {
    throw new Error(`no recorded ${platform} fingerprint to publish against; refusing (a bundle could reach nobody)`)
  }
  const hash = actual?.[platform]?.hash
  if (hash === expected) return hash
  let detail =
    ' (the target build recorded no source list here, so the differing sources cannot be named; see scripts/ota/fingerprint-report.mjs)'
  if (recorded?.[platform]) {
    const diff = diffFingerprints({ [platform]: recorded[platform] }, { [platform]: actual[platform] }).filter(
      (d) => d.platform === platform
    )
    detail = diff.length
      ? `; differing sources (build vs this checkout):\n${diff.map((d) => `  ${d.id}: ${d.a} vs ${d.b}`).join('\n')}`
      : '; no source differs, only the hash (fingerprint options differ?)'
  }
  throw new Error(
    `${platform} fingerprint ${
      hash ?? 'missing'
    } is not the target build's ${expected}: no phone on that build would be offered this bundle. Refusing${detail}`
  )
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-fingerprint.mjs')
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({
    args: rest,
    options: {
      build: { type: 'string' },
      platform: { type: 'string' },
      expected: { type: 'string' },
      recorded: { type: 'string' },
    },
  })
  if (!['ios', 'android'].includes(values.platform)) {
    console.error(
      'usage: check-fingerprint.mjs recorded --build <N> --platform <ios|android> | verify --platform <p> --expected <hash>'
    )
    process.exit(2)
  }
  if (cmd === 'verify') {
    const actual = JSON.parse(readFileSync('app/fingerprint.json', 'utf8'))
    const recorded =
      values.recorded && existsSync(values.recorded) ? JSON.parse(readFileSync(values.recorded, 'utf8')) : undefined
    try {
      const hash = assertFingerprint({ platform: values.platform, actual, expected: values.expected, recorded })
      console.log(`check-fingerprint: ${values.platform} fingerprint ${hash} is the target build's`)
      process.exit(0)
    } catch (error) {
      console.error(`check-fingerprint: ${error.message}`)
      process.exit(1)
    }
  }
  if (cmd !== 'recorded' || !/^[0-9]+$/.test(values.build ?? '')) {
    console.error('usage: check-fingerprint.mjs recorded --build <N> --platform <ios|android>')
    process.exit(2)
  }
  const tags = execFileSync('git', ['tag', '--list', `staging-v*-${values.build}`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  if (tags.length !== 1) {
    console.error(
      `check-fingerprint: build ${values.build}: expected one staging-v*-${values.build} tag, found ${tags.length}`
    )
    process.exit(1)
  }
  const message = execFileSync('git', ['for-each-ref', '--format=%(contents)', `refs/tags/${tags[0]}`], {
    encoding: 'utf8',
  })
  const hash = parseRecorded(message, values.platform)
  if (!hash) {
    console.error(
      `check-fingerprint: ${tags[0]} recorded no ${values.platform} fingerprint (built before store builds recorded one); refusing to publish for it`
    )
    process.exit(1)
  }
  console.log(hash)
}
