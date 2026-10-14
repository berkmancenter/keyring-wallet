// The vetter's spent or expired tickets, swept before a gate issues its own (6f, 10-13). openvtc keeps tickets only in
// the vetter's own profile (openvtc-core vetting/tickets.rs:17-18, "client-local in V0"); nothing prunes them
// (VettingBook::prune has no caller at 8991f9ca), so the harness vetter's Tickets view grows by one every gate and
// broke two list walks (#413, #416). Deleting one is local to that profile (vetting_actions.rs:1983-2011): the
// community holds no ticket records, so nothing of the community's changes.
//
// mode "list" (the default): read-only, counts the rows. mode "delete": deletes only rows that say "spent or
// expired", each checked on the confirmation screen ("Delete this ticket", its code) before Enter. openvtc's own
// message on a delete: "anyone already holding it is now refused, and they are not told why". Harmless for a spent
// or expired ticket, and the reason this must never widen to live ones.
import { selectedLine, walkTo } from './listWalk.js';

const ROW = /([0-9A-Z]{4}-[0-9A-Z]{4})\s{2}.+\s{2}(spent or expired|(\d+) left, until)/;
const REVEAL = { Down: 'PageDown', Up: 'PageUp' };

/** The ticket rows on screen: [{ code, spent, selected }]. */
export function ticketRows(screen) {
  return String(screen).split('\n').flatMap((l) => {
    const m = ROW.exec(l);
    return m ? [{ code: m[1], spent: m[2] === 'spent or expired', selected: l.includes('▸') }] : [];
  });
}

/** Totals from the desk header ("Requests (n)  Tickets (n)  Issued (n)"), or null. */
export function ticketTotal(screen) {
  const m = /Tickets \((\d+)\)/.exec(String(screen));
  return m ? Number(m[1]) : null;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(tui, test, ms, pace) {
  for (const end = Date.now() + ms; Date.now() < end; await settle(pace)) if (test(tui.screen())) return true;
  return test(tui.screen());
}

/**
 * On the desk's Tickets view: list, or delete the spent or expired tickets. Returns { total, spent, deleted, kept }.
 * `pace` is the key spacing (ms); `max` bounds the deletes.
 */
export async function sweepSpentTickets(tui, { mode = 'list', pace = 600, max = 200, log = () => {} } = {}) {
  const total = ticketTotal(tui.screen());
  // Read-only listing: walk the whole list once (down then up), noting every row seen.
  const seen = new Map();
  const note = (s) => { for (const r of ticketRows(s)) seen.set(r.code, r.spent); };
  note(tui.screen());
  await walkTo(tui, (s) => { note(s); return false; }, { pace, reveal: REVEAL });
  const spent = [...seen.values()].filter(Boolean).length;
  log(`TICKETS total ${total ?? '?'} · seen ${seen.size} · spent or expired ${spent} · mode ${mode}`);
  if (mode !== 'delete') return { total, spent, deleted: 0, kept: seen.size };
  let deleted = 0;
  for (let i = 0; i < max; i++) {
    const onSpent = (s) => ticketRows(s).some((r) => r.selected && r.spent);
    if (!(await walkTo(tui, onSpent, { pace, reveal: REVEAL }))) break;
    const code = ticketRows(tui.screen()).find((r) => r.selected && r.spent).code;
    await tui.pressEach(['d'], pace);
    // The confirmation must name this ticket; anything else and nothing is deleted.
    if (!(await until(tui, (s) => s.includes('Delete this ticket') && s.includes(code), 3000, 200))) {
      await tui.pressEach(['Esc'], pace);
      log(`TICKETS stop: no confirmation for ${code}`);
      break;
    }
    await tui.pressEach(['Enter'], pace);
    if (!(await until(tui, (s) => s.includes(`Ticket ${code} deleted`) || !ticketRows(s).some((r) => r.code === code), 5000, 200))) {
      log(`TICKETS stop: ${code} not deleted`);
      break;
    }
    deleted++;
    // A delete puts the ▸ back on the first row (vetting_actions.rs:1983-2011: selected = 0) and the pane does not
    // follow it (main/mod.rs:562-577): Home scrolls the pane to the top, where the ▸ now is, and the next walk starts
    // from there. The confirmation check above keeps a mis-placed cursor harmless all the same.
    await tui.pressEach(['Home'], pace);
  }
  log(`TICKETS deleted ${deleted} spent or expired; ${seen.size - deleted} left`);
  return { total, spent, deleted, kept: seen.size - deleted };
}

export { selectedLine };
