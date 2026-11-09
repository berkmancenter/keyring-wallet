#!/usr/bin/env node
// The public roadmap's privacy scan (docs/plans/public-roadmap-plan.md §7.1). Every text the roadmap automation is
// about to write to a public issue (title, body, labels, comments, sub-issue titles, branch and PR text) goes through
// scanItem() first, and nothing is written unless the verdict is "clean". Creating an issue in a public repository is
// publication, and GitHub keeps edit history, so this runs before the write, never after.
//
//   node scripts/roadmap/scan.mjs item.json --names names.txt | --no-names
//   exit 0 clean, 1 reject, 2 hold for approval, 3 bad input, 64 usage
//
// item.json is one item or an array: { title, body, labels: [], comments: [], branch, prTitle, prBody, subIssues: [] }.
// --names is the private list of reporter and maintainer names (one per line). It lives outside this repository and
// is never committed; the canary test uses a made-up one. It is required: a run that skips the names check must say
// so with --no-names, so a missing or empty list never passes as clean.
//
// The scan fails closed: unreadable input, an empty list of items, an item with no text, or a field of the wrong
// type is an error (exit 3), never "clean".

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Hosts a card may link to. Every other hostname is rejected: an internal one leaks infrastructure, and the list is
// short enough to extend on purpose.
export const ALLOWED_HOSTS = ['github.com', 'docs.github.com', 'github.blog', 'w3.org', 'www.w3.org', 'trusttasks.org', 'keyring.app'];

// Each rule: a name, a pattern, and what a match means. "reject" never publishes; "hold" waits for the triage owner.
const RULES = [
  ['report number', /\bIN-\d+\b/gi, 'reject'],
  ['DID', /\bdid:[a-z0-9]+:[^\s)\]]*/gi, 'reject'],
  ['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'reject'],
  ['IP address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'reject'],
  ['@ mention or e-mail', /(?<![\w`])@[A-Za-z0-9][\w.-]*/g, 'reject'],
  ['image or file', /!\[[^\]]*\]\([^)]*\)|<img\b|<video\b|user-attachments\/|\bhttps?:\/\/\S+\.(?:png|jpe?g|gif|webp|heic|mp4|mov|pdf|zip|txt|log)\b/gi, 'reject'],
  ['key or secret', /-----BEGIN [A-Z ]+-----|\b(?:z|u)[1-9A-HJ-NP-Za-km-z]{40,}\b|\b[A-Za-z0-9+_-]{40,}={0,2}(?![\w/])|\b[0-9a-f]{40,}\b/g, 'reject'],
  ['local file path', /(?:~|\/Users|\/home|\/private|\/tmp|\bDocuments|\bDownloads)\/[^\s)"'`]+/g, 'reject'],
  ['phone number', /\+\d[\d\s().-]{7,}\d/g, 'reject'],
  ['exact timestamp', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:Z|UTC)\b/g, 'reject'],
  ['device model or OS minor version', /\b(?:iPhone|iPad)\s?\d+|\bPixel\s?\d|\bGalaxy\s?[A-Z]\d+|\bSM-[A-Z]\d{3}|\b(?:iOS|iPadOS|Android)\s?\d+\.\d+/gi, 'reject'],
  ['session name', /\bkeyring-wallet-[0-9a-f]{2}\b|\b(?:lane|session)\s[0-9a-f]{2}\b/gi, 'reject'],
  ['security-sensitive wording', /\b(?:vulnerab\w*|exploit\w*|CVE-\d{4}|embargo\w*|leak\w*|exposure|exposed|bypass\w*|unencrypted|plaintext|private key|secret key|unauthori[sz]ed)\b/gi, 'hold'],
  // A long quotation: opens after a space or line start and closes before punctuation or a space, so the text
  // between two separate short quotes is never read as one.
  ['quoted message', /^>\s|“[^”]{60,}”|(?<=^|[\s(])"(?=\S)[^"\n]{60,}(?<=\S)"(?=[\s.,;:!?)]|$)/gm, 'hold'],
];

const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|dev|io|app|cloud|xyz|me|co|ai|edu|gov|tech|info|biz|us|uk|de|fr|br)\b/gi;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One text field. Returns the findings in it: [{ rule, match, action }].
export function scanText(text, { names = [] } = {}) {
  const findings = [];
  if (text == null || text === '') return findings;
  const s = String(text);
  for (const [rule, re, action] of RULES) {
    for (const m of s.matchAll(re)) {
      // A long run of word characters is a key only if it mixes digits and both cases; a URL path is words.
      if (rule === 'key or secret' && !m[0].startsWith('-----') && !/^[0-9a-f]+$/.test(m[0]) && !(/\d/.test(m[0]) && /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]))) continue;
      findings.push({ rule, match: m[0], action });
    }
  }
  for (const m of s.matchAll(HOST)) {
    const host = m[0].toLowerCase();
    if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) findings.push({ rule: 'hostname', match: m[0], action: 'reject' });
  }
  for (const name of names) {
    const n = name.trim();
    if (n.length < 2) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of s.matchAll(re)) findings.push({ rule: 'name', match: m[0], action: 'reject' });
  }
  return findings;
}

