import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { agents } from './agents.js';
import { join } from './join.js';

// Every `agents.<x>(` and `join.<x>(` a driver writes must be a step of that page object. The dry run 1011-0039 lost
// R11 to `agents.readOwnerCode(d)`, a function exported beside the object, not one of its steps. Only a run that
// reached R11 could find that; this finds it without one.
const E2E = new URL('../../', import.meta.url);
const files = [
  ...readdirSync(E2E).filter((f) => /\.m?js$/.test(f)).map((f) => new URL(f, E2E)),
  ...readdirSync(new URL('lib/pages/', E2E)).filter((f) => /\.js$/.test(f)).map((f) => new URL(`lib/pages/${f}`, E2E)),
];

for (const [name, page] of Object.entries({ agents, join })) {
  test(`every ${name}.<step>( call in the drivers is a step of ${name}`, () => {
    const missing = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(new RegExp(`\\b${name}\\.([A-Za-z]+)\\(`, 'g'))) {
        if (typeof page[m[1]] !== 'function') missing.push(`${f.pathname.split('/e2e/')[1]}: ${name}.${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  });
}
