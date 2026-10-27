// node --test scripts/roadmap/scan.test.mjs   (made-up names and identifiers only; never real ones)
// The canary suite of docs/plans/public-roadmap-plan.md §7.1: the scan must reject every canary, and a scan that
// passes any of them blocks creation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanItem, scanText } from './scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const names = ['Quentin Marsh', 'Ylva'];

const CANARIES = {
  'a display name from the names list': 'Quentin Marsh says the chat froze.',
  'a single-word display name': 'Reported by ylva after an update.',
  'a UUID': 'Sender 3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f saw it twice.',
  'a DID': 'The agent did:webvh:QmFakeScid123:agents.example refused it.',
  'an IP address': 'It failed against 10.20.30.40 on the lab network.',
  'an internal-style hostname': 'The relay at mediator.internal-lab.dev dropped it.',
  'an IN- number': 'Same as IN-90001, reported again.',
  'an @ handle': 'Thanks @someone-real for the report.',
  'an e-mail address': 'Contact tester@example.org for logs.',
  'an embedded image': 'Here is the screen: ![screenshot](https://example.org/x.png)',
  'an attachment link': 'Log: https://github.com/user-attachments/files/123/report.txt',
  'a key': 'Key z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK leaked.',
  'an exact timestamp': 'It started at 2026-10-27T18:20:10Z.',
  'a time of day': 'It started at 18:20 UTC.',
  'a device model': 'Seen on an iPhone 15 only.',
  'an OS minor version': 'Only on iOS 26.1 so far.',
  'a session name': 'keyring-wallet-ff picked it up.',
  'a phone number': 'Call +1 617 555 0100 about it.',
  'a local file path': 'Screens are in Documents/some-folder/236/README.md for now.',
};

for (const [what, text] of Object.entries(CANARIES)) {
  test(`canary: ${what} is rejected`, () => {
    assert.equal(scanItem({ title: 'A title', body: text }, { names }).verdict, 'reject');
  });
}

