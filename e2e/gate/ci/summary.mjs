#!/usr/bin/env node
/**
 * The CI smoke's report: the timing table (workflow marks and the leg's own steps, in start order), the HEADS
 * line, every ROW and the LEG line, as Markdown on $GITHUB_STEP_SUMMARY (and stdout). Exit 1 when a ROW says
 * FAIL, the leg printed BROKEN, or it never printed its LEG DONE line; exit 0 otherwise, so the job's result
 * follows the rows and not the leg's exit code (a SKIP row, or a driver's exit 3, is not a job failure).
 *
 *   node e2e/gate/ci/summary.mjs <marks.tsv> <leg dir> [<title>]
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const [marksFile, legDir, title = "Gate smoke"] = process.argv.slice(2);
const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const utc = (epoch) => new Date(epoch * 1000).toISOString().slice(11, 19) + "Z";
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Workflow marks: each step lasts until the next mark.
const marks = read(marksFile).trim().split("\n").filter(Boolean).map((l) => l.split("\t")).map(([name, t]) => ({ name, t: Number(t) }));
const steps = [];
for (let i = 0; i < marks.length - 1; i++) steps.push({ name: marks[i].name, start: marks[i].t, seconds: marks[i + 1].t - marks[i].t, from: "workflow" });
// The leg's own steps (smoke-ci.sh: name, start epoch, seconds).
for (const l of read(path.join(legDir, "steps.tsv")).trim().split("\n").filter(Boolean)) {
  const [name, start, seconds] = l.split("\t");
  steps.push({ name, start: Number(start), seconds: Number(seconds), from: "leg" });
}
steps.sort((a, b) => a.start - b.start || (a.from === "workflow" ? -1 : 1));
const total = marks.length > 1 ? marks[marks.length - 1].t - marks[0].t : 0;

const log = read(path.join(legDir, "leg.log"));
const heads = log.split("\n").find((l) => l.startsWith("HEADS ")) ?? "";
const rows = [...log.matchAll(/^ROW (.*?) (PASS|FAIL|SKIP) — (.*)$/gm)].map((m) => ({ name: m[1], status: m[2], detail: m[3] }));
const broken = log.split("\n").find((l) => /^LEG \S+ BROKEN — /.test(l)) ?? "";
const done = log.split("\n").find((l) => /^LEG \S+ DONE /.test(l)) ?? "";
const fails = rows.filter((r) => r.status === "FAIL").length;
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/`/g, "'");

const out = [];
out.push(`## ${title}`, "");
out.push(heads ? `\`${heads}\`` : "_no HEADS line: the leg did not start_", "");
out.push(`**Wall-clock from the first mark to the last: ${mmss(total)} (${total} s).**`, "");
out.push("| Step | Start (UTC) | Seconds | m:ss | From |", "|---|---|---:|---:|---|");
for (const s of steps) out.push(`| ${esc(s.name)} | ${utc(s.start)} | ${s.seconds} | ${mmss(s.seconds)} | ${s.from} |`);
out.push("", `### Rows: ${rows.filter((r) => r.status === "PASS").length} pass, ${fails} fail, ${rows.filter((r) => r.status === "SKIP").length} skip`, "");
out.push("| Status | Row | Detail |", "|---|---|---|");
for (const r of rows) out.push(`| ${r.status} | ${esc(r.name)} | ${esc(r.detail).slice(0, 300)} |`);
out.push("");
if (broken) out.push(`**${esc(broken)}**`, "");
out.push(done ? `\`${done}\`` : "_no LEG DONE line_", "");

const text = out.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
const bad = fails > 0 || Boolean(broken) || !done;
if (bad) console.log(`\nsummary: ${fails} FAIL row(s)${broken ? ", leg BROKEN" : ""}${done ? "" : ", no LEG DONE line"}`);
process.exit(bad ? 1 : 0);
