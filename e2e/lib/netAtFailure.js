/**
 * What the network looked like at the moment a link run failed (11-08, the coordinator after 02's trace).
 *
 * "Keyring couldn't reach its message service" fires only when Credo's DIDComm start fails on the network to the
 * build's MEDIATOR_URL, our own credo-mediator. On 11-08 at 10:33–10:39Z (refused, the Mac mini, emulator-5572) and on
 * 11-07 at about 19:17Z (a smoke-android, the Mac mini, emulator-5570), that mediator logged no request at all. The
 * gate's pre-onboarding probe (lib.sh emu_net_ready) said "NOT reached" before the first one, and "reached" 3 s in
 * before the second, which then failed minutes later. So the probe is taken again here, at the failure itself, from
 * both sides: inside the emulator (TCP 443 by nc, else the name by ping, and its DNS server) and on the Mac (the name,
 * and an HTTPS request's timing). Logged only; it never changes the run's outcome.
 *
 * The host is GATE_NET_PROBE_HOST (the envs set it to the app's own mediator), else RUNNER_MEDIATOR_HOST.
 */
import { execFileSync } from "node:child_process";

const run = (cmd, args, timeout = 15000) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? "").trim() || String(e.message).split("\n")[0] };
  }
};

/** The probe's lines, `[net]`-prefixed. `exec(cmd, args)` returns { ok, out } (injectable for tests). */
export function netAtFailure({ host, serial, platform, exec = run, now = () => new Date().toISOString() } = {}) {
  if (!host) return ["[net] at failure: no probe host (GATE_NET_PROBE_HOST / RUNNER_MEDIATOR_HOST), not checked"];
  const lines = [`[net] at failure ${now()}: probing ${host}`];
  if (platform === "android" && serial) {
    const tcp = exec("adb", ["-s", serial, "shell", `echo | nc -w 3 ${host} 443 >/dev/null 2>&1 && echo tcp || echo no-tcp`]);
    const ping = exec("adb", ["-s", serial, "shell", `ping -c 1 -W 3 ${host} 2>&1 | head -1`]);
    const dns = exec("adb", ["-s", serial, "shell", "getprop net.dns1; getprop net.dns2"]);
    lines.push(`[net] emulator ${serial}: tcp 443 ${tcp.out.replace(/\r/g, "") || "?"} · ping "${ping.out.replace(/\r/g, "").slice(0, 120)}" · dns ${dns.out.replace(/\s+/g, " ").trim() || "?"}`);
  }
  const name = exec("dscacheutil", ["-q", "host", "-a", "name", host]);
  const addrs = (name.out.match(/ip_address: \S+/g) ?? []).map((a) => a.slice(12));
  lines.push(`[net] mac: ${host} resolves to ${addrs.length ? addrs.join(", ") : "nothing"}`);
  const https = exec("curl", ["-sS", "-m", "10", "-o", "/dev/null", "-w", "%{http_code} connect %{time_connect}s total %{time_total}s", `https://${host}/`]);
  lines.push(`[net] mac: https://${host}/ ${https.ok ? https.out : `failed: ${https.out.slice(0, 120)}`}`);
  return lines;
}
