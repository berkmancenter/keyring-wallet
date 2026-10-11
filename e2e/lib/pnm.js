/**
 * One pnm call on a runner agent, the way every driver should make it:
 * through the slug's lock (scripts/openvtc/pnm-locked), and riding out the
 * Farm's rate limit instead of failing on it.
 *
 * Lifted from run-vta-approvals.js (wallet #331). The 236 gate's setup met the
 * Farm's rate limit at 12:48Z with back-to-back pnm calls, and a driver that
 * took the 429 as an answer failed a row the app never touched.
 *
 *   import { pnmCall } from "./lib/pnm.js";
 *   const out = pnmCall(["approvals", "list"], { slug: "farm3-runner-prague" });
 *   const list = pnmCall(["approvals", "list", "--json"], { slug, json: true });
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownedBy } from "./aclCleanup.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The lock wrapper every pnm call goes through: one call per pnm identity at a time on this Mac. */
export const PNM_LOCKED = path.resolve(here, "../../scripts/openvtc/pnm-locked");
/** The pnm binary, as the drivers already choose it. */
export const defaultPnmBin = () => process.env.PNM_BIN || path.join(os.homedir(), "vti-stack/bin/pnm");

/** A rate-limit answer, from the agent or from the proxy in front of it. */
export const RATE_LIMITED = /\b429\b|too many requests|rate.?limit|proxy \/ load balancer/i;

/** Block for `ms` without spinning: pnmCall is synchronous, like the execFileSync it wraps. */
export const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Leave this long between setup calls: back to back they met the Farm's rate limit (236, 12:48Z). */
export const pnmSpacing = (ms = 3000) => pause(ms);

/**
 * Run `pnm --vta <slug> <args…>` through the lock. Returns what it printed
 * (stdout then stderr), whatever its exit status: a refusal is an answer the
 * caller reads. A rate-limited answer is retried after 5, 10, 20, 40 s
 * (`retries` of them), each logged as `RATE-LIMITED <iso> pnm <args> (attempt n)`,
 * which is evidence for the Farm's rate-limit question as well as a retry.
 *
 * With `json: true` the output is parsed from its first "{" (pnm prints
 * "VTA:"/"DID:" header lines before the JSON) and the object returned; output
 * with no JSON in it throws, naming its last line.
 *
 * With `E2E_PNM_TIMING=1` each attempt also prints `PNM <slug> <args> <ms>ms`,
 * for a run's wall-clock accounting.
 *
 * `exec`, `sleep`, `now` and `timing` are for tests.
 */
