// The openvtc TUI's side of the interop harness, one function per step a
// maintainer takes, driven through the real binary (lib/openvtcTui.js). The
// mirror of e2e/lib/keyringRoles.js on the Keyring side: each step waits for the
// TUI's own line (cited from TUI_MAP.md), records one JSONL row, and throws with
// the screen attached.
//
// Verified against ed13d29 on the local lab, 2026-09-25: launch, menu, the
// desk, and the vetter's whole run — ticket, request, session, card, attest,
// "Statement signed and sent." (Phase 1 run A) — and joinByInvitation. The
// applicant section at the end is written from source and not yet run.
//
// Two openvtc builds are driven: ed13d29 (upstream main when this was written)
// and 177a218, our pin in external/openvtc (an ancestor, 42 commits behind).
// Every step branches on tui.version where the two differ, and cites 177a218's
// file:line for its strings (read from source 2026-09-25, NOT yet run against
// a 177a218 binary). Where a string is the same in both, one citation (ed13d29)
// stands; 177a218's line is given alongside when it moved.

import { selectedLine, walkTo } from './listWalk.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { OpenvtcTui } from '../lib/openvtcTui.js';

/** Builds driven with ed13d29's screens. Anything else is driven as 177a218. */
const CURRENT_STYLE = ['ed13d29'];

/**
 * Whether `tui` is driven as 177a218 (our pin). A version is "current"
 * (ed13d29-style) only when it is listed in CURRENT_STYLE; any other version is
 * driven as 177a218. OPENVTC_TUI_STYLE=current|177a218 overrides, for a build
 * newer than ed13d29 that is not listed yet.
 */
export function at177(tui) {
  const forced = process.env.OPENVTC_TUI_STYLE;
  if (forced === 'current') return false;
  if (forced === '177a218') return true;
  const v = String(tui?.version ?? '').toLowerCase();
  return !CURRENT_STYLE.some((c) => v.length >= 7 && (v.startsWith(c) || c.startsWith(v)));
}

/** The citation for this build: `current` at ed13d29, `pin` (a 177a218 file:line) otherwise. */
function src(tui, current, pin) {
  return at177(tui) ? `[177a218] ${pin}` : current;
}

/** The content panel as one string with all whitespace removed, so a DID wrapped across rows reads whole. */
function flatPanel(screen) {
  return panelRows(screen).join('').replace(/\s+/g, '');
}

/** Start the fixture's TUI and bring it to the main page. */
export async function launch({ bin, version, dir, profile, role = 'openvtc-vetter', log }) {
  const tui = new OpenvtcTui({
    bin,
    version,
    configDir: dir,
    profile,
    role,
    log,
    env: { OPENVTC_THEME: 'dark', OPENVTC_DEBUG_LOG: path.join(dir, `debug-${profile}.log`) },
  }).start(['--unlock-code-file', path.join(dir, 'unlock-code')]);
  // Loaded = phase 1 complete. The body says "Press [ENTER] to continue" (or
  // "Press [ENTER] to acknowledge … and continue"), but with many personas the
  // startup list pushes that line below the 50-row screen (18 did, 2026-09-26),
  // so the footer's "[ENTER] continue", drawn only once complete and with no
  // diagnosis, counts too (openvtc ed13d29 ui/pages/loading/mod.rs:652-696).
  await tui.waitFor(/Press \[ENTER\] to (continue|acknowledge)|\[ENTER\] continue/, {
    timeoutMs: 120000,
    step: 'tui.loaded',
    source: 'ui/pages/loading/mod.rs:652-696',
  });
  tui.press('Enter');
  await tui.waitFor('Communities', { timeoutMs: 30000, step: 'tui.main' });
  return tui;
}

/** Vetting → content → the desk tab (verified). */
export async function openDesk(tui) {
  await tui.selectMenu('Vetting');
  await tui.pressEach(['Enter'], 800);
  await tui.waitFor('Vetting desk (', { step: 'vetter.vettingPage', source: src(tui, 'ui/pages/main/vetting_panel.rs:165-175', 'ui/pages/main/components/vetting_panel.rs:163-172') });
  if (!/Requests \(\d+\)\s+Tickets \(\d+\)/.test(tui.screen())) await tui.pressEach(['Tab'], 800);
  await tui.waitFor(/Requests \(\d+\)\s+Tickets \(\d+\)\s+Issued \(\d+\)/, { step: 'vetter.desk', source: src(tui, 'ui/pages/main/vetting_panel.rs:1425-1445', 'ui/pages/main/components/vetting_panel.rs:1086-1106') });
  if (tui.screen().includes('No community has named you a vetter yet')) {
    throw tui.failure('vetter.seat', new Date(), 'the TUI holds no vetter grant ("No community has named you a vetter yet")');
  }
  return tui;
}

/**
 * Move the desk's selection (▸) onto a row that `isWanted` accepts. The desk
 * keeps every run's request and grows (8 rows on 2026-09-25, when a fixed walk
 * of six stopped short); walkTo covers any length. True once selected.
 */
async function selectDeskRow(tui, isWanted) {
  return walkTo(tui, (screen) => screen.split('\n').some((l) => l.includes('▸') && isWanted(l)));
}

/**
 * Decline every request still open on the desk (accepted, session open, or
 * card verified). The fixture's vetter vets only for the harness, so an open
 * request at the start of a run was left by an earlier run, and would share
 * the new request's state and take its selection. x → "Decline this
 * request?" → y (vetting_panel.rs:602-625, :1511-1513; vetting_actions.rs:356).
 */
const OPEN_STATES = ['accepted — open a session when you are together', 'session open — waiting for their card', 'card verified — check the person, then attest or decline'];
export async function declineStale(tui) {
  await deskView(tui, 'Requests');
  const openRows = () => tui.screen().split('\n').filter((l) => OPEN_STATES.some((st) => l.includes(st)));
  let declined = 0;
  // One decline per open row, however many earlier runs left.
  for (let guard = openRows().length; guard > 0 && openRows().length > 0; guard--) {
    if (!(await selectDeskRow(tui, (l) => OPEN_STATES.some((st) => l.includes(st))))) throw tui.failure('vetter.declineStale', new Date(), 'could not select an open request to decline');
    await tui.pressEach(['x'], 800);
    await tui.waitFor('Decline this request?', { step: 'vetter.declineConfirm', source: src(tui, 'ui/pages/main/components/vetting_panel.rs:603', 'ui/pages/main/components/vetting_panel.rs:404') });
    await tui.pressEach(['y'], 2000);
    declined++;
  }
  if (openRows().length > 0) throw tui.failure('vetter.declineStale', new Date(), `${openRows().length} open request(s) left after declining`);
  tui.record('vetter.declineStale', true, new Date(), { value: declined });
  return declined;
}

/** Move the desk to one of its views: Requests, Tickets or Issued (←/→). */
export async function deskView(tui, view) {
  const marker = { Requests: /No one has asked you|accepted —|session open —|card verified —|statement signed/, Tickets: /You have no tickets out|Read aloud|t: hand out a ticket/, Issued: /You have not signed any vetting statements|signed/ }[view];
  for (let i = 0; i < 3; i++) {
    if (marker.test(tui.screen())) return tui;
    await tui.pressEach(['Right'], 700);
  }
  await tui.waitFor(marker, { step: `vetter.view.${view}`, timeoutMs: 3000 });
  return tui;
}

/**
 * Issue a ticket and return its `vetting-ticket:` link, scraped from the
 * Tickets view where it is the last content line before the key hints and
 * wraps across rows (vetting_panel.rs:1686).
 */
export async function issueTicket(tui) {
  await deskView(tui, 'Tickets');
  await tui.pressEach(['t'], 800);
  await tui.waitFor('Hand out a ticket', { step: 'vetter.ticketForm', source: src(tui, 'ui/pages/main/vetting_panel.rs:543', 'ui/pages/main/components/vetting_panel.rs:344') });
  await tui.pressEach(['Enter'], 1500);
  // ed13d29: "Ticket {code} for {community} — press ⏎ to show its QR code, or u
  // to copy its link. …"; 177a218: "Ticket {code} for {community} — read it to
  // the person, or copy it with y. It admits …" (vetting_actions.rs:2006-2011).
  // The pattern stops before the part that differs.
  const issued = await tui.waitFor(/Ticket ([0-9A-Z]{4}-[0-9A-Z]{4}) for /, { step: 'vetter.ticketIssued', source: src(tui, 'state_handler/vetting_actions.rs:2260', 'state_handler/vetting_actions.rs:2006-2011'), timeoutMs: 30000 });
  const code = issued[1];
  // The link shown is the SELECTED ticket's (vetting_panel.rs:1665-1686); with
  // older tickets out, select this one by its code before reading the link.
  const selected = () => new RegExp(`Read aloud\\s+${code}`).test(tui.screen());
  // The tickets view grows by one every run; its position is the ticket read aloud.
  await walkTo(tui, selected, { pace: 600, state: (screen) => screen.match(/Read aloud\s+(\S+)/)?.[1] ?? selectedLine(screen) });
  if (!selected()) throw tui.failure('vetter.ticketSelect', new Date(), `could not select ticket ${code} on the Tickets view`);
  await tui.pressEach(['End'], 800);
  const uri = scrapeTicketUri(tui.screen());
  if (!uri) throw tui.failure('vetter.ticketUri', new Date(), `no vetting-ticket: link for ticket ${code} on the Tickets view`);
  // Same layout in both builds: the link is the last content line before the
  // key hints (177a218 vetting_panel.rs:1344, ed13d29 :1686).
  tui.record('vetter.ticketUri', true, new Date(), { value: uri, tuiSource: src(tui, 'ui/pages/main/vetting_panel.rs:1686', 'ui/pages/main/components/vetting_panel.rs:1344') });
  return uri;
}

/**
 * The ticket link from the content panel. It wraps across rows with no spaces,
 * so the rows after the one it starts on are joined only while each is a single
 * run of link characters; the next line of text (the key hints) ends it.
 */
