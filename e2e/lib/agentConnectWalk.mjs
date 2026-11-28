/**
 * Step 7.11's emulator walk of agent connect, the pure half: which catalogue states a running app can reach, how, and
 * the pairs file the dated companion is written from (docs/plans/agent-connect-plan.md §7.11; backlog 2, Part R5).
 *
 * The screen catalogue (e2e/lib/agent-connect-screens*.json) says what each state looks like: its marker testID, its
 * words, its canvas frame. It does not say how to get there in a running app, so this file does, per state:
 * - a route: the taps from the app's home to the state's screen, then the manifest's own steps;
 * - or the reason it is not reached here: what it needs that a single emulator with the lab VTA does not have.
 *
 * A state with neither is listed as "no route written", never skipped. A route or reason naming a state no manifest
 * has is an error: the table must follow the catalogue, not drift from it.
 *
 * WRITTEN, NOT YET RUN (2026-11-28). The routes use testIDs read from the source at feat/agent-connect 6ac0d130b and
 * from #1126 (the developer switches). No device has walked them yet; the first run is its own step, one heavy run at a
 * time on the shared Mac.
 *
 * @module e2e/lib/agentConnectWalk
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BASE_MANIFEST = "agent-connect-screens.json";
const MANIFEST = /^agent-connect-screens(\..+)?\.json$/;

/** Every manifest in `dir`, the base first by its name, the others in name order (as the jest catalogue reads them). */
export function readManifests(dir, read = (f) => readFileSync(join(dir, f), "utf8"), list = () => readdirSync(dir)) {
  const names = list().filter((f) => MANIFEST.test(f));
  if (!names.includes(BASE_MANIFEST)) throw new Error(`no ${BASE_MANIFEST} in ${dir}`);
  const ordered = [BASE_MANIFEST, ...names.filter((f) => f !== BASE_MANIFEST).sort()];
  return ordered.map((file) => ({ file, ...JSON.parse(read(file)) }));
}

/**
 * The routes from the app's home, as steps. `tap` presses a testID, `type` sets text on one, `wait` waits for one.
 * Each ends on the screen its name says.
 */
export const ROUTES = {
  // The My Agent tab opens on "AI agents" with the switch on (R2, step 7.8).
  aiAgents: [{ tap: "MyAgent" }, { wait: "AgentList" }],
  // "Connect an agent", then the form once the guard has checked the VTA (ConnectAgentChecking passes on its own).
  connectForm: [{ route: "aiAgents" }, { tap: "AgentListConnect" }, { wait: "ConnectAgentForm" }],
  // The form filled in, then Continue: the pairing starts at the VTA and the scanner opens.
  connectScan: [
    { route: "connectForm" },
    { type: "ConnectAgentName", text: "Notes helper" },
    { pressLabel: "Education", within: "MemoryPickerRow" },
    { tap: "ConnectAgentContinue" },
    { wait: "ConnectScan" },
  ],
  // Settings: the tab bar's Settings, as openDeveloperScreen reaches it.
  settings: [{ tap: "Settings" }, { wait: "MyVtaRow" }],
};

/**
 * What a state needs that this walk cannot give it. Each is a fact about the setup, not a judgement of the state.
 */
export const NEEDS = {
  agent: "a connected agent: the pairing harness on the lab (ref-25, step 7.5) on the other end",
  failure: "a failure induced at the VTA or the mediator, which the lab can stage and a plain walk does not",
  transient: "a state the app passes through on its own in about a second; caught only by luck",
  twoAgents: "several agents in different states at once (expired, unreachable, revoked)",
  noRoute: "a screen registered in the navigator that nothing in the app opens yet",
  personas: "a lab VTA with two personas, so the form asks which one",
};

/**
 * Per catalogue state: `{ route }` (with the manifest's steps after it), or `{ needs, note? }`. The lab VTA, linked and
 * administered by the phone, is assumed for every route: without it the form shows the not-an-administrator end.
 */
