#!/usr/bin/env node
/**
 * Reads one phone's log from a live-pickup device run (README, "Live message
 * pickup on two phones") and says whether pickup behaved: what the operator
 * cannot see on the screen.
 *
 *   node e2e/scripts/live-pickup-log-check.mjs <phone.log> [--json]
 *
 * The log is adb logcat or the iOS syslog for the app, captured for the whole
 * run. Counted, in order:
 *
 *   started      "Live message pickup started"         the app's live start (utils/livePickup.ts)
 *   restarting   "Live message pickup restarting (…)"  a failed check, socket closed, starting again
 *   failed       "… could not restart" / "… did not start"
 *   credoLive    "Starting Live Mode pickup of messages from mediator"   credo's own line, per live start
 *   credoPoll    "Starting explicit pickup of messages from mediator"    a polling start
 *
 * FAIL (exit 1):
 *   - no live start at all: the switch was off, or pickup never started;
 *   - more credo live starts than the app's starts plus restarts: something
 *     other than the controller started live mode, which would stack a second
 *     reconnect monitor (credo starts one per live start);
 *   - the LAST pickup start is a polling one, after going live: pickup fell
 *     back to polling while the switch was on (bifold's old hard-coded
 *     foreground restart). A polling start followed by a live one is normal:
 *     an agent (re)start begins with credo's configured polling, and the app
 *     moves it to live at once; those are reported as notes.
 * Reported, not failed: each restart with its reason, and failed starts (the
 * mediator restart scenario produces some by design).
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const PATTERNS = {
  started: /Live message pickup started/,
  restarting: /Live message pickup restarting \(([^)]*)\)/,
  failed: /Live message pickup (could not restart|did not start)/,
  credoLive: /Starting Live Mode pickup of messages from mediator '[^']*'(?! using v4)/,
  credoPoll: /Starting explicit pickup of messages from mediator '[^']*'(?! using v4)/,
}

export function checkLivePickupLog(text) {
  const counts = { started: 0, restarting: 0, failed: 0, credoLive: 0, credoPoll: 0 }
  const restartReasons = []
  const pollAfterLive = []
  let last = ''
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const [name, pattern] of Object.entries(PATTERNS)) {
      const match = pattern.exec(line)
      if (!match) continue
      counts[name]++
      if (name === 'restarting') restartReasons.push(match[1])
      if (name === 'credoPoll' && counts.credoLive > 0) pollAfterLive.push(index + 1)
      if (name === 'credoPoll' || name === 'credoLive') last = name
    }
  })

  const failures = []
  if (counts.started === 0 && counts.credoLive === 0) {
    failures.push('no live start: was "Live message pickup" on, and did the log cover the start?')
  }
  if (counts.credoLive > counts.started + counts.restarting) {
    failures.push(
      `${counts.credoLive} credo live starts but only ${counts.started} app starts + ${counts.restarting} restarts: ` +
        'something other than utils/livePickup.ts started live mode (a stacked reconnect monitor)'
    )
  }
  if (last === 'credoPoll' && counts.credoLive > 0) {
    failures.push(`pickup ended on polling after going live (polling starts at line(s) ${pollAfterLive.join(', ')})`)
  }
  const notes = pollAfterLive.length && last === 'credoLive' ? [`brief polling starts before going live again, at line(s) ${pollAfterLive.join(', ')}`] : []
  return { ok: failures.length === 0, counts, restartReasons, failures, notes }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, flag] = process.argv.slice(2)
  if (!file) {
    console.error('usage: live-pickup-log-check.mjs <phone.log> [--json]')
    process.exit(2)
  }
  const result = checkLivePickupLog(fs.readFileSync(file, 'utf8'))
  if (flag === '--json') console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${file}`)
    console.log(`  counts: ${JSON.stringify(result.counts)}`)
    for (const reason of result.restartReasons) console.log(`  restart: ${reason}`)
    for (const note of result.notes) console.log(`  note: ${note}`)
    for (const failure of result.failures) console.log(`  FAIL: ${failure}`)
  }
  process.exit(result.ok ? 0 : 1)
}
