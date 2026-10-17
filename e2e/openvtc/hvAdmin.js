// The hv community's admin side, for the hv leg's drivers: the harness admin credential (community-admin on
// keyring-hv-lab1) through tsp-reference's vtc-admin.mjs. Every call is read-only except decide, grantVetter and
// removeMember, which only ever touch members the run itself made.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ADMIN = fileURLToPath(new URL('../../tsp-reference/ref-20-local-vetting/vtc-admin.mjs', import.meta.url));

/** vtc-admin's answer: the JSON after its log lines (`[ref-20] … -> <status>` then the payload). */
export function parseAdminOut(out) {
  const status = Number((out.match(/\[ref-20\] [^\n]*-> (\d+)/g) || []).pop()?.match(/(\d+)$/)?.[1] ?? 0);
  const i = [out.indexOf('{'), out.indexOf('[')].filter((x) => x >= 0).sort((a, b) => a - b)[0];
  let body;
  if (i !== undefined) {
    try { body = JSON.parse(out.slice(i)); } catch { body = undefined; }
  }
  return { status, body };
}

export function createHvAdmin({ vtcBase, communityDid, adminCredential }) {
  const run = (...args) => parseAdminOut(execFileSync('node', [ADMIN, vtcBase, communityDid, adminCredential, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }));
  return {
    members: () => run('members').body?.items ?? [],
    joinRequests: (status = 'pending') => {
      const b = run('join-list', status).body;
      return b?.items ?? b?.requests ?? (Array.isArray(b) ? b : []);
    },
    decide: (id, decision = 'approved') => run('join-decide', id, decision),
    grantVetter: (memberDid) => run('vetter-grant', memberDid),
    removeMember: (did, reason = 'hv leg cleanup') => run('member-remove', did, reason),
    /** vtc/vetting/hidden/show/0.1 for the criterion: { enabled, enrolledVetters: { label: n } }. */
    async hiddenShow(criterionId) {
      const { holderFromCredential, sendTask } = await import(ADMIN);
      const r = await sendTask(vtcBase, communityDid, holderFromCredential(adminCredential), 'https://trusttasks.org/spec/vtc/vetting/hidden/show/0.1', { criterionId });
      return r.body ?? {};
    },
  };
}

/** The newest pending join request made at or after `since` (ISO): the one this run's phone sent. */
export function newestRequestSince(requests, since) {
  return requests
    .filter((r) => String(r.createdAt ?? r.submittedAt ?? '') >= since)
    .sort((a, b) => String(b.createdAt ?? b.submittedAt).localeCompare(String(a.createdAt ?? a.submittedAt)))[0];
}

/** The member who joined at or after `since`, newest first. */
export function newestMemberSince(members, since) {
  return members
    .filter((m) => String(m.joinedAt ?? m.createdAt ?? '') >= since)
    .sort((a, b) => String(b.joinedAt ?? b.createdAt).localeCompare(String(a.joinedAt ?? a.createdAt)))[0];
}