// Every text field of one item. The verdict is "reject" if anything must never be published, "hold" if a person
// must approve or rewrite it first, and "clean" only when nothing matched.
export function scanItem(item, opts = {}) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('an item must be an object');
  for (const k of ['labels', 'comments', 'subIssues']) {
    if (item[k] != null && !Array.isArray(item[k])) throw new TypeError(`${k} must be an array`);
  }
  const fields = [
    ['title', item.title], ['body', item.body], ['branch', item.branch], ['prTitle', item.prTitle], ['prBody', item.prBody],
    ...(item.labels ?? []).map((l, i) => [`labels[${i}]`, l]),
    ...(item.comments ?? []).map((c, i) => [`comments[${i}]`, c]),
    ...(item.subIssues ?? []).map((t, i) => [`subIssues[${i}]`, t]),
  ];
  // Anything that isn't text would be scanned as "[object Object]" and pass; refuse it instead.
  for (const [field, text] of fields) if (text != null && typeof text !== 'string') throw new TypeError(`${field} must be text`);
  if (!fields.some(([, text]) => text)) throw new TypeError('an item has no text to scan');
  const findings = fields.flatMap(([field, text]) => scanText(text, opts).map((f) => ({ field, ...f })));
  const verdict = findings.some((f) => f.action === 'reject') ? 'reject' : findings.length ? 'hold' : 'clean';
  return { verdict, findings };
}

export const readNames = (file) => readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ni = args.indexOf('--names');
  const nn = args.indexOf('--no-names');
  const namesFile = ni >= 0 ? args.splice(ni, 2)[1] : undefined;
  if (nn >= 0) args.splice(args.indexOf('--no-names'), 1);
  if (args.length !== 1 || (namesFile === undefined) === (nn < 0)) {
    console.error('usage: node scripts/roadmap/scan.mjs item.json --names names.txt | --no-names');
    process.exit(64);
  }
  const fail = (why) => {
    console.error(`scan: ${why}; nothing was scanned, so nothing is clean`);
    process.exit(3);
  };
  let names = [];
  let items;
  try {
    if (namesFile !== undefined) {
      names = readNames(namesFile);
      if (!names.length) fail('the names list is empty');
    }
    const input = JSON.parse(readFileSync(args[0] === '-' ? 0 : args[0], 'utf8'));
    items = Array.isArray(input) ? input : [input];
  } catch (e) {
    fail(`cannot read the input (${e.code ?? e.name})`);
  }
  if (!items.length) fail('there are no items');
  const rank = { clean: 0, hold: 1, reject: 2 };
  let worst = 'clean';
  items.forEach((item, i) => {
    let result;
    try {
      result = scanItem(item, { names });
    } catch (e) {
      fail(`item ${i}: ${e.message}`);
    }
    // The report names the item by index and each finding by rule and field, never the matched text or the title:
    // the report itself may be pasted somewhere.
    console.log(`${i}\t${result.verdict}`);
    for (const f of result.findings) console.log(`\t${f.action}\t${f.field}\t${f.rule}`);
    if (rank[result.verdict] > rank[worst]) worst = result.verdict;
  });
  process.exit({ clean: 0, reject: 1, hold: 2 }[worst]);
}
