#!/usr/bin/env node
// Pull every JSON example out of the HCP 2.0-draft-3 reading pages (indented code blocks).
// Writes out/hcp-examples.json: [{ id, file, line, heading, http, kind: 'object'|'fragment', template, json }]
import fs from 'node:fs';
import { extractJsonBlocks, HCP_ROOT, OUT } from './lib.mjs';

const files = ['spec/2.0-draft-3/specification.md', 'spec/2.0-draft-3/guides.md', 'spec/2.0-draft-3/introduction.md', 'spec/2.0-draft-3/path-to-v2-final.md'];
const PH = /\{[^{}"]*\}|\.\.\.|<[^>]+>/;
const isTemplate = (x) => {
  if (typeof x === 'string') return PH.test(x) || x.includes(' | ');
  if (Array.isArray(x)) return x.some(isTemplate);
  if (x && typeof x === 'object') return Object.values(x).some(isTemplate);
  return false;
};

const out = [];
const skipped = [];
for (const f of files) {
  const full = `${HCP_ROOT}/${f}`;
  if (!fs.existsSync(full)) continue;
  for (const b of extractJsonBlocks(full)) {
    let text = b.text;
    let http = null;
    const m = /^(HTTP\/1\.1 \d{3}[^\n]*|(?:GET|POST|PUT|DELETE|PATCH) \S+ HTTP\/1\.1)\n/.exec(text);
    if (m) {
      http = m[1];
      const idx = text.indexOf('\n\n');
      text = idx >= 0 ? text.slice(idx + 2).trim() : '';
      // a block can hold a request and then a response: split on a later HTTP start line
      const parts = text.split(/\n\n(?=HTTP\/1\.1 \d{3})/);
      text = parts[0];
      for (const extra of parts.slice(1)) {
        const j = extra.indexOf('\n\n');
        if (j >= 0) pushText(extra.slice(j + 2).trim(), extra.split('\n')[0], f, b);
      }
    }
    pushText(text, http, f, b);
  }
}
function pushText(text, http, f, b) {
  if (!text) return;
  let json;
  let kind;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      json = JSON.parse(text);
      kind = Array.isArray(json) ? 'array' : 'object';
    } catch (e) {
      skipped.push({ file: f, line: b.line, heading: b.heading, why: `not JSON: ${e.message.slice(0, 60)}`, head: text.slice(0, 70).replace(/\n/g, ' ') });
      return;
    }
  } else if (text.startsWith('"')) {
    try {
      json = JSON.parse(`{${text.replace(/,\s*$/, '')}}`);
      kind = 'fragment';
    } catch (e) {
      skipped.push({ file: f, line: b.line, heading: b.heading, why: `fragment not JSON: ${e.message.slice(0, 60)}`, head: text.slice(0, 70).replace(/\n/g, ' ') });
      return;
    }
  } else return; // not JSON at all (ABNF, HTTP without a body, prose)
  out.push({ id: `${f.split('/').pop().replace('.md', '')}:${b.line}`, file: f, line: b.line, heading: b.heading, http, kind, template: isTemplate(json), json });
}
fs.writeFileSync(`${OUT}/hcp-examples.json`, JSON.stringify(out, null, 1));
for (const e of out) console.log(`${e.id.padEnd(22)} ${e.kind.padEnd(8)} ${e.template ? 'TEMPLATE' : 'concrete'}  [${e.heading.slice(0, 48)}] ${e.http ?? ''}  keys: ${Object.keys(e.json).slice(0, 8).join(',')}`);
console.log(`\n${out.length} JSON examples; ${skipped.length} code blocks that start like JSON but do not parse:`);
for (const s of skipped) console.log('  ', s.file.split('/').pop(), s.line, `[${s.heading.slice(0, 40)}]`, s.why, '|', s.head);
