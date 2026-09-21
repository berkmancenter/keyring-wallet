#!/usr/bin/env node

// Waits for an uploaded build to finish processing in App Store Connect, sets
// its TestFlight "What to Test" text, and adds it to the named beta groups.
// External groups also get the build submitted for Beta App Review.
//
// Works with a team API key (ASC_ISSUER_ID set) or an individual API key
// (ASC_ISSUER_ID empty). No dependencies: Node 20's fetch and crypto.
//
// Env: ASC_KEY_ID, ASC_KEY_PATH, ASC_ISSUER_ID (optional), BUNDLE_ID,
//      APP_VERSION (MAJOR.MINOR.PATCH), BUILD_NUMBER, BETA_GROUPS (comma-separated),
//      WHATS_NEW (optional), PROCESSING_TIMEOUT_MINUTES (optional, default 45)

import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

const keyId = env('ASC_KEY_ID')
const issuerId = process.env.ASC_ISSUER_ID || ''
const privateKey = readFileSync(env('ASC_KEY_PATH'))
const bundleId = env('BUNDLE_ID')
const appVersion = env('APP_VERSION')
const buildNumber = env('BUILD_NUMBER')
const groupNames = env('BETA_GROUPS')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const whatsNew = (process.env.WHATS_NEW || '').slice(0, 4000)
const timeoutMs = Number(process.env.PROCESSING_TIMEOUT_MINUTES || 45) * 60 * 1000

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

// Tokens live at most 20 minutes, so mint a fresh one per request.
const token = () => {
  const now = Math.floor(Date.now() / 1000)
  const claims = issuerId
    ? { iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }
    : { sub: 'user', iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }
  const unsigned = `${base64url({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${base64url(claims)}`
  const signature = createSign('SHA256')
    .update(unsigned)
    .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url')
  return `${unsigned}.${signature}`
}

const api = async (method, path, body) => {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const error = json.errors?.[0]
    const detail = error ? `${error.code}: ${error.detail || error.title}` : text
    throw Object.assign(new Error(`${method} ${path} → ${response.status} ${detail}`), {
      status: response.status,
    })
  }
  return json
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  const apps = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name`)
  const app = apps.data[0]
  if (!app) throw new Error(`No app with bundle id ${bundleId} is visible to this key`)
  console.log(`App: ${app.attributes.name} (${app.id})`)

  // Resolve the groups first, so a wrong name fails before the long wait.
  const allGroups = await api('GET', `/v1/apps/${app.id}/betaGroups?fields[betaGroups]=name,isInternalGroup&limit=200`)
  const groups = groupNames.map((name) => {
    const group = allGroups.data.find((g) => g.attributes.name === name)
    if (!group) throw new Error(`No beta group named "${name}" on ${app.attributes.name}`)
    return group
  })

  // The build shows up a few minutes after the upload, then processes.
  const deadline = Date.now() + timeoutMs
  let build
  for (;;) {
    const builds = await api(
      'GET',
      `/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(buildNumber)}` +
        `&filter[preReleaseVersion.version]=${encodeURIComponent(appVersion)}&fields[builds]=processingState`
    )
    build = builds.data[0]
    const state = build?.attributes.processingState ?? 'NOT_YET_VISIBLE'
    console.log(`Build ${appVersion} (${buildNumber}): ${state}`)
    if (state === 'VALID') break
    if (state === 'FAILED' || state === 'INVALID') throw new Error(`Build processing ended in ${state}`)
    if (Date.now() > deadline) throw new Error(`Build still ${state} after ${timeoutMs / 60000} minutes`)
    await sleep(30_000)
  }

  if (whatsNew) {
    const localizations = await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations`)
    const existing = localizations.data.find((l) => l.attributes.locale === 'en-US') ?? localizations.data[0]
    if (existing) {
      await api('PATCH', `/v1/betaBuildLocalizations/${existing.id}`, {
        data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew } },
      })
    } else {
      await api('POST', '/v1/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: 'en-US', whatsNew },
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      })
    }
    console.log('What to Test set')
  }

  let external = false
  for (const group of groups) {
    const name = group.attributes.name
    await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, {
      data: [{ type: 'builds', id: build.id }],
    })
    external ||= !group.attributes.isInternalGroup
    console.log(`Added to "${name}" (${group.attributes.isInternalGroup ? 'internal' : 'external'})`)
  }

  if (external) {
    try {
      await api('POST', '/v1/betaAppReviewSubmissions', {
        data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
      })
      console.log('Submitted for Beta App Review (external groups)')
    } catch (error) {
      if (error.status !== 409) throw error
      console.log('Already submitted for Beta App Review')
    }
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
