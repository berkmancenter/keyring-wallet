// node --test scripts/roadmap/set-status.test.mjs   (a fake GitHub; made-up names only)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRef, planMove, run } from './set-status.mjs';

const P = 'PVT_test';
const OPTIONS = ['Requested', 'Under review', 'Planned', 'In progress', 'Testing', 'Shipped', 'Not planned'].map((name, i) => ({ id: `o${i}`, name }));

// A board with the given cards ({ 'acme/app#1': { title, status, shippedIn } }) and pull requests
// ({ 'acme/app#9': { title, body } }); returns the fake and the writes it received.
function github({ cards = {}, prs = {} }) {
  const writes = [];
  const gql = async (_token, query, v) => {
    if (query.includes('status:field(')) return { node: { status: { id: 'fStatus', options: OPTIONS }, shippedIn: { id: 'fShipped' } } };
    if (query.includes('issueOrPullRequest')) {
      const key = `${v.owner}/${v.repo}#${v.number}`;
      if (prs[key]) return { repository: { issueOrPullRequest: { __typename: 'PullRequest', ...prs[key] } } };
      const c = cards[key];
      if (!c) return { repository: { issueOrPullRequest: null } };
      const nodes = c.offBoard ? [] : [{ id: `item:${key}`, project: { id: P }, status: c.status ? { name: c.status } : null, shippedIn: c.shippedIn ? { text: c.shippedIn } : null }];
      return { repository: { issueOrPullRequest: { __typename: 'Issue', title: c.title, projectItems: { nodes } } } };
    }
    writes.push({ item: v.i, field: v.f, value: v.o ?? v.t });
    return {};
  };
  return { gql, writes };
}

const go = (gh, refs, extra = {}) => {
  const lines = [];
  return run({ refs: refs.map(parseRef), status: 'Testing', names: ['Quentin Marsh'], projectId: P, token: 't', gql: gh.gql, log: (l) => lines.push(l), ...extra })
    .then((r) => ({ ...r, lines }));
};

test('a card moves forward only, never back or out of Not planned', () => {
  assert.equal(planMove('Planned', 'Testing'), 'move');
  assert.equal(planMove('In progress', 'Testing'), 'move');
  assert.match(planMove('Testing', 'Testing'), /already/);
  assert.match(planMove('Shipped', 'Testing'), /already/);
  assert.match(planMove('Not planned', 'Testing'), /left alone/);
  assert.match(planMove(null, 'Testing'), /no status/);
});

test('refs: repo#N defaults the owner, owner/repo#N keeps it, anything else is refused', () => {
  assert.deepEqual(parseRef('keyring-wallet#12'), { owner: 'berkmancenter', repo: 'keyring-wallet', number: 12 });
  assert.deepEqual(parseRef('acme/app#3'), { owner: 'acme', repo: 'app', number: 3 });
  assert.equal(parseRef('#12'), null);
  assert.equal(parseRef('keyring-wallet 12'), null);
});

test("a pull request moves the cards it names with Refs, in its own and other repos, and sets Shipped in", async () => {
  const gh = github({
    prs: { 'acme/lib#9': { title: 'Fix the chat', body: 'Refs #1 and acme/app#2. Closes #5.' } },
    cards: { 'acme/lib#1': { title: 'Chat stops updating', status: 'In progress' }, 'acme/app#2': { title: 'Photos in chat', status: 'Planned' }, 'acme/lib#5': { title: 'Closed elsewhere', status: 'Planned' } },
  });
  const r = await go(gh, ['acme/lib#9'], { shippedIn: '276.2' });
  assert.deepEqual(gh.writes, [
    { item: 'item:acme/lib#1', field: 'fStatus', value: 'o4' },
    { item: 'item:acme/lib#1', field: 'fShipped', value: '276.2' },
    { item: 'item:acme/app#2', field: 'fStatus', value: 'o4' },
    { item: 'item:acme/app#2', field: 'fShipped', value: '276.2' },
  ]);
  assert.equal(r.skipped, 0);
});

test('running it again changes nothing, and a later release keeps the first Shipped in', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'Chat stops updating', status: 'Testing', shippedIn: '276.1' } } });
  const r = await go(gh, ['acme/app#1', 'acme/app#1'], { shippedIn: '276.2' });
  assert.deepEqual(gh.writes, []);
  assert.deepEqual(r.lines, ['acme/app#1: already Testing; left alone']);
});