test('without a names list every canary except the names still rejects, in the library and through --no-names', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'roadmap-scan-'));
  try {
    const f = path.join(d, 'items.json');
    const others = Object.entries(CANARIES).filter(([what]) => !what.includes('name from') && !what.includes('display name'));
    for (const [what, text] of others) assert.equal(scanItem({ title: 'A title', body: text }).verdict, 'reject', what);
    writeFileSync(f, JSON.stringify(others.map(([, text]) => ({ title: 'A title', body: text }))));
    const out = execFileSync('node', [path.join(here, 'scan.mjs'), f, '--no-names'], { encoding: 'utf8', stdio: 'pipe' }).toString();
    assert.fail(`--no-names passed the canaries: ${out}`);
  } catch (e) {
    if (e.code === 'ERR_ASSERTION') throw e;
    assert.equal(e.status, 1);
    assert.equal(e.stdout.split('\n').filter((l) => /^\d+\treject$/.test(l)).length, Object.keys(CANARIES).length - 2);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('every field is scanned, not only the body', () => {
  for (const field of ['title', 'branch', 'prTitle', 'prBody']) {
    assert.equal(scanItem({ [field]: 'see IN-90002' }).verdict, 'reject', field);
  }
  for (const field of ['labels', 'comments', 'subIssues']) {
    const r = scanItem({ title: 'ok', [field]: ['fine', 'see IN-90002'] });
    assert.equal(r.verdict, 'reject', field);
    assert.equal(r.findings[0].field, `${field}[1]`);
  }
});

test('a card written to the card standard is clean', () => {
  const body = [
    '**What this is:** Photos you send in a chat show inside the conversation, not as a file to open.',
    '**Why it matters:** Sharing a picture with a contact works the way people expect from a messenger.',
    '**Where it stands:** Planned for the next release.',
    '',
    '<details>',
    '<summary>Technical details</summary>',
    '',
    'Plan: https://github.com/berkmancenter/keyring-wallet/blob/main/docs/plans/rich-messaging-plan.md',
    'Refs berkmancenter/keyring-wallet#561, keyring-bifold#600. Shipped in 0.2.1. Seen on an Android phone, recently.',
    '</details>',
  ].join('\n');
  const r = scanItem({ title: 'Photos in chat', body, labels: ['area:chat', 'community'] }, { names });
  assert.deepEqual(r.findings, []);
  assert.equal(r.verdict, 'clean');
});

test('version numbers, issue refs and backticked code are not mistaken for IPs, handles or keys', () => {
  assert.deepEqual(scanText('Shipped in 0.2.1, release 275, VTA 0.65.0, #561, `@bifold/core`.'), []);
});

test('security wording and long quotes are held for a person, not published and not silently dropped', () => {
  assert.equal(scanItem({ title: 'A backup exposure on some phones' }).verdict, 'hold');
  assert.equal(scanItem({ body: '> the app froze when I opened the chat' }).verdict, 'hold');
  assert.equal(scanItem({ body: '"I opened the chat and nothing happened, then it closed by itself after a minute"' }).verdict, 'hold');
});

test('two short quoted UI strings in one sentence are not read as one long quotation', () => {
  assert.deepEqual(scanText('Tapping "Join" on a community\'s screen sends a plain request at once, and "Cancel" withdraws it before anyone sees it.'), []);
});

test('a name matches as a whole word only, in any case', () => {
  assert.deepEqual(scanText('Ylvasson and analysis are fine', { names }), []);
  assert.equal(scanText('YLVA wrote in', { names })[0].rule, 'name');
});

test('CLI: exit 0 clean, 1 reject (even beside a hold), 2 hold; the report never prints the matched text', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'roadmap-scan-'));
  try {
    const n = path.join(d, 'names.txt');
    writeFileSync(n, '# private list\nQuentin Marsh\n');
    const cli = (...args) => {
      try {
        return { code: 0, out: execFileSync('node', [path.join(here, 'scan.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' }) };
      } catch (e) {
        return { code: e.status, out: e.stdout };
      }
    };
    const run = (items, ...flags) => {
      const f = path.join(d, 'items.json');
      writeFileSync(f, JSON.stringify(items));
      return cli(f, ...(flags.length ? flags : ['--names', n]));
    };
    assert.equal(run([{ title: 'Photos in chat' }]).code, 0);
    assert.equal(run([{ title: 'A leak somewhere' }]).code, 2);
    const mixed = run([{ title: 'A leak somewhere' }, { title: 'From Quentin Marsh' }]);
    assert.equal(mixed.code, 1);
    assert.doesNotMatch(mixed.out, /Quentin|Marsh/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('fails closed: no input, no items, no text, wrong types or no names list is an error, never clean', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'roadmap-scan-'));
  try {
    const f = path.join(d, 'items.json');
    const n = path.join(d, 'names.txt');
    writeFileSync(n, 'Quentin Marsh\n');
    const code = (args, items) => {
      if (items !== undefined) writeFileSync(f, typeof items === 'string' ? items : JSON.stringify(items));
      try {
        execFileSync('node', [path.join(here, 'scan.mjs'), ...args], { stdio: 'pipe' });
        return 0;
      } catch (e) {
        return e.status;
      }
    };
    assert.equal(code([path.join(d, 'missing.json'), '--names', n]), 3, 'unreadable input');
    assert.equal(code([f, '--names', n], 'not json'), 3, 'bad JSON');
    assert.equal(code([f, '--names', n], []), 3, 'no items');
    assert.equal(code([f, '--names', n], [{}]), 3, 'an item with no text');
    assert.equal(code([f, '--names', n], [{ title: 'ok', labels: 'area:chat' }]), 3, 'labels not an array');
    assert.equal(code([f, '--names', n], [{ title: { text: 'IN-90003' } }]), 3, 'a field that is not text');
    assert.equal(code([f, '--names', n], [null]), 3, 'an item that is not an object');
    assert.equal(code([f], [{ title: 'Photos in chat' }]), 64, 'neither --names nor --no-names');
    assert.equal(code([f, '--names', n, '--no-names'], [{ title: 'Photos in chat' }]), 64, 'both');
    writeFileSync(path.join(d, 'empty.txt'), '# nothing\n');
    assert.equal(code([f, '--names', path.join(d, 'empty.txt')], [{ title: 'Photos in chat' }]), 3, 'empty names list');
    assert.equal(code([f, '--no-names'], [{ title: 'Photos in chat' }]), 0, 'an explicit --no-names');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('scanItem refuses what it cannot scan instead of calling it clean', () => {
  assert.throws(() => scanItem({}), /no text/);
  assert.throws(() => scanItem(null), /object/);
  assert.throws(() => scanItem({ title: 'ok', comments: 'x' }), /array/);
  assert.throws(() => scanItem({ title: 42 }), /text/);
});
