// stand-in for vta-mcp: one memory tool, pre-allowed by the project
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
const mcp = new Server({ name: 'vtamcp', version: '0.0.1' }, { capabilities: { tools: {} } })
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'memory_get', description: "Read the owner's memory", inputSchema: { type: 'object', properties: { key: { type: 'string' } } } }] }))
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  fs.appendFileSync(process.env.VTAMCP_LOG, JSON.stringify({ t: new Date().toISOString(), call: req.params }) + '\n')
  return { content: [{ type: 'text', text: 'memory: the owner likes tea' }] }
})
await mcp.connect(new StdioServerTransport())