export function scrapeTicketUri(screen) {
  const rows = panelRows(screen);
  const start = rows.findIndex((r) => r.includes('vetting-ticket:?'));
  if (start < 0) return undefined;
  let uri = rows[start].slice(rows[start].indexOf('vetting-ticket:?'));
  for (let i = start + 1; i < rows.length && /^[A-Za-z0-9%._~&=:-]+$/.test(rows[i]); i++) uri += rows[i];
  return /^vetting-ticket:\?[A-Za-z0-9%._~&=:-]+$/.test(uri) ? uri : undefined;
}

/**
 * The content panel's rows, borders stripped and trimmed. The content panel's
 * borders are ║ (the menu's are │, and sit on the same row).
 */
export function panelRows(screen) {
  return screen.split('\n').map((l) => {
    const a = l.indexOf('║');
    const b = l.lastIndexOf('║');
    return (a >= 0 && b > a ? l.slice(a + 1, b) : l.replace(/^.*?│/, '').replace(/│.*$/, '')).trim();
  });
}

/**
 * A request with a valid ticket is accepted without a key press
 * (inbound.rs:526-549). The desk keeps earlier runs' requests, and the session,
 * card and attest keys act on the SELECTED row, so select the accepted one.
 */
export async function awaitRequest(tui, { timeoutMs = 180000 } = {}) {
  const ACCEPTED = 'accepted — open a session when you are together';
  await deskView(tui, 'Requests');
  await tui.waitFor(ACCEPTED, { step: 'vetter.requestAccepted', source: src(tui, 'state_handler/vetting_actions.rs:335', 'state_handler/vetting_actions.rs:338'), timeoutMs });
  if (!(await selectDeskRow(tui, (l) => l.includes(ACCEPTED)))) throw tui.failure('vetter.requestSelect', new Date(), 'could not select the accepted request on the desk');
}

/**
 * Open the session and return the match code. The first attempt may only ask
 * the community which claims it requires; the step then opens it again
 * (vetting_actions.rs:2304, :2351).
 */
export async function openSession(tui) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await tui.pressEach(['o'], 800);
    await tui.waitFor('Open a session', { step: 'vetter.sessionForm', source: src(tui, 'ui/pages/main/vetting_panel.rs:567-600', 'ui/pages/main/components/vetting_panel.rs:372') });
    await tui.pressEach(['Enter'], 1500);
    const m = await tui.waitFor(/Session open\. Read the match code ([0-9A-Z]{4}-[0-9A-Z]{4})|Asking the community which claims it requires/, {
      step: `vetter.sessionOpen.${attempt}`,
      source: src(tui, 'state_handler/vetting_actions.rs:2304, :2351', 'state_handler/vetting_actions.rs:2052, :2099'),
      timeoutMs: 60000,
    });
    if (m[1]) {
      await tui.waitFor('Session sent — waiting for their card.', { step: 'vetter.sessionSent', source: src(tui, 'state_handler/vetting_actions.rs:3368', 'state_handler/vetting_actions.rs:2866'), timeoutMs: 60000 });
      return m[1];
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw tui.failure('vetter.sessionOpen', new Date(), 'the session did not open after asking the community for its claims');
}

/** The card arrives and the TUI verifies it with the VTI SDK. */
export async function awaitCard(tui, { timeoutMs = 180000 } = {}) {
  await tui.waitFor('card verified — check the person, then attest or decline', {
    step: 'vetter.cardVerified',
    source: src(tui, 'state_handler/vetting_actions.rs:347', 'state_handler/vetting_actions.rs:350'),
    timeoutMs,
  });
}

/**
 * Attest: tick "We read the code" and "I attest" (Space), keep the default
 * method, documentation and relationship, and sign (Enter).
 */
export async function attest(tui) {
  await tui.pressEach(['a'], 1000);
  await tui.waitFor('Check the person, then attest', { step: 'vetter.attestForm', source: src(tui, 'ui/pages/main/vetting_panel.rs:1531', 'ui/pages/main/components/vetting_panel.rs:1189') });
  // Fields: Method, Documentation, Relationship, We read the code, I attest
  // (content.rs:2583-2597; the same five at 177a218, vetting_panel.rs:1225-1277,
  // Down = next field and Space ticks, ui/pages/main/mod.rs:2493-2513).
  await tui.pressEach(['Down', 'Down', 'Down', ' ', 'Down', ' '], 400);
  await tui.pressEach(['Enter'], 1500);
  await tui.waitFor('Statement signed and sent.', { step: 'vetter.statementSent', source: src(tui, 'state_handler/vetting_actions.rs:3372', 'state_handler/vetting_actions.rs:2870'), timeoutMs: 60000 });
}

/**
 * Join a community with an invitation (VIC) as one persona, and return only
 * once the TUI has STORED the membership credential. "Join request sent." is
 * not a membership: the community's credential arrives seconds later, and a
 * TUI closed before it is stored stays Pending for good — at VTI a96fe02f the
 * community has no member-credential resend, and openvtc's id-less status poll
 * finds only open requests (vtc-service routes/join_requests/status.rs:111-126),
 * so an approved join answers NotFound. The assertion is the TUI's own log line
 * (openvtc-core/src/messaging.rs:945, kind Membership activates, lib.rs:341).
 */
export async function joinByInvitation(tui, { vic, community, personaLabel, debugLog, timeoutMs = 120000 }) {
  const since = new Date().toISOString();
  await tui.selectMenu('Communities');
  await tui.pressEach(['Enter'], 1200);
  await tui.pressEach(['j'], 1500);
  // Same prompt text in both builds; at 177a218 the invitation lines sit above
  // the input instead of below it (vtc_enter_did.rs:118, :197).
  await tui.waitFor("Enter the community's DID or agent name:", { step: 'join.enterDid', source: src(tui, 'ui/pages/join_flow/vtc_enter_did.rs:134', 'ui/pages/join_flow/vtc_enter_did.rs:118'), timeoutMs: 15000 });
  tui.type('\x1b[200~' + vic + '\x1b[201~');
  await tui.waitFor('Invitation credential loaded', { step: 'join.vicLoaded', source: src(tui, 'ui/pages/join_flow/mod.rs:213', 'ui/pages/join_flow/vtc_enter_did.rs:197'), timeoutMs: 15000 });
  // The pasted VIC fills the community's DID; typing it again would double it.
  if (!tui.screen().includes(community.split(':').pop())) throw tui.failure('join.vicCommunity', new Date(), 'the VIC did not fill the community DID');
  tui.press('Enter');
  if (at177(tui)) {
    // 177a218 has no "Choose how to join" page. Enter on the DID asks the
    // community whether it vets (state_handler/join_flow.rs:602-641): the
    // " Joining {name} " page shows "Asking {name} what it requires before you
    // join…", then "{name} vets the people who join." or "Could not learn
    // whether {name} vets…" (ui/pages/join_flow/vetting_requirements.rs:150,
    // :168, :191). J on it is "join without waiting" / "join anyway" (:61;
    // state_handler/mod.rs:1201-1209 while asking), which goes on to the persona
    // choice (join_flow.rs:856-890, :915-968). A community that does not vet
    // goes straight there.
    const NEXT = /Choose the persona this community will know you as:|what it requires before you join…|vets the people who join\.|Could not learn whether .* vets the people who join/;
    for (let i = 0; i < 4; i++) {
      const at = await tui.waitFor(NEXT, { step: `join.how.${i + 1}`, source: 'ui/pages/join_flow/vetting_requirements.rs:150, :168, :191; identity_choice.rs:151', timeoutMs: 60000 });
      if (String(at[0]).startsWith('Choose the persona')) break;
      if (tui.screen().includes('Joining now presents your')) {
        throw tui.failure('join.how', new Date(), 'the community vets, and a satisfied vetting application would take this join (J joins as its persona) — not an invitation join', 'ui/pages/join_flow/vetting_requirements.rs:243; state_handler/join_flow.rs:856-872');
      }
      await tui.pressEach(['j'], 2000);
    }
  } else {
    await tui.waitFor('Choose how to join', { step: 'join.how', source: 'state_handler/join_flow.rs:206', timeoutMs: 60000 });
    if (!/▸ Use an invitation/.test(tui.screen())) throw tui.failure('join.how', new Date(), '"Use an invitation" is not the selected way to join');
    await tui.pressEach(['Enter'], 1500);
  }
  await tui.waitFor('Choose the persona this community will know you as:', { step: 'join.persona', source: src(tui, 'ui/pages/join_flow/identity_choice.rs', 'ui/pages/join_flow/identity_choice.rs:151'), timeoutMs: 30000 });
  await walkTo(tui, (screen) => new RegExp(`▸ ${personaLabel}\\s+\\(1 invitation\\)`).test(screen), { pace: 500 });
  if (!new RegExp(`▸ ${personaLabel}\\s+\\(1 invitation\\)`).test(tui.screen())) throw tui.failure('join.persona', new Date(), `the invited persona "${personaLabel}" is not selectable`);
  // Then Enter through: the linkage warning (Y/Enter, identity_choice.rs:44),
  // the invitation step, on the loaded VIC (invitation_choice.rs:93), and a
  // context choice if one is asked (context_choice.rs:73) — the same at 177a218.
  await tui.pressEach(['Enter'], 4000);
  for (let i = 0; i < 5 && !/Join request sent\.|Join failed/.test(tui.screen()); i++) await tui.pressEach(['Enter'], 4000);
  const sent = await tui.waitFor(/Join request sent\.|Join failed\. Nothing was activated\./, { step: 'join.sent', source: 'ui/pages/join_flow/join_progress.rs:103, :195', timeoutMs: 90000 });
  if (!String(sent[0]).startsWith('Join request sent')) throw tui.failure('join.sent', new Date(), sent[0]);
  return awaitMembershipStored(tui, { community, debugLog, since, timeoutMs, step: 'join.membershipStored' });
}

/**
 * From the join's progress page ("Join request sent."), leave it and wait for
 * the TUI to STORE the community's membership credential — the assertion both
 * joins share (see joinByInvitation for why "sent" is not a membership). The
 * log line is openvtc-core/src/messaging.rs:945; kind Membership activates
 * (lib.rs:341). Returns the log line.
 */
