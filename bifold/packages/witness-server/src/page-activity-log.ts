/**
 * page-activity-log.ts — Activity log page (served at /log)
 *
 * Connects to the same /ws WebSocket feed as the dashboard:
 *
 *   • `initial-state`    → populates stat cards with historical totals
 *                          (loaded from the .reporting folder on startup)
 *   • `credential-issued` → prepends a live row to the activity table
 *   • `stats-update`     → refreshes stat cards
 *
 * Stat cards shown:
 *   1. Total VWCs Issued      — persistent (edges × 2) + live
 *   2. Witnessed Relationships — persistent (edge count) + live
 *   3. Unique Participants     — persistent (unique reporting DIDs) + live
 *   4. Active Sessions         — live only
 */

import type { WebServerConfig } from './WebServer'

export function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19)
}

export function generateActivityLogPage(config: WebServerConfig): string {
  const issuerDid = config.witnessService.getIssuerDid() || 'Not initialized'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.name} - Activity Log</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      padding: 20px;
    }

    .container { max-width: 1200px; margin: 0 auto; }

    /* ── Header ─────────────────────────────────────────────────────── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #333;
    }

    .header-left h1 { font-size: 22px; margin-bottom: 4px; }

    .ws-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #888;
      margin-top: 4px;
    }

    .nav-links { display: flex; gap: 8px; }

    .nav-link {
      color: #667eea;
      text-decoration: none;
      padding: 7px 14px;
      border: 1px solid #667eea;
      border-radius: 6px;
      font-size: 13px;
      white-space: nowrap;
    }
    .nav-link:hover { background: #667eea; color: white; }

    /* ── Issuer banner ───────────────────────────────────────────────── */
    .issuer-banner {
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
    }
    .issuer-label { color: #667eea; font-size: 10px; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; letter-spacing: 0.05em; }
    .issuer-did   { font-family: monospace; font-size: 12px; word-break: break-all; color: #ccc; }

    /* ── Stat cards ──────────────────────────────────────────────────── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }

    @media (max-width: 700px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }

    .stat-card {
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 16px 12px;
      text-align: center;
    }

    .stat-value { font-size: 36px; font-weight: 700; color: #667eea; line-height: 1; }
    .stat-label { font-size: 11px; color: #888; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.04em; }

    /* ── Activity section ────────────────────────────────────────────── */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #333;
    }

    .section-title { font-size: 17px; }
    .section-note  { font-size: 12px; color: #555; }

    /* ── Credentials table ───────────────────────────────────────────── */
    .log-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 32px;
    }

    .log-table th {
      background: #16213e;
      padding: 10px 8px;
      text-align: left;
      font-weight: 600;
      color: #667eea;
      border-bottom: 2px solid #0f3460;
      white-space: nowrap;
    }

    .log-table td {
      padding: 9px 8px;
      border-bottom: 1px solid #252545;
      font-family: monospace;
    }

    .log-table tr:hover td { background: #1e1e40; }
    .log-table tr.new-row td { animation: highlight 2.5s ease-out; }

    @keyframes highlight {
      0%   { background: #1a3a1a; }
      100% { background: transparent; }
    }

    .time-col    { width: 140px; }
    .session-col { width: 90px; color: #aaa; }
    .did-col     { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .digest-col  { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #aaa; }

    /* ── Empty / status states ───────────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: #555;
      border: 1px dashed #333;
      border-radius: 8px;
      margin-bottom: 32px;
    }
    .empty-state p + p { margin-top: 8px; font-size: 13px; color: #444; }

    /* ── WS dot ──────────────────────────────────────────────────────── */
    .ws-dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #555;
      flex-shrink: 0;
      transition: background 0.3s;
    }
    .ws-dot.connected { background: #28a745; animation: pulse 2s infinite; }
    .ws-dot.error     { background: #dc3545; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }

    .footer-note { text-align: center; color: #444; font-size: 11px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">

    <!-- Header -->
    <div class="header">
      <div>
        <h1>📊 ${config.name} — Activity Log</h1>
        <div class="ws-status">
          <span class="ws-dot" id="ws-dot"></span>
          <span id="ws-status">Connecting…</span>
        </div>
      </div>
      <div class="nav-links">
        <a href="/" class="nav-link">📱 QR Code</a>
        <a href="/network" class="nav-link">🌐 Network</a>
      </div>
    </div>

    <!-- Issuer DID -->
    <div class="issuer-banner">
      <div class="issuer-label">Witness Issuer DID</div>
      <div class="issuer-did">${issuerDid}</div>
    </div>

    <!-- Stat cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value" id="stat-participants">—</div>
        <div class="stat-label">Unique Participants</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-sessions">—</div>
        <div class="stat-label">Witnessed Relationships</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-total">—</div>
        <div class="stat-label">VWCs Issued</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-active">0</div>
        <div class="stat-label">Active Sessions</div>
      </div>
    </div>

    <!-- Live activity feed -->
    <div class="section-header">
      <h2 class="section-title">🔴 Live Activity</h2>
      <span class="section-note">New credential issuances appear here in real-time</span>
    </div>

    <div id="empty-state" class="empty-state">
      <p>Connecting to live feed…</p>
    </div>

    <table class="log-table" id="credentials-table" style="display:none;">
      <thead>
        <tr>
          <th class="time-col">Time</th>
          <th class="session-col">Session</th>
          <th class="did-col">VRC Issuer DID</th>
          <th class="did-col">Recipient DID</th>
          <th class="digest-col">VRC Digest</th>
        </tr>
      </thead>
      <tbody id="credentials-body"></tbody>
    </table>

    <p class="footer-note" id="last-updated"></p>
  </div>

  <script>
    // ── Helpers ──────────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id) }

    function truncateDid(did, maxLen) {
      if (!did) return '—'
      var s = typeof did === 'string' ? did : (did.id || String(did))
      if (s.length <= (maxLen || 32)) return s
      return s.substring(0, (maxLen || 32) - 3) + '...'
    }

    function fmt(isoStr) {
      return isoStr ? isoStr.replace('T', ' ').substring(0, 19) : '—'
    }

    function makeRow(entry, isNew) {
      var tr = document.createElement('tr')
      if (isNew) tr.className = 'new-row'
      var sessionShort = (entry.sessionId || '').substring(0, 8) + '…'
      tr.innerHTML =
        '<td class="time-col">'    + fmt(entry.issuedAt) + '</td>' +
        '<td class="session-col" title="' + (entry.sessionId || '') + '">' + sessionShort + '</td>' +
        '<td class="did-col"  title="' + (entry.vrcIssuerId  || '') + '">' + truncateDid(entry.vrcIssuerId,  32) + '</td>' +
        '<td class="did-col"  title="' + (entry.recipientDid || '') + '">' + truncateDid(entry.recipientDid, 32) + '</td>' +
        '<td class="digest-col" title="' + (entry.vrcDigest || '') + '">' + (entry.vrcDigest || '').substring(0, 18) + '…</td>'
      return tr
    }

    function prependRow(entry) {
      var tbody = el('credentials-body')
      tbody.insertBefore(makeRow(entry, true), tbody.firstChild)
      el('empty-state').style.display = 'none'
      el('credentials-table').style.display = ''
    }

    /**
     * Update stat cards from the server-authoritative stats object.
     * All counters originate from NetworkBroadcaster.getState().stats so that
     * the activity log and dashboard always reflect the same source of truth.
     *
     *   uniqueParticipants  = wallets.size  (same value as "Participants" on the dashboard)
     *   totalSessions       = historical edges + live sessions this server run
     *   totalCredentials    = historical VWCs + live VWCs this server run
     *   activeSessions      = currently open sessions (optional — may be absent)
     */
    function updateStats(stats) {
      if (!stats) return
      if (stats.totalCredentials   != null) el('stat-total').textContent        = stats.totalCredentials
      if (stats.totalSessions      != null) el('stat-sessions').textContent     = stats.totalSessions
      if (stats.uniqueParticipants != null) el('stat-participants').textContent = stats.uniqueParticipants
      if (stats.activeSessions     != null) el('stat-active').textContent       = stats.activeSessions
    }

    function setStatus(text, state) {
      el('ws-status').textContent = text
      el('ws-dot').className = 'ws-dot ' + (state || '')
    }

    function setLastUpdated() {
      el('last-updated').textContent =
        'Last updated: ' + new Date().toISOString().replace('T', ' ').substring(0, 19)
    }

    // ── WebSocket ────────────────────────────────────────────────────────────
    var ws, reconnectDelay = 1000

    function connect() {
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(proto + '//' + location.host + '/ws')

      ws.onopen = function() {
        setStatus('Live', 'connected')
        reconnectDelay = 1000
      }

      ws.onmessage = function(evt) {
        var msg
        try { msg = JSON.parse(evt.data) } catch(e) { return }

        if (msg.type === 'initial-state') {
          // Populate all stat cards from the server's authoritative stats.
          // uniqueParticipants comes from wallets.size (reporting DIDs) — the same
          // value that powers the "Participants" counter on the dashboard.
          var s = (msg.data || {}).stats || {}
          updateStats(s)
          // Activity table is live-only; show informative empty state
          el('empty-state').innerHTML =
            '<p>No activity yet this session.</p>' +
            '<p>Stat totals above include all historical exchanges loaded from the reporting graph.</p>'
          el('empty-state').style.display = ''
          setLastUpdated()
        }

        if (msg.type === 'credential-issued') {
          // Append the new credential row to the live activity table.
          // Stats (including uniqueParticipants) are updated via the stats-update
          // event that NetworkBroadcaster emits after every state change —
          // no independent client-side counter maintenance required.
          var entry = msg.data && msg.data.credential
          if (!entry) return
          prependRow(entry)
          setLastUpdated()
        }

        if (msg.type === 'stats-update') {
          // Authoritative stats push from the server — update all stat cards.
          updateStats((msg.data || {}).stats || msg.data)
        }
      }

      ws.onclose = function() {
        setStatus('Reconnecting…', 'error')
        setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      }

      ws.onerror = function() { setStatus('Connection error', 'error') }
    }

    connect()
  </script>
</body>
</html>`
}
