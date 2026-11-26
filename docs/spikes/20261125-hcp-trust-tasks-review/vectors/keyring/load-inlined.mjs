// Load the inlined PAYLOAD_SCHEMA and RESPONSE_PAYLOAD_SCHEMA constants of every hcp/* module
// from the pr1380 TypeScript library (tt-drift/trust-tasks-ts/src/hcp/**/payload.ts), read as text
// and JSON-parsed (the generator writes them as JSON object literals). Nothing is imported or built.
import fs from 'node:fs';
import path from 'node:path';

export const TS_HCP = `${process.env.HCP_REVIEW_ROOT ?? '.'}/tt-drift/trust-tasks-ts/src/hcp`;

function constant(text, name, file) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`export const ${name}:`));
  if (start < 0) throw new Error(`${file}: no ${name}`);
  const end = lines.findIndex((l, i) => i > start && l === '};');
  const body = [lines[start].slice(lines[start].indexOf('= {') + 2), ...lines.slice(start + 1, end), '}'].join('\n');
  return { schema: JSON.parse(body), line: start + 1 };
}

/** slug -> { request, response, file, reqLine, resLine } */
export function loadInlined() {
  const out = new Map();
  for (const f of fs.readdirSync(TS_HCP, { recursive: true })) {
    if (!f.endsWith('/0.1/payload.ts') || f.startsWith('_shared')) continue;
    const slug = f.replace(/\/0\.1\/payload\.ts$/, '');
    const file = path.join(TS_HCP, f);
    const text = fs.readFileSync(file, 'utf8');
    const req = constant(text, 'PAYLOAD_SCHEMA', file);
    const res = constant(text, 'RESPONSE_PAYLOAD_SCHEMA', file);
    out.set(slug, { request: req.schema, response: res.schema, file, reqLine: req.line, resLine: res.line });
  }
  return out;
}