export const REACH = {
  // agent-connect-screens.json (step 7.7)
  "connect-name": { route: "connectForm" },
  "connect-new-memory": { route: "connectForm" },
  "connect-checking": { needs: "transient" },
  "connect-not-administrator": { needs: "failure", note: "a phone whose VTA session is not a full administrator" },
  "connect-vta-too-old": { needs: "failure", note: "a VTA that serves none of the auth/oob versions" },
  "connect-unreachable": { needs: "failure", note: "the VTA unreachable at the guard's check" },
  scan: { route: "connectScan" },
  "scan-paste": { route: "connectScan" },
  number: { needs: "agent" },
  "end-wrong-number": { needs: "agent" },
  "end-expired": { needs: "agent", note: "and 300 seconds without a scan" },
  "end-spent": { needs: "agent" },
  "end-foreign-vta": { needs: "agent", note: "a code from a VTA this phone does not administer" },
  "end-not-a-pairing-code": { needs: "failure", note: "a pasted link that is not a pairing code" },
  "end-grant-refused": { needs: "failure" },
  "end-unsupported": { needs: "failure" },
  "end-rotation-lost-limits": { needs: "failure" },
  "end-handle-collision": { needs: "failure" },
  "end-invalid-choice": { needs: "failure" },
  "end-mediator-closed": { needs: "failure" },
  "end-terminal-refused": { needs: "agent", note: "the terminal declining the pairing" },
  "end-locked": { needs: "agent", note: "three wrong numbers in 60 minutes" },
  approve: { needs: "agent" },
  "approve-no-memory": { needs: "agent" },
  "approve-signals": { needs: "agent" },
  connecting: { needs: "transient" },
  connected: { needs: "agent" },
  list: { needs: "agent" },
  "list-states": { needs: "twoAgents" },
  details: { needs: "agent" },
  "details-drift": { needs: "failure", note: "the agent's entry changed outside Keyring" },
  "details-key-changed": { needs: "agent", note: "the agent moved to another key" },
  "details-expired": { needs: "agent", note: "and 4 hours" },
  "change-memories-widen": { needs: "agent" },
  "change-memories-narrow": { needs: "agent" },
  "contacts-row": { needs: "agent" },
  revoke: { needs: "agent" },
  "revoke-no-rooms": { needs: "agent" },
  "revoke-unreachable": { needs: "failure" },
  "revoke-not-confirmed": { needs: "failure" },
  // agent-connect-screens.delete.json (step 7.16)
  "memories-list": { needs: "noRoute", note: "AgentMemories is registered (R1); nothing navigates to it yet" },
  "memories-list-count-failed": { needs: "noRoute" },
  "memories-list-no-date": { needs: "noRoute" },
  "memories-list-counting": { needs: "noRoute" },
  "delete-memory": { needs: "noRoute" },
  "delete-memory-no-agents": { needs: "noRoute" },
  "delete-memory-unnamed-agent": { needs: "noRoute" },
  "delete-memory-over-limit": { needs: "noRoute" },
  "delete-memory-preview-unreachable": { needs: "noRoute" },
  "delete-memory-held": { needs: "noRoute" },
  "delete-memory-records-left": { needs: "noRoute" },
  "delete-memory-unreachable": { needs: "noRoute" },
  // agent-connect-screens.u5-acting-as.json (finding 18)
  "connect-acting-as": { needs: "personas" },
  "connect-acting-as-chosen": { needs: "personas" },
};

/**
 * App screens the walk visits that no manifest lists. Step 7.11 asks for every screen in the app, and a screen not in
 * §6's catalogue is listed as such, with its frame where one exists.
 */
export const EXTRAS = [
  { id: "ai-agents-empty", route: "aiAgents", marker: "AgentList", frame: null, why: "the list with no agent yet: frame 12 draws agents" },
  { id: "settings-my-vta", route: "settings", marker: "MyVtaRow", frame: "20-settings.png", why: "frame 20; not in the catalogue" },
];

/** Expand a route's `{ route }` steps into plain steps, refusing a cycle or an unknown route. */
export function expandRoute(name, routes = ROUTES, seen = []) {
  if (seen.includes(name)) throw new Error(`route cycle: ${[...seen, name].join(" > ")}`);
  const steps = routes[name];
  if (!steps) throw new Error(`no route named ${name}`);
  return steps.flatMap((s) => ("route" in s ? expandRoute(s.route, routes, [...seen, name]) : [s]));
}

/**
 * The walk's plan, in the manifests' order then the extras: per state, `walk` with its steps, or `notReached` with the
 * reason. Throws when the table names a state no manifest has.
 */
export function planWalk(manifests, reach = REACH, extras = EXTRAS, routes = ROUTES) {
  const states = manifests.flatMap((m) => m.states.map((s) => ({ ...s, manifest: m.file })));
  const known = new Set(states.map((s) => s.id));
  const stale = Object.keys(reach).filter((id) => !known.has(id));
  if (stale.length) throw new Error(`the walk names states no manifest has: ${stale.join(", ")}`);
  const plan = states.map((s) => {
    const r = reach[s.id];
    const base = { id: s.id, manifest: s.manifest, marker: s.marker, frame: s.frame ?? null, kit: s.kit ?? null };
    if (!r) return { ...base, status: "notReached", reason: "no route written for this state yet" };
    if (r.needs) {
      if (!NEEDS[r.needs]) throw new Error(`unknown need ${r.needs} for ${s.id}`);
      return { ...base, status: "notReached", reason: NEEDS[r.needs] + (r.note ? ` (${r.note})` : "") };
    }
    return { ...base, status: "walk", steps: [...expandRoute(r.route, routes), ...(s.steps ?? [])] };
  });
  for (const e of extras) {
    plan.push({
      id: e.id,
      manifest: null,
      marker: e.marker,
      frame: e.frame,
      kit: null,
      status: "walk",
      steps: expandRoute(e.route, routes),
      extra: e.why,
    });
  }
  return plan;
}

/** The pairs file the dated companion is written from: one row per state, walked or not, never fewer. */
export function pairsFile(plan, results, { platform, appCommit, planCommit, date }) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const rows = plan.map((p) => {
    const r = byId.get(p.id);
    const outcome = p.status === "notReached" ? `not reached: ${p.reason}` : r ? r.outcome : "walk stopped before it";
    const shot = r?.screenshot ?? "";
    const frame = p.frame ?? "(no frame)";
    const extra = p.extra ? ` (not in the catalogue: ${p.extra})` : "";
    return `| ${p.id}${extra} | ${frame} | ${shot} | ${outcome} |`;
  });
  return [
    `# Agent connect, step 7.11 walk: ${platform}, ${date}`,
    "",
    `App ${appCommit}; plan ${planCommit}. Every difference between a screenshot and its frame needs a disposition`,
    "(fixed, mockup updated, or accepted) in the dated companion; this file only pairs them.",
    "",
    "| State | Frame | Screenshot | Outcome |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