export async function awaitMembershipStored(tui, { community, debugLog, since, timeoutMs = 120000, step = 'join.membershipStored' }) {
  const stored = new RegExp(`stored issued credential vtc=${escapeRe(community)} credential_kind=Membership`);
  // Leave the progress page: the community's reply and credentials are applied
  // only then. Measured 2026-09-25 (ed13d29, lab): they arrived at 06:53:35 and
  // were stored at 06:53:52, the moment Enter left the page; a first join that
  // never left it lost its membership when the TUI closed.
  await tui.pressEach(['Enter'], 1000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = readLog(debugLog).split('\n').find((l) => l.slice(0, 27) >= since && stored.test(l));
    if (hit) {
      tui.record(step, true, new Date(), { value: hit.slice(0, 27), tuiSource: src(tui, 'openvtc-core/src/messaging.rs:945', 'openvtc-core/src/messaging.rs:944-951') });
      return hit;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw tui.failure(step, new Date(), `no "stored issued credential … Membership" in ${timeoutMs} ms — do NOT close a TUI in this state by hand; the join cannot be recovered`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readLog(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Lines of the TUI's own log that matter for vetting, since some refusals are silent on screen (VTI-Q24). */
export function vettingLogLines(dir, profile, since) {
  let text = '';
  try {
    text = readFileSync(path.join(dir, `debug-${profile}.log`), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((l) => (!since || l.slice(0, 27) >= since) && /vetting (card|statement|request|document) refused|vetting session not opened|vetting acceptance not applied|vetting acceptance for no request of ours|vetting session for a community we are not applying to|could not send vetting reply/.test(l));
}

// ============================================================ applicant
//
// The TUI as the person being vetted, paired with a Keyring vetter
// (keyringRoles.vetter). Written from source at ed13d29 (2026-09-25), NOT yet
// run: every string is cited, and the first run is what verifies them.
//
// Rules this side keeps, beyond the vetter's:
// - One application per (community, persona) (openvtc-core vetting/book.rs:754-771).
//   Every earlier run's application stays listed under the same community
//   name, so a step selects THIS persona's application by its "Joining as"
//   line before acting: `r`, `c`, `f` and `j` act on the highlighted one
//   (ui/pages/main/mod.rs:2805-2836).
// - Request rows are not selectable; they are the highlighted application's
//   "Vetters" block (vetting_panel.rs:880-929). Counts are taken before the
//   request goes out, so a row an earlier run left is never read as this one.
// - Some refusals are silent on screen and only logged (VTI-Q24): each wait on
//   an answer also polls the debug log and fails fast on one.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The warn!/info! lines openvtc logs when it drops a vetter's answer to an applicant (openvtc-core/src/vetting/inbound.rs). */
const APPLICANT_REFUSALS =
  /vetting statement refused|vetting session not opened|vetting session for a community we are not applying to|vetting acceptance not applied|vetting acceptance for no request of ours|vetting document refused/;

/** The first debug-log line at or after `since` (ISO) that matches `re`. */
function logLineSince(debugLog, since, re) {
  return readLog(debugLog)
    .split('\n')
    .find((l) => l.slice(0, 27) >= since && re.test(l));
}

/** A did:webvh as openvtc shortens it for "Joining as" (openvtc-core display.rs:137-156, SCID kept 4+4). */
export function webvhShort(did, keep = 4) {
  const parts = did.split(':');
  if (parts[1] !== 'webvh' || !parts[2] || parts[2].length <= keep * 2 + 1) return did;
  const scid = parts[2];
  return did.replace(scid, `${scid.slice(0, keep)}…${scid.slice(-keep)}`);
}

/** The last segment of a DID (a webvh persona's path), which survives every shortening (display.rs:183-204). */
function didTail(did) {
  return did.split(':').pop();
}

/** Return focus to the main menu: Esc leaves a form, then the content panel; on the menu it does nothing (ui/pages/main/mod.rs:155-187). */
async function toMenu(tui) {
  await tui.pressEach(['Esc', 'Esc'], 500);
}

// The applicant's request states (state_handler/vetting_actions.rs:265-300).
const REQUEST_STATE = /^(sent — waiting for the vetter|accepted — .+|session open — read the code together, then send your card(\s+code \S+)?|card sent — waiting for their statement(\s+code \S+)?|statement received|declined|refused \(.+\))$/;
const OPEN_REQUEST = /^(sent — |accepted — |session open — |card sent — )/;

/** The highlighted application's "Vetters" block (vetting_panel.rs:880-929), or undefined when it is not on screen. */
function vettersBlock(screen) {
  const rows = panelRows(screen);
  const start = rows.findIndex((r) => r === 'Vetters');
  if (start < 0) return undefined;
  const end = rows.findIndex((r, i) => i > start && r.startsWith('n: new  f: face'));
  return rows.slice(start + 1, end < 0 ? undefined : end).filter(Boolean);
}

function requestStates(screen) {
  return (vettersBlock(screen) ?? []).filter((r) => REQUEST_STATE.test(r));
}

function countStates(states) {
  const c = { accepted: 0, session: 0, card: 0, statement: 0, declined: 0, refused: 0, sent: 0 };
  for (const s of states) {
    if (s.startsWith('sent — ')) c.sent++;
    else if (s.startsWith('accepted — ')) c.accepted++;
    else if (s.startsWith('session open — ')) c.session++;
    else if (s.startsWith('card sent — ')) c.card++;
    else if (s === 'statement received') c.statement++;
    else if (s === 'declined') c.declined++;
    else if (s.startsWith('refused (')) c.refused++;
  }
  return c;
}

/** A labelled line of the highlighted application ("Requires", "Progress", "Next"; vetting_panel.rs:825-856). */
function appLine(screen, label) {
  const row = panelRows(screen).find((r) => r.startsWith(`${label} `));
  return row?.slice(label.length).trim();
}

/**
 * Create a persona: My Identity → Personas → `n`, a name, Enter, and let the
 * server pick the path (Enter on the path page). Returns the persona DID.
 *
 * The DID on screen is not reliable: the Done overlay draws it unwrapped in a
 * 96-column box (create_persona_overlay.rs:102, :299-302), so a long did:webvh
 * is clipped. The full DID is read from the TUI's own log instead — every mint
 * passes create_did_via_server, which logs it as a `did=` field either
 * "minted persona advertises #tsp" (debug) or "minted persona has no #tsp
 * service" (warn) (state_handler/setup_sequence/vta.rs:524-532). The screen's
 * copy must be a prefix of it. Only when the log has no line does the screen
 * copy stand, and only if it is short enough not to have been clipped.
 */
export async function createPersona(tui, { name, debugLog, timeoutMs = 120000 }) {
  const since = new Date().toISOString();
  const started = new Date();
  await toMenu(tui);
  await tui.selectMenu('My Identity');
  await tui.pressEach(['Enter'], 1200);
  // Personas is one of six tabs, marked only by colour; its content is
  // " N persona(s)" or "You have no personas yet." (identity_panel.rs:305, :319).
  const onPersonas = () => panelRows(tui.screen()).some((r) => /^\d+ personas?$/.test(r) || r === 'You have no personas yet.');
  for (let i = 0; i < 6 && !onPersonas(); i++) await tui.pressEach(['Right'], 800);
  if (!onPersonas()) throw tui.failure('applicant.personasTab', started, 'could not reach My Identity → Personas');
  await tui.pressEach(['n'], 1500);
  const pin = at177(tui);
  // 177a218's overlay (" Create persona DID ", drawn in ui/pages/main/mod.rs)
  // asks for a label, the path, then a CONTEXT: "Where should this persona's
  // keys and DID live?" (:3144), whose first row — the default — is a new
  // sub-context named after the label (state_handler/create_persona.rs:44-58;
  // openvtc-core config/community_context.rs:148-152). Enter takes it, so the
  // persona's keys live in <top>/<slug>, and an application by it is presented
  // from that context (vetting_actions.rs:1815-1822).
  await tui.waitFor(pin ? 'Label for the new persona:' : 'What should this persona be called?', {
    step: 'applicant.personaName',
    source: src(tui, 'ui/pages/create_persona_overlay.rs:144', 'ui/pages/main/mod.rs:3065'),
    timeoutMs: 10000,
  });
  await tui.pressEach([...name], 40);
  await tui.pressEach(['Enter'], 1000);
  await tui.waitFor("Where should this persona's DID live on the hosting server?", {
    step: 'applicant.personaPath',
    source: src(tui, 'ui/pages/create_persona_overlay.rs:190', 'ui/pages/main/mod.rs:3088'),
    timeoutMs: 20000,
  });
  // "⏎ create   p: choose the path yourself" (:280): Enter lets the server pick.
  // 177a218: "Server-assigned" is the first row (mod.rs:3110), Enter goes on.
  await tui.pressEach(['Enter'], 500);
  if (pin) {
    await tui.waitFor("Where should this persona's keys and DID live?", { step: 'applicant.personaContext', source: 'ui/pages/main/mod.rs:3144', timeoutMs: 20000 });
    const context = tui.screen().split('\n').find((l) => l.includes('▸ '))?.replace(/^.*?▸ /, '').replace(/[│║].*$/, '').trim();
    tui.record('applicant.personaContext', true, started, { value: context, tuiSource: '[177a218] ui/pages/main/mod.rs:3144-3157' });
    await tui.pressEach(['Enter'], 500);
  }
  // Done ends "c: copy again   ⏎/esc close" (:311); Failed ends "⏎/esc close" (:324).
  await tui.waitFor('⏎/esc close', { source: src(tui, 'ui/pages/create_persona_overlay.rs:311, :324', 'ui/pages/main/mod.rs:3216, :3229'), timeoutMs });
  if (!tui.screen().includes('✓ Persona created')) throw tui.failure('applicant.personaCreated', started, 'the persona was not created (the overlay shows its Failed page)', src(tui, 'ui/pages/create_persona_overlay.rs:316-325', 'ui/pages/main/mod.rs:3220-3230'));
  const shown = tui.screen().match(/did:webvh:[A-Za-z0-9]+:[^\s│║]+/)?.[0];
  let did;
  for (const until = Date.now() + 15000; !did && Date.now() < until; ) {
    did = logLineSince(debugLog, since, /minted persona/)?.match(/\bdid=(did:[^\s"]+)/)?.[1];
    if (!did) await sleep(500);
  }
  if (did && shown && !did.startsWith(shown)) {
    throw tui.failure('applicant.personaCreated', started, `the screen shows ${shown} but the log minted ${did}`);
  }
  let from = `debug log (state_handler/setup_sequence/vta.rs:${pin ? '447-452 at 177a218' : '524-532'})`;
  if (!did) {
    if (!shown || shown.length >= 88) throw tui.failure('applicant.personaCreated', started, `no "minted persona … did=" line in ${debugLog}, and the DID on screen may be clipped (${shown})`);
    did = shown;
    from = 'screen (create_persona_overlay.rs:299-302)';
  }
  tui.record('applicant.personaCreated', true, started, { value: did, tuiState: '✓ Persona created', tuiSource: `${src(tui, 'ui/pages/create_persona_overlay.rs:295', 'ui/pages/main/mod.rs:3200')}; DID from ${from}` });
  await tui.pressEach(['Enter'], 1000); // "⏎/esc close"
  return did;
}

/** Vetting → content → the Applications tab. */
export async function openApplications(tui) {
  await toMenu(tui);
  await tui.selectMenu('Vetting');
  await tui.pressEach(['Enter'], 800);
  await tui.waitFor(/ Applications \(\d+\) /, { step: 'applicant.vettingPage', source: 'ui/pages/main/components/vetting_panel.rs:165-175' });
  // The tabs are marked by colour only; the desk is recognised by its views line (:1425-1445).
  if (/Requests \(\d+\)\s+Tickets \(\d+\)/.test(tui.screen())) await tui.pressEach(['Tab'], 800);
  await tui.waitFor(/n: new {2}f: face {2}r: ask a vetter|You are not applying to any community\.|You have no persona yet\./, {
    step: 'applicant.applications',
    source: src(tui, 'ui/pages/main/components/vetting_panel.rs:932, :773, :763', 'ui/pages/main/components/vetting_panel.rs:605, :467'),
  });
  return tui;
}

/**
 * Whether the highlighted application is this persona's: its "Joining as"
 * line. ed13d29 shortens the DID there (vetting_panel.rs:820, display.rs:137);
 * 177a218 draws it whole (vetting_panel.rs:508-511), and the panel wraps it
 * (content_panel.rs:141), so the panel is read with its whitespace removed.
 */
function showsJoiningAs(tui, personaDid) {
  if (at177(tui)) return flatPanel(tui.screen()).includes(`Joiningas${personaDid}`);
  const short = webvhShort(personaDid);
  return tui.screen().split('\n').some((l) => l.includes('Joining as') && l.includes(short));
}

/**
 * Highlight the application this persona made. Every application to one
 * community shows the same name in the list, so the only thing that tells
 * them apart is "Joining as <persona>" under the highlighted one
 * (vetting_panel.rs:817-826, the DID shortened by display.rs:137).
 */
export async function selectApplication(tui, { personaDid }) {
  const short = at177(tui) ? personaDid : webvhShort(personaDid);
  const on = () => showsJoiningAs(tui, personaDid);
  if (on()) return;
  // Off the Applications view (My Identity after making a face, say): go there first.
  if (!/n: new {2}f: face {2}r: ask a vetter/.test(tui.screen())) await openApplications(tui);
  if (on()) return;
  const n = Number(tui.screen().match(/Applications \((\d+)\)/)?.[1] ?? 0);
  for (let i = 0; i < n && !on(); i++) await tui.pressEach(['Up'], 400);
  for (let i = 0; i < n && !on(); i++) await tui.pressEach(['Down'], 500);
  if (!on()) throw tui.failure('applicant.selectApplication', new Date(), `no application "Joining as ${short}" among ${n}`);
}

/**
 * Vetting → Applications → `n` "Apply to be vetted": the community's DID
 * (pasted into the focused text field), Tab to "Join as" and ←/→ to this
 * persona, Enter. Two fields at ed13d29 (vetting_actions.rs:897).
 *
 * "Application started." (vetting_actions.rs:1244) is written and at once
 * replaced by "Asking the community what it requires…" (:1152), because
 * starting an application also asks for the requirements (:1252) — so either
 * line counts. The step then waits for the requirements, which every later
 * step depends on (NextStep::LearnRequirements, openvtc-core applicant.rs:718).
 *
 * "Your faces need one more grant" (vetting_panel.rs:239) cannot appear here
 * at ed13d29: only the faces read (`f`) and the attribute-pool read open it
 * (vetting_actions.rs:3175-3203), when the VTA refuses them for want of the
 * persona-holder role (setup's `--admin-holder`, TUI_MAP Setup §3). Checked
 * anyway, since a stale mode could show it.
 */
export async function startApplication(tui, { communityDid, personaDid, personaLabel, timeoutMs = 90000 }) {
  const started = new Date();
  await openApplications(tui);
  await tui.pressEach(['n'], 1000);
  const pin = at177(tui);
  const opened = await tui.waitFor(/Apply to be vetted|Create a persona under My Identity first/, {
    step: 'applicant.applyForm',
    source: src(tui, 'ui/pages/main/components/vetting_panel.rs:202; state_handler/vetting_actions.rs:701', 'ui/pages/main/components/vetting_panel.rs:200; state_handler/vetting_actions.rs:703'),
  });
  if (!String(opened[0]).startsWith('Apply')) throw tui.failure('applicant.applyForm', started, 'the TUI has no persona to apply as');
  tui.type('\x1b[200~' + communityDid + '\x1b[201~');
  await sleep(800);
  // 177a218 draws the whole DID in the field (vetting_panel.rs:209), wrapped.
  const communityShown = pin
    ? flatPanel(tui.screen()).includes(`CommunityDID${communityDid}`)
    : tui.screen().split('\n').some((l) => l.includes('Community DID') && l.includes(didTail(communityDid)));
  if (!communityShown) {
    throw tui.failure('applicant.applyCommunity', started, 'the pasted community DID is not in the "Community DID" field', src(tui, 'ui/pages/main/components/vetting_panel.rs:211', 'ui/pages/main/components/vetting_panel.rs:209'));
  }
  await tui.pressEach(['Tab'], 600);
  // ed13d29: "Join as  <label>  (<did, shortened to 48 keeping the end>)"
  // (:212-223); ←/→ cycle it (vetting_actions.rs:955-960). 177a218: "Join as
  // <label>  (<whole did>)" (vetting_panel.rs:210-215), ←/→ cycle it
  // (vetting_actions.rs:939-943); read from the flattened panel up to the next
  // field, "Context".
  const tail = personaDid ? didTail(personaDid) : undefined;
  const joinAs177 = () => {
    const flat = flatPanel(tui.screen());
    const at = flat.indexOf('▸Joinas');
    if (at < 0) return undefined;
    const end = flat.indexOf('Context', at);
    return flat.slice(at, end < 0 ? undefined : end);
  };
  const onPersona = pin
    ? () => {
        const f = joinAs177();
        return !!f && (personaDid ? f.includes(`(${personaDid})`) : !personaLabel || f.includes(personaLabel.replace(/\s+/g, '')));
      }
    : () =>
        tui
          .screen()
          .split('\n')
          .some((l) => /▸ Join as\s/.test(l) && (!tail || l.includes(tail)) && (tail || !personaLabel || l.includes(personaLabel)));
  // With a DID, its tail decides: the label shown is the persona's profile
  // label, which a new persona does not carry ("Persona (did:…)"), measured
  // at ed13d29 on 2026-09-25.
  for (let i = 0; i < 40 && !onPersona(); i++) await tui.pressEach(['Right'], 500);
  if (!onPersona()) throw tui.failure('applicant.applyPersona', started, `"Join as" never offered ${personaLabel ?? ''} ${personaDid ?? ''}`, src(tui, 'ui/pages/main/components/vetting_panel.rs:223', 'ui/pages/main/components/vetting_panel.rs:210-215'));
  if (pin) {
    // 177a218 has a third field, Context (vetting_panel.rs:216-219): the VTA
    // context the application's face is worn in. Its options come from the
    // persona (vetting_actions.rs:1139-1182); a persona whose keys live in a
    // sub-context (createPersona's default) has that one context only
    // (openvtc-core config/community_context.rs:122-131). Enter from the Join
    // as field starts with the context shown (vetting_actions.rs:985-995), so
    // it is recorded, not chosen.
    const context = panelRows(tui.screen()).find((r) => /^(▸ )?Context\s/.test(r));
    tui.record('applicant.applyContext', true, started, { value: context?.replace(/^(▸ )?Context\s+/, ''), tuiSource: '[177a218] ui/pages/main/components/vetting_panel.rs:216-219' });
  }
  await tui.pressEach(['Enter'], 1000);
  const done = await tui.waitFor(
    /Application started\.|Asking the community what it requires…|for its vetting requirements\.|Could not start the application: .*|Enter the community's DID \(it starts with did:\)\.|Could not ask the community: .*/,
    {
      step: 'applicant.applicationStarted',
      source: src(tui, 'state_handler/vetting_actions.rs:1244, :1152, :3354 (failures :1216, :1233, :1150)', 'state_handler/vetting_actions.rs:1220, :1128, :2852 (failures :1209, :1192, :1054)'),
      timeoutMs: 30000,
    }
  );
  if (/^(Could not|Enter the)/.test(String(done[0]))) throw tui.failure('applicant.applicationStarted', started, String(done[0]));
  await sleep(1500);
  // ed13d29 only: 177a218 has no holder_grant.rs and says "Could not read your faces: …" at `f` instead.
  if (tui.screen().includes('Your faces need one more grant')) {
    throw tui.failure('applicant.holderGrant', started, 'the TUI says "Your faces need one more grant": its VTA context lacks persona-holder — rerun the fixture setup with `pnm contexts create … --admin-holder`', 'ui/pages/main/components/vetting_panel.rs:239');
  }
  if (personaDid) await selectApplication(tui, { personaDid });
  // A reused persona's application keeps its requests; one still open would
  // be read as this run's.
  const open = requestStates(tui.screen()).filter((s) => OPEN_REQUEST.test(s));
  if (open.length) throw tui.failure('applicant.staleRequest', started, `this persona's application already has an open request from an earlier run (${open.join(' | ')}) — abandon it (x) or use a new persona`);
  // The requirements: "Requires  not known yet — m asks the community" until the answer (vetting_panel.rs:827-836).
  const deadline = Date.now() + timeoutMs;
  let asked = false;
  let requires;
  while (Date.now() < deadline) {
    requires = appLine(tui.screen(), 'Requires');
    if (requires && !requires.startsWith('not known yet')) {
      tui.record('applicant.requirements', true, started, { value: requires, tuiSource: src(tui, 'state_handler/vetting_actions.rs:525-541', 'state_handler/vetting_actions.rs:528-544; ui/pages/main/components/vetting_panel.rs:512-521') });
      return { requires };
    }
    if (!asked && Date.now() > deadline - timeoutMs / 2) {
      await tui.pressEach(['m'], 1000); // "m: refresh requirements" (vetting_panel.rs:932)
      asked = true;
    }
    await sleep(1000);
  }
  throw tui.failure('applicant.requirements', started, `the community never said what it requires ("Requires ${requires ?? '(not on screen)'}")`, 'ui/pages/main/components/vetting_panel.rs:827-836');
}

/**
 * Make a face under My Identity with the given attributes, e.g.
 * { 'name.legal': 'Ada Applicant' }: one new attribute per claim (Your
 * attributes → `n`), then Faces → `n` ticking them. Returns the face's name.
 *
 * Faces are the holder's, not a persona's or a context's: attributes sit in
 * one pool above every context and a face selects over them (holder_grant.rs:1-9;
 * identity_panel.rs:1388). The Faces tab writes with no reach limit ("May be
 * worn anywhere", identity_panel.rs:826), and the vetting picker lists every
 * face the holder has (profile::list, vetting_actions.rs:2729). What is per
 * context and persona is WEARING one: chooseFace binds it in the application's
 * own context (binding for context + persona DID, vetting_actions.rs:2050-2082,
 * :2115-2149). So a face may be made before or after the application; only
 * chooseFace must come after it. `personaDid` is accepted for symmetry and
 * unused.
 *
 * Each attribute gets a unique label, so this run ticks its own and not an
 * earlier run's attribute of the same type (the list is by label and type,
 * identity_panel.rs:553-556, :1492-1500).
 *
 * The persona-holder refusal ("Your faces need one more grant" on the vetting
 * page) reads here as "Could not read your attributes/faces from the agent."
 * with the `pnm acl update … --capabilities persona-holder` hint
 * (identity_panel.rs:1328-1345; holder_grant.rs:52), or as a form error naming
 * the holder credential (holder_grant.rs:36-39): both fail the step clearly.
 */
/*
 * 177a218 has faces too, with the same forms and messages: tabs by Tab or →
 * (ui/pages/main/mod.rs:644), "n: add an attribute" / "n: make a face" hints
 * (identity_panel.rs:230, :234), " Add an attribute" (:1186) with Type, Label,
 * Value type, Value (:1201-1229), " Make a face" (:1256), " Shows these
 * attributes (N ticked)" (:1277), rows " ▸ [ ] <label>" (:1298-1310), and
 * "Saved the attribute." / "Saved the face." (state_handler/persona_actions.rs:925,
 * :948, :1209). There a card's claims come the same way: from the face worn in
 * the application's context (vetting_actions.rs:1899-1980, the preview from the
 * VTA). The holder-grant hint is identity_panel.rs:1155 there.
 */
export async function createFace(tui, { name, claims, personaDid: _unused }) {
  const started = new Date();
  const stamp = Date.now().toString(36);
  const HOLDER = /holder credential|persona-holder|reaching them is a separate grant/i;
  const holderFail = (step) =>
    tui.failure(step, started, "the TUI's VTA refuses its attribute pool (persona-holder missing — \"Your faces need one more grant\"): run `pnm acl update <this install's DID> --capabilities persona-holder` as a super-admin", 'openvtc/src/holder_grant.rs:36-66');
  await toMenu(tui);
  await tui.selectMenu('My Identity');
  await tui.pressEach(['Enter'], 1200);
  // Tabs are told apart by their key hints (identity_panel.rs:278, :285).
  const toTab = async (hint, step) => {
    for (let i = 0; i < 7 && !tui.screen().includes(hint); i++) await tui.pressEach(['Right'], 800);
    if (!tui.screen().includes(hint)) throw tui.failure(step, started, `could not reach the My Identity tab with "${hint}"`);
    // An agent-backed tab may not have been read yet: "r: read them" (:1361).
    if (tui.screen().includes('have not been read yet')) await tui.pressEach(['r'], 1500);
    const read = await tui.waitFor(/Could not read your \w+ from the agent\.|\d+ attributes? about you|No attributes yet\. `n` adds one|n: make a face/, { source: 'ui/pages/main/components/identity_panel.rs:1328, :466, :490, :285', timeoutMs: 30000 });
    if (String(read[0]).startsWith('Could not read')) throw HOLDER.test(tui.screen()) ? holderFail(step) : tui.failure(step, started, String(read[0]));
  };
  await toTab('n: add an attribute', 'applicant.attributesTab');
  const labels = {};
  for (const [claim, value] of Object.entries(claims)) {
    const label = `${claim} ${stamp}`;
    labels[claim] = label;
    await tui.pressEach(['n'], 1000);
    await tui.waitFor('Add an attribute', { step: 'applicant.attributeForm', source: 'ui/pages/main/components/identity_panel.rs:1380' });
    // Fields in order: Type, Label, Value type (string by default), Value (:1395-1422; content.rs:979-988).
    await tui.pressEach([...claim], 40);
    await tui.pressEach(['Tab'], 400);
    await tui.pressEach([...label], 40);
    await tui.pressEach(['Tab', 'Tab'], 400);
    if (!/▸ Value type\s+◂ string ▸/.test(tui.screen()) && !/Value type\s+◂ string ▸/.test(tui.screen())) {
      throw tui.failure('applicant.attributeForm', started, 'the attribute\'s value type is not "string"', 'ui/pages/main/components/identity_panel.rs:1408-1416');
    }
    await tui.pressEach([...value], 40);
    await tui.pressEach(['Enter'], 1500);
    const saved = await tui.waitFor(/Saved the attribute\.|A type is required.*|Saving…/, { source: 'state_handler/persona_actions.rs:1748, :2338', timeoutMs: 30000 });
    if (String(saved[0]) === 'Saving…') await tui.waitFor(/Saved the attribute\./, { source: 'state_handler/persona_actions.rs:1748, :2338', timeoutMs: 60000 }).catch(() => undefined);
    if (!tui.screen().includes('Saved the attribute.')) {
      if (HOLDER.test(tui.screen())) throw holderFail('applicant.attributeSaved');
      throw tui.failure('applicant.attributeSaved', started, `the attribute ${claim} was not saved`, 'state_handler/persona_actions.rs:2350-2378');
    }
    tui.record('applicant.attributeSaved', true, started, { value: label, tuiState: 'Saved the attribute.', tuiSource: 'state_handler/persona_actions.rs:1748, :2338' });
    // The list is re-read after a write (persona_actions.rs:2334): wait for the new row.
    await tui.waitFor(label, { source: 'ui/pages/main/components/identity_panel.rs:553-556', timeoutMs: 30000 });
  }
  await toTab('n: make a face', 'applicant.facesTab');
  await tui.pressEach(['n'], 1000);
  await tui.waitFor('Make a face', { step: 'applicant.faceForm', source: 'ui/pages/main/components/identity_panel.rs:1450' });
  if (tui.screen().includes('No attributes yet — add one first')) throw tui.failure('applicant.faceForm', started, 'the face form lists no attributes', 'ui/pages/main/components/identity_panel.rs:1478');
  await tui.pressEach([...name], 40); // the Name field has the focus (content.rs:1033-1037)
  await tui.pressEach(['Tab'], 500); // to the tick list
  const n = Object.keys(labels).length;
  for (const label of Object.values(labels)) {
    // " ▸ [ ] <label>  <type>" (identity_panel.rs:1496-1507); ↑/↓ wrap (persona_actions.rs:952-953).
    const on = () => tui.screen().split('\n').some((l) => /▸ \[[ x]\] /.test(l) && l.includes(label));
    for (let i = 0; i < 80 && !on(); i++) await tui.pressEach(['Down'], 300);
    if (!on()) throw tui.failure('applicant.faceTick', started, `the face form never put the cursor on "${label}"`, 'ui/pages/main/components/identity_panel.rs:1496-1507');
    if (!tui.screen().split('\n').some((l) => l.includes('▸ [x] ') && l.includes(label))) await tui.pressEach([' '], 500);
  }
  if (!tui.screen().includes(`Shows these attributes (${n} ticked)`)) {
    throw tui.failure('applicant.faceTick', started, `expected ${n} ticked attribute(s)`, 'ui/pages/main/components/identity_panel.rs:1471');
  }
  await tui.pressEach(['Enter'], 1500);
  await tui.waitFor(/Saved the face\.|A face needs a name.*/, { source: 'state_handler/persona_actions.rs:1801, :2338', timeoutMs: 60000 }).catch(() => undefined);
  if (!tui.screen().includes('Saved the face.')) {
    if (HOLDER.test(tui.screen())) throw holderFail('applicant.faceSaved');
    throw tui.failure('applicant.faceSaved', started, `the face "${name}" was not saved`, 'state_handler/persona_actions.rs:2350-2378');
  }
  tui.record('applicant.faceSaved', true, started, { value: { name, attributes: labels }, tuiState: 'Saved the face.', tuiSource: 'state_handler/persona_actions.rs:1801, :2338' });
  return name;
}

/**
 * Optional: wear a face for this application (`f`, vetting_panel.rs:359). The
 * card is read from the face worn in the application's context
 * (vetting_actions.rs:2151-2232); a persona that wears none has nothing to
 * show, and sendCard would fail at the preview. `face` is a face made
 * beforehand under My Identity → Faces.
 */
export async function chooseFace(tui, { personaDid, face }) {
  const started = new Date();
  await selectApplication(tui, { personaDid });
  await tui.pressEach(['f'], 1500);
  // The picker's heading: ed13d29 "The face you show vetters" (vetting_panel.rs:359);
  // 177a218 "The face vetters are shown" (vetting_panel.rs:233), where the
  // status line reads "Choose the face vetters are shown." (vetting_actions.rs:2704).
  const HEADING = at177(tui) ? 'The face vetters are shown' : 'The face you show vetters';
  const m = await tui.waitFor(
    new RegExp(`${HEADING}|Your faces need one more grant|You have no faces yet|Could not read your faces.*|Faces live in your VTA.*|Cannot choose a face.*`),
    {
      step: 'applicant.faces',
      source: src(
        tui,
        'ui/pages/main/components/vetting_panel.rs:359, :239; state_handler/vetting_actions.rs:3110, :3201-3203, :2041, :2099',
        'ui/pages/main/components/vetting_panel.rs:233; state_handler/vetting_actions.rs:2701, :2718, :1789, :1847'
      ),
      timeoutMs: 60000,
    }
  );
  if (String(m[0]) !== HEADING) {
    const why = String(m[0]).startsWith('Your faces need')
      ? 'the TUI\'s VTA refuses to read its faces ("Your faces need one more grant"): the context lacks persona-holder — rerun the fixture setup with --admin-holder'
      : String(m[0]);
    await tui.pressEach(['Esc'], 500);
    throw tui.failure('applicant.faces', started, why);
  }
  const row = new RegExp(`▸ ${escapeRe(face)}\\s+\\d+ attributes?`);
  await walkTo(tui, (screen) => row.test(screen), { pace: 500 });
  if (!row.test(tui.screen())) {
    await tui.pressEach(['Esc'], 500);
    throw tui.failure('applicant.faces', started, `no face named "${face}" in the picker`, src(tui, 'ui/pages/main/components/vetting_panel.rs:394-405', 'ui/pages/main/components/vetting_panel.rs:245-268'));
  }
  await tui.pressEach(['Enter'], 1500);
  // "is already the face you show vetters" (ed13d29 :2123) / "is already the face vetters are shown." (177a218 :1871).
  const worn = await tui.waitFor(/Vetters are shown your .+ face|is already the face (you show vetters|vetters are shown)|Could not wear .*|Cannot wear that face.*/, {
    step: 'applicant.faceWorn',
    source: src(tui, 'state_handler/vetting_actions.rs:3228, :2123, :3238', 'state_handler/vetting_actions.rs:2728, :1871, :2738, :1879'),
    timeoutMs: 60000,
  });
  if (/^(Could not|Cannot)/.test(String(worn[0]))) throw tui.failure('applicant.faceWorn', started, String(worn[0]));
}

/**
 * `r` "Ask a vetter", paste the vetter's `vetting-ticket:` link, Enter. At
 * ed13d29 the form has one field (vetting_panel.rs:487): a bracketed paste of
 * a link fills it and reads it at once — "Read the ticket link. It goes to …
 * — Enter sends the request." (vetting_actions.rs:1384) — and Enter sends. If
 * the paste hook did not fire, Enter reads the field itself (:1261-1296), so
 * both ways end in the same send. Keyring's link (bifold trust-tasks
 * vetting/ticketUri.ts) is the same scheme openvtc decodes
 * (openvtc-core applicant.rs:692), and must name this application's community
 * (:694-696).
 */
export async function requestVetter(tui, { ticketLink, personaDid }) {
  const started = new Date();
  await selectApplication(tui, { personaDid });
  // Baseline before the request: rows an earlier run left are not this run's.
  tui.applicantBaseline = countStates(requestStates(tui.screen()));
  tui.applicantSince = new Date().toISOString();
  await tui.pressEach(['r'], 1000);
  await tui.waitFor('Ask a vetter', { step: 'applicant.askForm', source: src(tui, 'ui/pages/main/components/vetting_panel.rs:474', 'ui/pages/main/components/vetting_panel.rs:280') });
  if (at177(tui)) return requestVetter177(tui, { ticketLink, started });
  tui.type('\x1b[200~' + ticketLink + '\x1b[201~');
  const read = await tui.waitFor(/Read the ticket link\. It goes to|that is not a vetting ticket link this client can read.*|that ticket is for vetting in another community.*|▸ Ticket link\s+vetting-ticket:/, {
    step: 'applicant.ticketRead',
    source: 'state_handler/vetting_actions.rs:1384; openvtc-core/src/vetting/applicant.rs:96, :100; ui/pages/main/components/vetting_panel.rs:487',
    timeoutMs: 15000,
  });
  if (/^that /.test(String(read[0]))) throw tui.failure('applicant.ticketRead', started, String(read[0]));
  for (let attempt = 1; attempt <= 3; attempt++) {
    await tui.pressEach(['Enter'], 1500);
    const sent = await tui.waitFor(
      /Request sent to (\S+)|Could not send the request: .*|already in progress — please wait\.|that is not a vetting ticket link.*|that ticket is for vetting in another community.*|Paste the link from the vetter's QR code/,
      { source: 'state_handler/vetting_actions.rs:3361, :3445, :1288; background_dispatch.rs:198', timeoutMs: 60000 }
    );
    const line = String(sent[0]);
    if (line.startsWith('Request sent to')) {
      tui.record('applicant.requestSent', true, started, { value: sent[1], tuiState: line, tuiSource: 'state_handler/vetting_actions.rs:3361' });
      return sent[1];
    }
    // Busy: another vetting send holds the domain (vetting_actions.rs:1066-1072); the form stays open.
    if (line.startsWith('already in progress') && attempt < 3) {
      await sleep(5000);
      continue;
    }
    throw tui.failure('applicant.requestSent', started, line);
  }
}

/**
 * 177a218's "Ask a vetter" has two fields, Vetter DID and Ticket code
 * (vetting_panel.rs:293, :299). A bracketed paste of a `vetting-ticket:` link
 * anywhere on the form fills both (ui/pages/main/mod.rs:254-267): "Filled in
 * from the ticket link: {vetter}. Enter sends the request."
 * (vetting_actions.rs:1354), the code row reading "scanned ticket, from the
 * link" (vetting_panel.rs:294-298). Enter then sends. A link that arrived as
 * typed text instead sits in the DID field, and the first Enter only fills the
 * form (vetting_actions.rs:1238-1240) — so a second Enter is pressed when the
 * form is still open on "Filled in …".
 */
async function requestVetter177(tui, { ticketLink, started }) {
  tui.type('\x1b[200~' + ticketLink + '\x1b[201~');
  const read = await tui.waitFor(/Filled in from the ticket link: .*|that is not a vetting ticket link this client can read.*|that ticket is for vetting in another community.*|▸ Vetter DID\s+vetting-ticket:/, {
    step: 'applicant.ticketRead',
    source: '[177a218] state_handler/vetting_actions.rs:1354; openvtc-core/src/vetting/applicant.rs:96, :100; ui/pages/main/components/vetting_panel.rs:293',
    timeoutMs: 15000,
  });
  if (/^that /.test(String(read[0]))) throw tui.failure('applicant.ticketRead', started, String(read[0]));
  const RESULT =
    /Request sent to (\S+)|Could not send the request: .*|already in progress — please wait\.|that is not a vetting ticket link.*|that ticket is for vetting in another community.*|Enter the vetter's DID \(it starts with did:\)\.|That is not a ticket code.*/;
  const SOURCE = '[177a218] state_handler/vetting_actions.rs:2859 (failures :1054, :1243, :1258-1261; background_dispatch.rs:193)';
  const formOpen = () => tui.screen().split('\n').some((l) => l.includes('Ask a vetter') && !l.includes('r: ask a vetter'));
  for (let attempt = 1; attempt <= 3; attempt++) {
    tui.press('Enter');
    const pressedAt = Date.now();
    let refilled = false;
    let line;
    let hit;
    for (const until = Date.now() + 60000; Date.now() < until; ) {
      if (tui.exited) throw tui.failure('applicant.requestSent', started, `the TUI exited (${JSON.stringify(tui.exited)})`, SOURCE);
      await sleep(1000);
      const screen = tui.screen();
      hit = screen.match(RESULT);
      if (hit) {
        line = String(hit[0]);
        break;
      }
      // Only once the first Enter has surely been handled: a stray Enter on the
      // list would be "send card" (ui/pages/main/mod.rs:2558) and overwrite the status.
      if (!refilled && Date.now() - pressedAt > 4000 && formOpen() && screen.includes('Filled in from the ticket link')) {
        refilled = true;
        tui.press('Enter');
      }
    }
    if (!line) throw tui.failure('applicant.requestSent', started, 'no answer to the request within 60000 ms', SOURCE);
    if (line.startsWith('Request sent to')) {
      tui.record('applicant.requestSent', true, started, { value: hit[1], tuiState: line, tuiSource: SOURCE });
      return hit[1];
    }
    if (line.startsWith('already in progress') && attempt < 3 && formOpen()) {
      await sleep(5000);
      continue;
    }
    throw tui.failure('applicant.requestSent', started, line, SOURCE);
  }
}

/**
 * Wait on the highlighted application's request rows until `ready` returns a
 * hit; fail on a new "declined" or "refused (…)" row, or on a refusal that
 * only the debug log shows.
 */
async function awaitRequestRow(tui, { step, source, personaDid, debugLog, timeoutMs, what, ready }) {
  const started = new Date();
  const base = tui.applicantBaseline ?? countStates([]);
  const since = tui.applicantSince ?? started.toISOString();
  const deadline = Date.now() + timeoutMs;
  let states = [];
  while (Date.now() < deadline) {
    if (tui.exited) throw tui.failure(step, started, `the TUI exited (${JSON.stringify(tui.exited)})`, source);
    const screen = tui.screen();
    if (!showsJoiningAs(tui, personaDid)) {
      await selectApplication(tui, { personaDid });
      continue;
    }
    states = requestStates(screen);
    const c = countStates(states);
    const hit = ready(states, c, base);
    if (hit) {
      tui.record(step, true, started, { tuiState: hit.line, tuiSource: source, ...(hit.value !== undefined ? { value: hit.value } : {}) });
      return hit;
    }
    if (c.declined > base.declined) throw tui.failure(step, started, `the vetter declined ("declined", state_handler/vetting_actions.rs:${at177(tui) ? '310 at 177a218' : '296'})`, source);
    if (c.refused > base.refused) {
      const block = vettersBlock(screen) ?? [];
      throw tui.failure(step, started, `the vetter refused: ${block.join(' / ')}`, source);
    }
    const refusal = debugLog && logLineSince(debugLog, since, APPLICANT_REFUSALS);
    if (refusal) throw tui.failure(step, started, `the TUI dropped the vetter's answer (only its log says so): ${refusal.trim()}`, src(tui, 'openvtc-core/src/vetting/inbound.rs:425, :600, :676, :695, :710, :821', 'openvtc-core/src/vetting/inbound.rs:409, :573, :649, :668, :683, :794'));
    await sleep(1000);
  }
  throw tui.failure(step, started, `no "${what}" within ${timeoutMs} ms (rows: ${states.join(' | ') || 'none'})`, source);
}

/** The vetter accepted: "accepted — waiting for a session", or "accepted — <their hint>" (vetting_actions.rs:269-275). */
export async function awaitAccepted(tui, { personaDid, debugLog, timeoutMs = 180000 }) {
  const hit = await awaitRequestRow(tui, {
    step: 'applicant.accepted',
    source: src(tui, 'state_handler/vetting_actions.rs:274', 'state_handler/vetting_actions.rs:282-291'),
    personaDid,
    debugLog,
    timeoutMs,
    what: 'accepted — …',
    // A session may already follow the acceptance; it too means accepted.
    ready: (states, c, b) => (c.accepted > b.accepted || c.session > b.session ? { line: states.find((s) => /^(accepted|session open) — /.test(s)) } : undefined),
  });
  return hit.line;
}

/**
 * The vetter opened a session: "session open — read the code together, then
 * send your card" with "   code <MATCH>" on the same line
 * (vetting_actions.rs:284; vetting_panel.rs:893-899). Returns the match code.
 */
export async function awaitSession(tui, { personaDid, debugLog, timeoutMs = 120000 }) {
  const SESSION = /^session open — read the code together, then send your card\s+code ([0-9A-Z]{4}-[0-9A-Z]{4})$/;
  const hit = await awaitRequestRow(tui, {
    step: 'applicant.session',
    source: src(tui, 'state_handler/vetting_actions.rs:284; ui/pages/main/components/vetting_panel.rs:893-899', 'state_handler/vetting_actions.rs:292-301; ui/pages/main/components/vetting_panel.rs:577-584'),
    personaDid,
    debugLog,
    timeoutMs,
    what: 'session open — … code XXXX-XXXX',
    ready: (states) => {
      const line = states.find((s) => SESSION.test(s));
      return line ? { line, value: line.match(SESSION)[1] } : undefined;
    },
  });
  return hit.value;
}

/**
 * `c` "Send your card" (vetting_panel.rs:1216). The TUI asks for no key-press
 * to confirm the match code: it shows "Match code <code>" (:1237) and "Read
 * this code to the vetter, and hear it read back. Send only if it matches."
 * (:1243) — so the harness checks the code it shows is `matchCode`. The first
 * Enter previews ("This is what the card shows. Enter approves and sends it.",
 * vetting_actions.rs:3246), the second releases, signs and sends ("Card sent —
 * the vetter checks it against you and your documents.", :3285).
 */
export async function sendCard(tui, { personaDid, matchCode }) {
  const started = new Date();
  await selectApplication(tui, { personaDid });
  await tui.pressEach(['c'], 1000);
  const opened = await tui.waitFor(/Send your card|No vetter is waiting for your card\./, {
    step: 'applicant.cardForm',
    source: src(tui, 'ui/pages/main/components/vetting_panel.rs:1216; state_handler/vetting_actions.rs:751', 'ui/pages/main/components/vetting_panel.rs:885; state_handler/vetting_actions.rs:754'),
  });
  if (!String(opened[0]).startsWith('Send')) throw tui.failure('applicant.cardForm', started, String(opened[0]));
  const shownCode = tui.screen().match(/Match code\s+([0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1];
  if (matchCode && shownCode !== matchCode) {
    await tui.pressEach(['Esc'], 500);
    throw tui.failure('applicant.cardMatch', started, `the card form shows match code ${shownCode}, the vetter read ${matchCode}`, src(tui, 'ui/pages/main/components/vetting_panel.rs:1237', 'ui/pages/main/components/vetting_panel.rs:906'));
  }
  const BAD = /This face cannot make the card: .*|Could not preview the card: .*|.* holds none of .*|Faces live in your VTA.*|The session has expired.*|That session has closed\.|Cannot send a card: .*|already in progress — please wait\./;
  await tui.pressEach(['Enter'], 1500);
  const preview = await tui.waitFor(new RegExp(`This is what the card shows\\. Enter approves and sends it\\.|${BAD.source}`), {
    step: 'applicant.cardPreview',
    source: src(tui, 'state_handler/vetting_actions.rs:3246 (failures :3245, :1899-1924, :2041, :2172-2177)', 'state_handler/vetting_actions.rs:2746 (failures :2745, :2761, :1789, :1920-1926)'),
    timeoutMs: 60000,
  });
  if (!String(preview[0]).startsWith('This is what the card shows')) {
    await tui.pressEach(['Esc'], 500);
    throw tui.failure('applicant.cardPreview', started, String(preview[0]).trim());
  }
  const shows = panelRows(tui.screen());
  const at = shows.indexOf('The card will show'); // vetting_panel.rs:1271 (177a218 :940)
  const end = shows.findIndex((r, i) => i > at && !r);
  const claims = at < 0 ? [] : shows.slice(at + 1, end < 0 ? undefined : end);
  await tui.pressEach(['Enter'], 1500);
  const sent = await tui.waitFor(/Card sent — the vetter checks it against you and your documents\.|Card sent, but .*|Could not send the card: .*|Your VTA wants you to approve this disclosure.*|That session has closed\.|The session has expired.*/, {
    step: 'applicant.cardSent',
    source: src(tui, 'state_handler/vetting_actions.rs:3285 (failures :3290-3293, :3321, :3300, :2172-2177)', 'state_handler/vetting_actions.rs:2783 (failures :2788-2791, :2819, :2798, :1920-1926)'),
    timeoutMs: 90000,
  });
  const line = String(sent[0]);
  if (!line.startsWith('Card sent — ')) {
    if (tui.screen().includes('Send your card')) await tui.pressEach(['Esc'], 500);
    // A step-up needs a person at the VTA's approval device; the harness has none.
    throw tui.failure('applicant.cardSent', started, line);
  }
  const cardSentMs = Date.now();
  tui.record('applicant.cardClaims', true, started, { value: claims, tuiSource: 'ui/pages/main/components/vetting_panel.rs:1271-1277' });
  return { cardSentMs, claims };
}

/**
 * The statement arrived: a new "statement received" row (vetting_actions.rs:295).
 * A statement openvtc refuses changes nothing on screen — the row stays "card
 * sent — waiting for their statement" and only the log says "vetting statement
 * refused" (openvtc-core/src/vetting/inbound.rs:821) — so the log is polled
 * with the screen and the step fails at once on that line.
 */
export async function awaitStatement(tui, { personaDid, debugLog, timeoutMs = 180000 }) {
  const hit = await awaitRequestRow(tui, {
    step: 'applicant.statement',
    source: src(tui, 'state_handler/vetting_actions.rs:295', 'state_handler/vetting_actions.rs:307-309'),
    personaDid,
    debugLog,
    timeoutMs,
    what: 'statement received',
    ready: (states, c, b) => (c.statement > b.statement ? { line: 'statement received' } : undefined),
  });
  return hit.line;
}

/**
 * Join with the statements. At ed13d29 `j` on the application starts the join
 * for its community (ui/pages/main/mod.rs:2825-2836), once its next step reads
 * "j — join now; your statements go with the request" (vetting_actions.rs:496).
 * The join opens on "Choose how to join" (ui/pages/join_flow/vetting_requirements.rs:401);
 * "Apply as" (:247) must be THIS persona — the page opens on the first
 * satisfied application, which may be an earlier run's
 * (state_handler/join_flow.rs:353-361) — and then its row reads "Present your
 * vetting statements" (join_flow.rs:281). Enter on it goes to "Use an
 * invitation for this community?" (ui/pages/join_flow/invitation_choice.rs:93);
 * "Join without it — send an open request" (:182) still carries the
 * statements, which the submit attaches for this community and persona
 * whatever the invitation choice (join_flow.rs:3027-3044). Then the same
 * membership-stored assertion as joinByInvitation.
 *
 * At 177a218 there is no `j` on Applications (ui/pages/main/mod.rs:2553-2558):
 * the next step reads "join from Communities (j) — your statements go with the
 * request" (vetting_actions.rs:499), and the join goes Communities → `j` → the
 * community's DID → Enter (see join177). From the invitation step on, the two
 * builds are the same.
 *
 * `personaLabel` (optional) is only used at 177a218, to check the join page's
 * "Your application, as <label>".
 */
export async function joinWithStatements(tui, { communityDid, personaDid, personaLabel, debugLog, timeoutMs = 120000 }) {
  const since = new Date().toISOString();
  const started = new Date();
  const pin = at177(tui);
  await openApplications(tui);
  await selectApplication(tui, { personaDid });
  const JOIN_NOW = pin ? 'join from Communities (j) — your statements go with the request' : 'j — join now; your statements go with the request';
  const JOIN_SRC = src(tui, 'state_handler/vetting_actions.rs:496', 'state_handler/vetting_actions.rs:499');
  for (const until = Date.now() + 60000; Date.now() < until && appLine(tui.screen(), 'Next') !== JOIN_NOW; ) await sleep(1000);
  if (appLine(tui.screen(), 'Next') !== JOIN_NOW) {
    const s = tui.screen();
    throw tui.failure('applicant.joinReady', started, `the application does not meet the requirements yet — Next: "${appLine(s, 'Next')}", Progress: "${appLine(s, 'Progress')}", Vetters: ${(vettersBlock(s) ?? []).join(' / ')}`, JOIN_SRC);
  }
  tui.record('applicant.joinReady', true, started, { tuiState: JOIN_NOW, tuiSource: JOIN_SRC });
  if (pin) await join177(tui, { communityDid, personaDid, personaLabel, started });
  else await joinRouteCurrent(tui, { personaDid, started });
  await tui.waitFor('Use an invitation for this community?', { step: 'applicant.joinInvitation', source: 'ui/pages/join_flow/invitation_choice.rs:93', timeoutMs: 60000 });
  const without = () => /▸ Join without it — send an open request/.test(tui.screen());
  for (let i = 0; i < 6 && !without(); i++) await tui.pressEach(['Down'], 600);
  if (!without()) throw tui.failure('applicant.joinInvitation', started, 'could not select "Join without it — send an open request"', src(tui, 'ui/pages/join_flow/invitation_choice.rs:182', 'ui/pages/join_flow/invitation_choice.rs:182'));
  await tui.pressEach(['Enter'], 2000);
  // Pages that may still stand between here and the submit take their
  // defaults: the community's questions (" The community asks about you ",
  // answers.rs:62, Enter sends; ed13d29 only) and a context choice (" Where
  // should this community live? ", context_choice.rs:73, both builds). Neither
  // was seen on a run yet; at 177a218 a persona whose application already has
  // a context skips the second (state_handler/join_flow.rs:1133-1149).
  const deadline = Date.now() + 90000;
  let presenting;
  while (Date.now() < deadline && !/Join request sent\.|Join failed\. Nothing was activated\./.test(tui.screen())) {
    const s = tui.screen();
    presenting ??= s.match(/Presenting \d+ vetting statement\(s\) to the community…/)?.[0];
    if (s.includes(' The community asks about you ') || s.includes(' Where should this community live? ')) {
      tui.record('applicant.joinDefaultPage', true, new Date(), { tuiState: s.includes('asks about you') ? 'answers' : 'context' });
      await tui.pressEach(['Enter'], 3000);
      continue;
    }
    await sleep(1000);
  }
  const sent = await tui.waitFor(/Join request sent\.|Join failed\. Nothing was activated\./, { step: 'applicant.joinSent', source: 'ui/pages/join_flow/join_progress.rs:103, :195', timeoutMs: 5000 });
  if (!String(sent[0]).startsWith('Join request sent')) throw tui.failure('applicant.joinSent', started, String(sent[0]));
  if (presenting) tui.record('applicant.joinPresenting', true, started, { tuiState: presenting, tuiSource: src(tui, 'state_handler/join_flow.rs:3034-3035', 'state_handler/join_flow.rs:1970-1974') });
  return awaitMembershipStored(tui, { community: communityDid, debugLog, since, timeoutMs, step: 'applicant.membershipStored' });
}

/** ed13d29: `j` on the application, then "Apply as" this persona and "Present your vetting statements". */
async function joinRouteCurrent(tui, { personaDid, started }) {
  await tui.pressEach(['j'], 2000);
  const page = await tui.waitFor(/Choose how to join|Could not learn whether .*|Nothing answers at .*/, {
    step: 'applicant.joinRoutes',
    source: 'ui/pages/join_flow/vetting_requirements.rs:401 (failures :296, :302)',
    timeoutMs: 60000,
  });
  if (String(page[0]) !== 'Choose how to join') throw tui.failure('applicant.joinRoutes', started, String(page[0]));
  // "Apply as" is a row only while the cursor is on the vetting route (state_handler/join.rs:306-326).
  const applyAs = () => tui.screen().split('\n').find((l) => /▸ Apply as\s/.test(l));
  for (let i = 0; i < 8 && !applyAs(); i++) await tui.pressEach(['Down'], 600);
  if (!applyAs()) throw tui.failure('applicant.joinApplyAs', started, 'could not reach the "Apply as" choice under the vetting route', 'ui/pages/join_flow/vetting_requirements.rs:247');
  // "<label>  (<did>)  — ready to present" (:226-246); ←/→ cycle it (:110-111).
  const ours = () => {
    const l = applyAs();
    return l && l.includes(didTail(personaDid)) && l.includes('ready to present');
  };
  // ←/→ cycle the personas, one more every run: once round, whatever their number.
  await walkTo(tui, () => ours(), { keys: ['Right'], pace: 700, state: () => applyAs()?.trim() });
  if (!ours()) throw tui.failure('applicant.joinApplyAs', started, `"Apply as" never showed ${personaDid} ready to present (last: ${applyAs()?.trim()})`, 'ui/pages/join_flow/vetting_requirements.rs:226-247');
  await tui.pressEach(['Up'], 700);
  if (!/▸ Present your vetting statements/.test(tui.screen())) {
    const focused = tui.screen().split('\n').find((l) => l.includes('▸'));
    throw tui.failure('applicant.joinRoute', started, `the vetting route is not "Present your vetting statements" (${focused?.trim()})`, 'state_handler/join_flow.rs:281');
  }
  tui.record('applicant.joinRoute', true, started, { tuiState: 'Present your vetting statements', tuiSource: 'state_handler/join_flow.rs:281' });
  await tui.pressEach(['Enter'], 2000);
}

/**
 * 177a218: Communities → `j` (ui/pages/main/mod.rs:925-928) → "Enter the
 * community's DID or agent name:" (ui/pages/join_flow/vtc_enter_did.rs:118) →
 * the DID, pasted → Enter. The community's vetting is known from the
 * application, so " Joining {name} " opens at once on "{name} vets the people
 * who join." (state_handler/join_flow.rs:602-609, :209-219;
 * ui/pages/join_flow/vetting_requirements.rs:191) with "Your application, as
 * {label}" (:220). The page shows ONE application: the first satisfied one to
 * this community, of any persona (join_flow.rs:148-158), and has no way to pick
 * another — an earlier run's satisfied application wins, and 177a218 cannot
 * abandon one (openvtc-core vetting/book.rs has no abandon_application). The
 * label is the persona's profile label, "Persona (<DID cut to 29 chars>...)"
 * for a persona with no community yet (openvtc-core config/mod.rs:394,
 * :440-452), so the persona is checked by `personaLabel` or that DID prefix.
 * "Joining now presents your N vetting statement(s) to {name}." (:243) marks it
 * satisfied, and Enter joins as its persona (:65; join_flow.rs:856-872) on to
 * the invitation step.
 */
async function join177(tui, { communityDid, personaDid, personaLabel, started }) {
  await toMenu(tui);
  await tui.selectMenu('Communities');
  await tui.pressEach(['Enter'], 1200);
  await tui.pressEach(['j'], 1500);
  await tui.waitFor("Enter the community's DID or agent name:", { step: 'applicant.joinEnterDid', source: '[177a218] ui/pages/join_flow/vtc_enter_did.rs:118', timeoutMs: 15000 });
  // A paste that does not open with `{` goes into the input (ui/pages/join_flow/mod.rs:163-177 at 177a218).
  tui.type('\x1b[200~' + communityDid + '\x1b[201~');
  await sleep(800);
  tui.press('Enter');
  const page = await tui.waitFor(/vets the people who join\.|Could not learn whether .*|Choose the persona this community will know you as:/, {
    step: 'applicant.joinVettingPage',
    source: '[177a218] ui/pages/join_flow/vetting_requirements.rs:191, :168; identity_choice.rs:151',
    timeoutMs: 60000,
  });
  if (!String(page[0]).startsWith('vets the people')) {
    await tui.pressEach(['Esc'], 800);
    throw tui.failure('applicant.joinVettingPage', started, `the join does not see the community's vetting or the application (${String(page[0])})`, '[177a218] state_handler/join_flow.rs:602-641');
  }
  const rows = panelRows(tui.screen());
  const asRow = tui
    .screen()
    .split('\n')
    .map((l) => l.replace(/^[\s│║]+|[\s│║]+$/g, ''))
    .find((l) => l.startsWith('Your application, as '));
  const who = asRow?.slice('Your application, as '.length).trim();
  const oursByLabel = !!who && !!personaLabel && who.includes(personaLabel);
  const oursByDid = !!who && who.includes(personaDid.slice(0, 29));
  if (!oursByLabel && !oursByDid) {
    await tui.pressEach(['Esc'], 800);
    throw tui.failure('applicant.joinApplication', started, `the join page shows the application of "${who ?? '(none)'}", not ${personaLabel ?? personaDid} — 177a218 shows only the first satisfied application to a community and cannot abandon one; use a fresh community or fixture`, '[177a218] ui/pages/join_flow/vetting_requirements.rs:220; state_handler/join_flow.rs:148-158');
  }
  const presents = tui.screen().match(/Joining now presents your (\d+) vetting statements? to /);
  if (!presents) {
    const next = rows.find((r) => r.startsWith('Next:'));
    await tui.pressEach(['Esc'], 800);
    throw tui.failure('applicant.joinApplication', started, `the application is not satisfied on the join page (${next ?? 'no Next line'})`, '[177a218] ui/pages/join_flow/vetting_requirements.rs:222-262');
  }
  tui.record('applicant.joinRoute', true, started, { value: who, tuiState: presents[0].trim(), tuiSource: '[177a218] ui/pages/join_flow/vetting_requirements.rs:220, :243' });
  await tui.pressEach(['Enter'], 2000);
}