export function pnmCall(
  args,
  {
    slug,
    pnmBin = defaultPnmBin(),
    locked = PNM_LOCKED,
    timeout = 120000,
    retries = 4,
    json = false,
    exec = execFileSync,
    sleep = pause,
    log = console.log,
    now = Date.now,
    timing = process.env.E2E_PNM_TIMING === "1",
  } = {}
) {
  if (!slug) throw new Error("pnmCall: no slug (the runner agent's pnm slug)");
  let out = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = now();
    try {
      out = exec(locked, ["--vta", slug, ...args], {
        encoding: "utf8",
        timeout,
        env: { ...process.env, PNM_BIN: pnmBin },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}` || String(err.message);
    }
    if (timing) log(`PNM ${slug} ${args.slice(0, 3).join(" ")} ${now() - started}ms`);
    if (!RATE_LIMITED.test(out)) break;
    log(`RATE-LIMITED ${new Date().toISOString()} pnm ${args.slice(0, 3).join(" ")} (attempt ${attempt + 1})`);
    if (attempt < retries) sleep(5000 * 2 ** attempt);
  }
  return json ? parsePnmJson(out) : out;
}

/** pnm's JSON output, read from its first "{" past the header lines. */
export function parsePnmJson(out) {
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`pnm printed no JSON: ${out.trim().split("\n").pop()?.slice(0, 160) ?? ""}`);
  return JSON.parse(out.slice(start));
}

/**
 * `pnm --vta <slug> cred-vault query --filter-file <f> --json`: what the
 * runner agent's credential vault holds that matches `filter` (any of `type`,
 * `communityDid`, `issuerDid`, `purpose`, `status`; at least one — VTI
 * pnm-cli/src/cli.rs CredVaultCommands::Query, vta-vault query.rs
 * CredentialQuery). The filter goes through a file of its own, never stdin
 * (`-`): the gate's pnm calls must not read stdin. The vault files a card by
 * the purpose it infers from the card's type, and a DTG role card
 * (AuthorityCredential) matches none (vta-vault receive.rs infer_purpose), so
 * ask for that one by `{ type: "AuthorityCredential" }`.
 *
 * Returns `{ ids, credentials }`: the descriptors' ids, and the descriptors
 * (body-free). A refusal, or output with no JSON, throws with pnm's last line.
 * `pnmCall`'s options (exec, sleep, log, …) pass through, for tests.
 */
export function credVaultQuery(filter, { slug, ...opts } = {}) {
  if (!filter || typeof filter !== "object" || !Object.keys(filter).length) throw new Error("credVaultQuery: an empty filter (the vault refuses an enumeration)");
  const dir = mkdtempSync(path.join(os.tmpdir(), "cred-vault-query-"));
  const file = path.join(dir, "filter.json");
  try {
    writeFileSync(file, JSON.stringify(filter));
    const out = pnmCall(["cred-vault", "query", "--filter-file", file, "--json"], { slug, ...opts });
    const credentials = vaultDescriptors(out);
    return { ids: credentials.map((c) => c?.id).filter((id) => typeof id === "string" && id), credentials };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The descriptors in a cred-vault query's output: `{ credentials: [...] }`, or a bare array. */
export function vaultDescriptors(out) {
  const at = [out.indexOf("{"), out.indexOf("[")].filter((i) => i >= 0);
  if (!at.length) throw new Error(`pnm printed no JSON: ${out.trim().split("\n").pop()?.slice(0, 160) ?? ""}`);
  const parsed = JSON.parse(out.slice(Math.min(...at)));
  const list = Array.isArray(parsed) ? parsed : parsed.credentials;
  if (!Array.isArray(list)) throw new Error(`cred-vault query: no credentials list in ${JSON.stringify(parsed).slice(0, 160)}`);
  return list;
}

/** pnm's JSON output, array or object, read from the first line that opens one (past "VTA:"/"DID:" headers). */
export function parsePnmJsonAny(out) {
  const m = /^[ \t]*[[{]/m.exec(out);
  if (!m) throw new Error(`pnm printed no JSON: ${out.trim().split("\n").pop()?.slice(0, 160) ?? ""}`);
  return JSON.parse(out.slice(m.index));
}

/** What clap prints for a subcommand or flag this pnm does not have: the command is missing, not refused. */
export const PNM_LACKS = /unrecognized subcommand|unexpected argument|invalid subcommand|unknown command/i;

/** An Error saying this pnm lacks `what`, marked `lacks: true` so a row can SKIP on it instead of failing. */
const lacking = (what, out) => Object.assign(new Error(`this pnm has no \`${what}\`: ${out.trim().split("\n").pop()?.slice(0, 120) ?? ""}`), { lacks: true });

/** A context id as an ACL scope or a whoami scope spells it: `ctx:<id>` (whoami) or the bare id (acl entry). */
export const scopeContext = (scope) => String(scope).replace(/^ctx:/, "");

/**
 * `pnm did-mgmt dids get <did>`: the id of the context the agent keeps this DID in. The command has no JSON form
 * (VTI pnm-cli cli.rs DidMgmtDidCommands::Get → vta-cli-common commands/webvh.rs cmd_webvh_did_get, which prints
 * `  Context:         <id>` from the record's context_id), so the line is read. Throws with `lacks: true` when this
 * pnm has no such command, else with pnm's last line when no Context line came back (an unknown DID, a refusal).
 */
export function didContext(did, { slug, ...opts } = {}) {
  if (!did) throw new Error("didContext: no DID");
  const out = pnmCall(["did-mgmt", "dids", "get", did], { slug, ...opts }).replace(/\x1b\[[0-9;]*m/g, "");
  if (PNM_LACKS.test(out)) throw lacking("did-mgmt dids get", out);
  const m = /^\s*Context:\s*(\S+)/m.exec(out);
  if (!m) throw new Error(`dids get: no Context line: ${out.trim().split("\n").pop()?.slice(0, 160) ?? ""}`);
  return m[1];
}

/**
 * `pnm contexts list --json`: the agent's contexts the runner's key may see, in the agent's own order — the order
 * Keyring's `vta/contexts/list/1.0` gets them in too (vta-service operations/contexts.rs list_contexts filters the
 * store's list by the caller's access), so `[0]` is what bifold VtaClient.ensurePersonaOnce takes as contexts[0].
 * Returns `[{ id, name }]`. Throws with `lacks: true` when this pnm has no such command.
 */
export function contextsList({ slug, ...opts } = {}) {
  const out = pnmCall(["contexts", "list", "--json"], { slug, ...opts });
  if (PNM_LACKS.test(out)) throw lacking("contexts list --json", out);
  const parsed = parsePnmJsonAny(out);
  const list = Array.isArray(parsed) ? parsed : parsed.contexts;
  if (!Array.isArray(list)) throw new Error(`contexts list: no list in ${JSON.stringify(parsed).slice(0, 160)}`);
  return list.filter((c) => c && typeof c.id === "string").map((c) => ({ id: c.id, name: typeof c.name === "string" ? c.name : "" }));
}

/**
 * `pnm acl list --json`: the agent's ACL rows as the canonical AclEntry spells them (vta-sdk client/types.rs
 * AclEntryResponse: `subject`, `role`, `scopes` — the contexts the row may act in, empty on an unrestricted admin —,
 * `createdBy`, `label`). Throws with `lacks: true` when this pnm has no such command.
 */
export function aclEntries({ slug, ...opts } = {}) {
  const out = pnmCall(["acl", "list", "--json"], { slug, ...opts });
  if (PNM_LACKS.test(out)) throw lacking("acl list --json", out);
  const parsed = parsePnmJsonAny(out);
  const list = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(list)) throw new Error(`acl list: no entries in ${JSON.stringify(parsed).slice(0, 160)}`);
  return list
    .filter((e) => e && typeof e.subject === "string")
    .map((e) => ({
      subject: e.subject,
      role: String(e.role ?? ""),
      scopes: Array.isArray(e.scopes) ? e.scopes.filter((s) => typeof s === "string").map(scopeContext) : [],
      createdBy: String(e.createdBy ?? ""),
      label: e.label,
    }));
}

/** Another app's context on a shared runner: the openvtc TUI fixtures' `openvtc-*` (and their sub-contexts). */
export const FOREIGN_CONTEXT = /^openvtc/i;

/**
 * IN-259's verdict, pure, from what was read: Keyring's new persona must not land in another app's context, which is
 * what minting in `contexts[0]` does (bifold VtaClient.ensurePersonaOnce) on a runner whose first context is another
 * app's. `personaContext` is the persona's context; `contexts` the agent's, in its order; `before` the context ids
 * read before the run made anything (a Set, or undefined when that read failed). Context ids only, never a DID.
 *   SKIP  one context (or none): the persona can be nowhere else, so the bug cannot show — a green row must mean
 *         "tested and fixed", so this is not a PASS;
 *   PASS  `vta` (the agent's default), a Keyring-named context (/keyring/i, id or name), or a context made during
 *         this run that is not another app's (the fix's own context);
 *   FAIL  another app's context (`openvtc-*`), or any context that was there before the run and is none of the
 *         above; or, with no `before`, a context that cannot be placed.
 * Returns `{ ok, detail }` or `{ skip }`. `note` (a phone's ACL scope, when known) is added to the detail only.
 */
export function personaContextVerdict({ personaContext, contexts, before, note }) {
  const first = contexts[0]?.id ?? "none";
  const agent = `agent contexts ${contexts.length} (${contexts.slice(0, 8).map((c) => c.id).join(", ")}${contexts.length > 8 ? ", …" : ""}), first ${first}`;
  const where = `persona context ${personaContext} (pnm did-mgmt dids get, its Context line)`;
  const tail = `${personaContext === first ? " · the persona is in the agent's first context" : ""}${note ? ` · ${note}` : ""} · ${agent}`;
  if (contexts.length <= 1) return { skip: `single context: the bug cannot show here · ${where}${note ? ` · ${note}` : ""} · ${agent}` };
  const named = contexts.find((c) => c.id === personaContext)?.name ?? "";
  const verdict = (ok, why) => ({ ok, detail: `${where}: ${why}${tail}` });
  if (personaContext === "vta") return verdict(true, "the agent's default context vta");
  if (/keyring/i.test(personaContext) || /keyring/i.test(named)) return verdict(true, "a Keyring context");
  if (FOREIGN_CONTEXT.test(personaContext)) return verdict(false, "another app's context (openvtc-*)");
  if (!before) return verdict(false, "cannot tell whose it is: the agent's contexts were not read before the run");
  if (!before.has(personaContext)) return verdict(true, `made during this run (not there before; ${before.size} were), not another app's`);
  return verdict(false, `there before this run and neither vta nor Keyring's: another app's`);
}

/**
 * This phone's rows among the agent's ACL `entries`: the keys the link run handed on in last-link.json (`link`:
 * `{ before, tempDid, heirs }`, run-vta-link.js keepForNextStep) — the temporary key and what it, or the rotated key
 * a manual link names as an heir, created (aclCleanup.js ownedBy). Undefined when there is no `link` to go by.
 */
export function phoneAclRows(entries, link) {
  if (!link || !link.tempDid) return undefined;
  const before = new Set(link.before ?? []);
  return ownedBy(
    entries.filter((e) => !before.has(e.subject)),
    link.tempDid,
    link.heirs ?? []
  );
}

/** The scope note for the verdict: what this phone's ACL rows are scoped to (a note only, never the verdict). */
export function scopeNote(phone) {
  if (!phone) return "";
  if (!phone.length) return "the phone's ACL scope: no row for this link's keys";
  const scopes = [...new Set(phone.flatMap((e) => e.scopes))];
  return scopes.length ? `the phone's ACL scope ${scopes.join(", ")}` : "the phone's ACL scope: unscoped (every context)";
}

/**
 * The agent's context ids now, read-only (`pnm contexts list --json`), for `personaContextCheck`'s `before`: taken
 * before the run makes anything there. Undefined, with the reason logged, when the read fails — the verdict then says
 * it cannot place a context that is not plainly vta, Keyring's or another app's.
 */
export function contextSnapshot({ slug, log = console.log, ...opts } = {}) {
  try {
    return new Set(contextsList({ slug, log, ...opts }).map((c) => c.id));
  } catch (e) {
    log(`contexts before the run on ${slug}: not read (${String(e?.message ?? e).split("\n")[0].slice(0, 160)})`);
    return undefined;
  }
}

/**
 * IN-259, read-only on an agent: is the persona `did` in a context Keyring may use, not another app's? pnm calls,
 * spaced (`spacing`, for the Farm's rate limit): `did-mgmt dids get` (the persona's context), `contexts list --json`
 * (the agent's contexts, in the order Keyring reads them), and only with a `link`, `acl list --json` (the phone's
 * scope, a note). Returns `personaContextVerdict`'s `{ ok, detail }` or `{ skip }`, and `{ skip }` too when this pnm
 * lacks a command the check needs. Anything else that goes wrong throws (a row's FAIL). `pnmCall`'s options pass
 * through, for tests.
 */
export function personaContextCheck(did, { slug, before, link, spacing = pnmSpacing, ...opts } = {}) {
  try {
    const personaContext = didContext(did, { slug, ...opts });
    spacing();
    const contexts = contextsList({ slug, ...opts });
    let note = "";
    if (link) {
      spacing();
      note = scopeNote(phoneAclRows(aclEntries({ slug, ...opts }), link));
    }
    return personaContextVerdict({ personaContext, contexts, before, note });
  } catch (e) {
    if (e?.lacks) return { skip: `pnm cannot read it: ${e.message}` };
    throw e;
  }
}