test('a card moving without a Shipped in yet gets one; one that has it keeps it', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'Chat', status: 'Planned', shippedIn: '275' } } });
  await go(gh, ['acme/app#1'], { shippedIn: '276.2' });
  assert.deepEqual(gh.writes, [{ item: 'item:acme/app#1', field: 'fStatus', value: 'o4' }]);
});

test('a card already at Testing with no Shipped in gets one, without a status write', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'Chat', status: 'Testing' } } });
  const r = await go(gh, ['acme/app#1'], { shippedIn: '276.2' });
  assert.deepEqual(gh.writes, [{ item: 'item:acme/app#1', field: 'fShipped', value: '276.2' }]);
  assert.deepEqual(r.lines, ['acme/app#1: already Testing, Shipped in 276.2']);
});

test('a dry run of that backfill writes nothing, and a run with no release number leaves the card alone', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'Chat', status: 'Testing' } } });
  const dry = await go(gh, ['acme/app#1'], { shippedIn: '276.2', dryRun: true });
  assert.deepEqual(dry.lines, ['acme/app#1: already Testing, Shipped in 276.2 (dry run)']);
  const none = await go(gh, ['acme/app#1']);
  assert.deepEqual(none.lines, ['acme/app#1: already Testing; left alone']);
  assert.deepEqual(gh.writes, []);
});

test('a Shipped or Not planned card with no Shipped in is left alone', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'Chat', status: 'Shipped' }, 'acme/app#2': { title: 'Photos', status: 'Not planned' } } });
  await go(gh, ['acme/app#1', 'acme/app#2'], { shippedIn: '276.2' });
  assert.deepEqual(gh.writes, []);
});

test('the backfill goes through the scan too', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'Chat', status: 'Testing' } } });
  const r = await go(gh, ['acme/app#1'], { shippedIn: 'IN-90001' });
  assert.deepEqual(gh.writes, []);
  assert.equal(r.skipped, 1);
});

test('a board without the status or the Shipped in field stops with a sentence, not a TypeError', async () => {
  const board = (node) => ({ gql: async () => ({ node }) });
  await assert.rejects(go(board(null), ['acme/app#1']), /check ROADMAP_PROJECT_ID/);
  await assert.rejects(go(board({ status: { id: 'f', options: [] } }), ['acme/app#1']), /no "Testing" status/);
  await assert.rejects(go(board({ status: { id: 'f', options: OPTIONS }, shippedIn: null }), ['acme/app#1'], { shippedIn: '276.2' }), /no "Shipped in" field/);
});

test('a card that fails the scan is left alone and the run reports it', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'From Quentin Marsh', status: 'Planned' }, 'acme/app#2': { title: 'Photos in chat', status: 'Planned' } } });
  const r = await go(gh, ['acme/app#1', 'acme/app#2'], { shippedIn: '276.2' });
  assert.deepEqual(gh.writes.map((w) => w.item), ['item:acme/app#2', 'item:acme/app#2']);
  assert.equal(r.skipped, 1);
  assert.doesNotMatch(r.lines.join('\n'), /Quentin|Marsh/);
});

test('a Shipped in that is not clean is never written', async () => {
  const gh = github({ cards: { 'acme/app#1': { title: 'Photos in chat', status: 'Planned' } } });
  const r = await go(gh, ['acme/app#1'], { shippedIn: 'IN-90001' });
  assert.deepEqual(gh.writes, []);
  assert.equal(r.skipped, 1);
});

test('a dry run writes nothing; off-board cards, missing refs and PRs without Refs move nothing', async () => {
  const gh = github({
    prs: { 'acme/app#9': { title: 'Chore', body: 'See #1.' } },
    cards: { 'acme/app#1': { title: 'Photos in chat', status: 'Planned' }, 'acme/app#3': { title: 'Elsewhere', offBoard: true } },
  });
  const r = await go(gh, ['acme/app#1', 'acme/app#3', 'acme/app#4', 'acme/app#9'], { dryRun: true });
  assert.deepEqual(gh.writes, []);
  assert.deepEqual(r.lines, [
    'acme/app#4: not found; left alone',
    'acme/app#9: pull request with no Refs; nothing to move',
    'acme/app#1: Planned -> Testing (dry run)',
    'acme/app#3: not on the roadmap; left alone',
  ]);
});

test('only Testing is offered: Shipped waits for a public store release', async () => {
  await assert.rejects(go(github({}), ['acme/app#1'], { status: 'Shipped' }), /must be one of Testing/);
});
