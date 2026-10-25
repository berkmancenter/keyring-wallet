// The community's own member list, every page of it. vtc-service lists 50
// members per page (routes/members/read.rs, `nextCursor`); the lab community
// passed 50 members on 2026-09-25, and a check that read only the first page
// reported a member it had just admitted as missing.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const admin = fileURLToPath(new URL('../../tsp-reference/ref-20-local-vetting/vtc-admin.mjs', import.meta.url));

/** Every member of the community, following `nextCursor` to the last page. */
export function allMembers({ vtcBase, communityDid, adminCredential }) {
  const members = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const out = execFileSync(
      'node',
      [admin, vtcBase, communityDid, adminCredential, 'members', ...(cursor ? [cursor] : [])],
      { encoding: 'utf8' },
    );
    const body = JSON.parse(out.slice(out.indexOf('{', out.indexOf('->'))));
    if (!Array.isArray(body.items)) throw new Error(`the community's member list came back without items: ${out.slice(0, 200)}`);
    members.push(...body.items);
    cursor = body.nextCursor;
    if (!cursor) return members;
  }
  throw new Error('the community member list did not end within 100 pages');
}
