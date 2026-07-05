#!/usr/bin/env node
/**
 * Synthetic Dashboard Server
 *
 * Runs just the dashboard + WebSocket + mock data generation
 * without requiring the full Credo agent / WitnessService.
 * Useful for testing and demo purposes.
 *
 * Usage: npx ts-node src/dashboard-synthetic.ts
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { NetworkBroadcaster, NetworkEvent } from './NetworkBroadcaster'
import { generateNetworkHTML } from './network-ui'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

const PORT = parseInt(process.env.DASHBOARD_PORT || '9003', 10)
const NAME = process.env.WITNESS_NAME || 'Demo Witness'

const broadcaster = new NetworkBroadcaster()

const html = generateNetworkHTML({
  name: `${NAME} - Live Network`,
  subtitle: 'Live Witnessed Exchange Network',
  wsConnectMessage: 'Connected to witness server',
  actionControlsHTML: `
      <button class="ctrl-btn" id="btn-mock" onclick="window.toggleMock()">Start Mock Data</button>
      <button class="ctrl-btn danger" id="btn-reset" onclick="window.resetNetwork()">Reset</button>`,
  initialStateHandler: `
          for (const w of event.data.wallets) addNode(w.id, w.label, w.tooltip);
          for (const e of event.data.exchanges) addEdge(e.walletA, e.walletB, e.sessionId);`,
  extraEventCases: `
        case 'exchange-started':
          addLogEntry(event.data.labelA + ' \\u2194 ' + event.data.labelB + ' started', false);
          break;`,
  extraWindowFunctions: `
    let mockRunning = false;

    window.toggleMock = function() {
      mockRunning = !mockRunning;
      const btn = document.getElementById('btn-mock');
      if (mockRunning) {
        fetch('/api/mock/start', { method: 'POST' });
        btn.textContent = 'Stop Mock Data'; btn.classList.add('active');
      } else {
        fetch('/api/mock/stop', { method: 'POST' });
        btn.textContent = 'Start Mock Data'; btn.classList.remove('active');
      }
    };

    window.resetNetwork = function() {
      // Stop mock generation and reset the toggle button state
      if (mockRunning) {
        mockRunning = false;
        const mockBtn = document.getElementById('btn-mock');
        mockBtn.textContent = 'Start Mock Data';
        mockBtn.classList.remove('active');
      }
      fetch('/api/mock/reset', { method: 'POST' });
      clearScene();
      document.getElementById('event-log').innerHTML = '';
      addLogEntry('Network reset', false);
    };`,
})

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const urlPath = (req.url || '/').split('?')[0]

  if (urlPath === '/api/mock/start' && req.method === 'POST') {
    broadcaster.startMockGeneration(2500)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ status: 'started' }))
    return
  }
  if (urlPath === '/api/mock/stop' && req.method === 'POST') {
    broadcaster.stopMockGeneration()
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ status: 'stopped' }))
    return
  }
  if (urlPath === '/api/mock/reset' && req.method === 'POST') {
    broadcaster.stopMockGeneration()
    broadcaster.resetState()
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ status: 'reset' }))
    return
  }

  // Serve static JS file
  if (urlPath === '/network-runtime.js') {
    const jsPath = path.join(__dirname, '..', 'dist', 'network-runtime.js')
    if (existsSync(jsPath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
      res.end(readFileSync(jsPath))
      return
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('network-runtime.js not found. Run: yarn build:runtime')
      return
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
  res.end(html)
})

const wss = new WebSocketServer({ server, path: '/ws' })
const wsClients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  wsClients.add(ws)
  console.log(`[Network] Client connected (${wsClients.size} total)`)
  ws.send(JSON.stringify({ type: 'initial-state', timestamp: Date.now(), data: broadcaster.getState() }))
  ws.on('close', () => {
    wsClients.delete(ws)
    console.log(`[Network] Client disconnected (${wsClients.size} total)`)
  })
})

broadcaster.on('event', (event: NetworkEvent) => {
  const msg = JSON.stringify(event)
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  }
})

server.listen(PORT, () => {
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              WITNESS NETWORK (Synthetic)                   ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`  Network:    http://localhost:${PORT}`)
  console.log(`  WebSocket:  ws://localhost:${PORT}/ws`)
  console.log('')
  console.log('  Click "Start Mock Data" on the network to begin.')
  console.log('')
})
