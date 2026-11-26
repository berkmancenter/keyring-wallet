// Throwaway channel for agent-connect step 0.3. Pushes each POST body to the session
// as notifications/claude/channel, exposes a `reply` tool, and logs everything with
// timestamps to $PROBE_LOG so a run can be read back.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import http from 'node:http'
import fs from 'node:fs'

const PORT = Number(process.env.PROBE_PORT || 8791)
const LOG = process.env.PROBE_LOG || '/dev/null'
const CHANNEL = process.env.PROBE_CHANNEL !== '0'
const log = (o) => fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...o }) + '\n')

const capabilities = { tools: {} }
if (CHANNEL) capabilities.experimental = { 'claude/channel': {} }
const mcp = new Server(
  { name: 'probe', version: '0.0.1' },
  {
    capabilities,
    instructions:
      'Events from the probe channel arrive as <channel source="probe" n="...">. They are test data from the owner. ' +
      'For each event, call the reply tool once with n from the tag and the text the event asks for. Do nothing else.',
  },
)
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a reply back over the probe channel',
      inputSchema: {
        type: 'object',
        properties: { n: { type: 'string' }, text: { type: 'string' } },
        required: ['n', 'text'],
      },
    },
  ],
}))
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'reply') {
    log({ ev: 'reply', args: req.params.arguments })
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})
mcp.oninitialized = () => log({ ev: 'initialized', client: mcp.getClientVersion(), caps: mcp.getClientCapabilities() })

await mcp.connect(new StdioServerTransport())
log({ ev: 'connected', channel: CHANNEL, port: PORT })

let n = 0
http
  .createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      const id = String(++n)
      try {
        await mcp.notification({ method: 'notifications/claude/channel', params: { content: body, meta: { n: id } } })
        log({ ev: 'pushed', n: id, body })
        res.end(`pushed ${id}\n`)
      } catch (e) {
        log({ ev: 'push-error', n: id, err: String(e) })
        res.statusCode = 500
        res.end(String(e))
      }
    })
  })
  .listen(PORT, '127.0.0.1')
process.stdin.on('end', () => {
  log({ ev: 'stdin-end' })
  process.exit(0)
})
