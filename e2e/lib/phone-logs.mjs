#!/usr/bin/env node
// Tail the phones' own console output.
//
// React Native 0.81 does not print app logs to Metro's stdout — a captured
// Metro run holds only bundler progress. The logs are there, they just travel
// over the Chrome DevTools Protocol: Metro lists a debug target per device at
// /json/list, and `Runtime.consoleAPICalled` carries every console line. That
// is what this subscribes to.
//
// Written after a night spent inferring the wallet's decisions from what the
// SERVERS logged, which cost three rounds of narrowing that one line of the
// phone's own reasoning would have settled.
//
//   node lib/phone-logs.mjs                  follow every device
//   node lib/phone-logs.mjs TrustTasks       only lines matching a pattern
//   node lib/phone-logs.mjs '' out.log       follow all, also write to a file
import fs from 'node:fs'
// Node 20 has no global WebSocket (that arrived in 22); `ws` is already a
// dependency of the harness.
import WebSocket from 'ws'

const [, , pattern = '', outPath = ''] = process.argv
const match = pattern ? new RegExp(pattern, 'i') : undefined
const out = outPath ? fs.createWriteStream(outPath, { flags: 'a' }) : undefined

const emit = (line) => {
  process.stdout.write(`${line}\n`)
  out?.write(`${line}\n`)
}

// The e2e restarts the apps constantly, and every restart drops the CDP
// target. A tap that attaches once therefore goes quiet exactly when the run
// gets interesting — the applicant's logs were lost that way on the first
// attempt. So targets are re-polled and re-attached for as long as this runs.
const attached = new Map()

async function poll() {
  let targets = []
  try {
    targets = await (await fetch('http://localhost:8081/json/list')).json()
  } catch {
    return // Metro restarting; try again on the next tick
  }
  for (const target of targets) {
    // The Reanimated UI runtime is a second VM in the same app and carries
    // none of our logging, so it is skipped rather than doubling every line.
    if (/Reanimated/i.test(target.description ?? '')) continue
    const url = target.webSocketDebuggerUrl
    if (!url || attached.has(url)) continue
    const device = (target.title ?? '').replace(/.*\(([^)]+)\).*/, '$1') || 'device'
    let ws
    try {
      ws = new WebSocket(url)
    } catch {
      continue
    }
    attached.set(url, ws)
    let id = 0
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }))
      emit(`[phone-logs] attached to ${device}`)
    })
    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (msg.method !== 'Runtime.consoleAPICalled') return
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? (a.preview ? JSON.stringify(a.preview) : ''))
        .join(' ')
      if (!text) return
      if (match && !match.test(text)) return
      emit(`[${device}] ${text}`)
    })
    const drop = () => {
      if (attached.get(url) === ws) attached.delete(url)
    }
    ws.on('error', drop)
    ws.on('close', () => {
      drop()
      emit(`[phone-logs] ${device}: detached, will re-attach`)
    })
  }
}

await poll()
setInterval(poll, 2000)
