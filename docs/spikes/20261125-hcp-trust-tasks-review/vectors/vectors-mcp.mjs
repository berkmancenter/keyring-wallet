#!/usr/bin/env node
// TT request payloads (accessToken stripped) against the inputSchema of HCP's MCP tool for the
// same operation (HCP 10.3.x, embedded in the spec as JSON). Writes out/vectors-mcp.txt.
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { OUT } from './lib.mjs';
import { check } from './validators.mjs';
const EX = JSON.parse(fs.readFileSync(`${OUT}/hcp-examples.json`, 'utf8'));
const TT = JSON.parse(fs.readFileSync(`${OUT}/vectors-tt-to-hcp.json`, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const tools = Object.fromEntries(EX.filter((e) => /^10\.3\./.test(e.heading)).map((e) => [e.json.name, e.json.inputSchema]));
const PAIRS = [['hcp_queryContext', 'entries/query'], ['hcp_getEntry', 'entries/get'], ['hcp_createEntry', 'entries/create'], ['hcp_reviseEntry', 'entries/revise'], ['hcp_withdrawEntry', 'entries/withdraw'], ['hcp_reportSharing', 'shares/report']];
let txt = `HCP MCP tools found: ${Object.keys(tools).join(', ')}\n\n`;
for (const [tool, slug] of PAIRS) {
  const v = ajv.compile(tools[tool]);
  const props = Object.keys(tools[tool].properties ?? {});
  txt += `${tool} (required ${JSON.stringify(tools[tool].required ?? [])}; members ${props.join(', ')}; additionalProperties ${JSON.stringify(tools[tool].additionalProperties)})\n`;
  for (const d of TT.filter((d) => d.slug === slug && d.side === 'request')) {
    const { accessToken, ...p } = d.payload;
    const ok = v(p);
    txt += `   ${ok ? 'PASS' : 'FAIL'} hcp/${slug} request [${d.src}]${ok ? '' : `: ${v.errors.slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`).join('; ')}`}\n`;
  }
}
fs.writeFileSync(`${OUT}/vectors-mcp.txt`, txt);
console.log(txt);
