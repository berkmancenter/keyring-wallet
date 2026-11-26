#!/usr/bin/env python3
"""Derive the lab mediator's configuration for one mode from the file mediator-setup wrote.

  open     as generated: explicit_deny with global_acl_default = ALLOW_ALL (the starter's open ACL)
  mailbox  every setting of the production wallet mailbox (deploy/keyring-messaging/mailbox/mailbox.toml)
           that is not about where it runs
  deny     global_acl_default = DENY_ALL, nothing else changed

The mailbox's values are read from mailbox.toml, never typed here, so this cannot drift from what is deployed.
Prints, as JSON, what was set and what still differs from the mailbox and why. Needs Python 3.11 (tomllib).
"""
import json
import re
import sys
import tomllib

# Settings that say where a mediator runs or who it is. They differ on a lab by design.
HOST_SPECIFIC = {
    "mediator_did": "the lab mediator's own identity",
    "log_json": "log format only",
    "database.database_url": "the lab's own Redis",
    "server.listen_address": "loopback",
    "server.admin_did": "the lab mediator's own administrator",
    "server.trust_xff_cidrs": "the mailbox sits behind a proxy; the lab has none, so every client is 127.0.0.1 to the per-IP limit",
    "server.did_web_self_hosted": "the mailbox serves its own did:webvh log; the lab mediator is a did:peer",
    "security.cors_allow_origin": "a browser origin; the rung's clients are Node and send none",
}


def flat(table, prefix=""):
    out = {}
    for key, value in table.items():
        if isinstance(value, dict):
            out.update(flat(value, f"{prefix}{key}."))
        else:
            out[f"{prefix}{key}"] = value
    return out


def render(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(render(v) for v in value) + "]"
    return json.dumps(value)


def set_key(lines, dotted, value):
    """Set `section.key` in place: replace its line (commented or not) in that section, or add it under the header."""
    section, _, key = dotted.rpartition(".")
    header = re.compile(r"^\[(.+)\]\s*$")
    wanted = re.compile(rf"^(#\s*)?{re.escape(key)}\s*=")
    current = ""
    start = None
    for index, line in enumerate(lines):
        match = header.match(line)
        if match:
            current = match.group(1)
            if current == section:
                start = index
            continue
        if current == section and wanted.match(line) and not line.startswith("###"):
            lines[index] = f"{key} = {render(value)}"
            return
    if section and start is None:
        raise SystemExit(f"no [{section}] section to put {key} in")
    lines.insert((start + 1) if section else 0, f"{key} = {render(value)}")


def main():
    if len(sys.argv) != 5 or sys.argv[1] not in ("open", "mailbox", "deny"):
        raise SystemExit("usage: mediator_config.py <open|mailbox|deny> <generated.toml> <mailbox.toml> <out.toml>")
    mode, generated_path, mailbox_path, out_path = sys.argv[1:]
    with open(generated_path, "rb") as handle:
        generated = flat(tomllib.load(handle))
    with open(mailbox_path, "rb") as handle:
        mailbox = flat(tomllib.load(handle))
    with open(generated_path, encoding="utf-8") as handle:
        lines = handle.read().split("\n")

    overrides = {}
    if mode == "mailbox":
        for key, value in mailbox.items():
            if key in HOST_SPECIFIC or generated.get(key) == value:
                continue
            overrides[key] = value
    elif mode == "deny":
        overrides["security.global_acl_default"] = "DENY_ALL"

    for key, value in overrides.items():
        set_key(lines, key, value)
    text = "\n".join(lines)
    result = flat(tomllib.loads(text))
    for key, value in overrides.items():
        if result.get(key) != value:
            raise SystemExit(f"{key} did not take: wanted {value!r}, file says {result.get(key)!r}")
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(text)

    still = {}
    for key in sorted(set(result) | set(mailbox)):
        if result.get(key) != mailbox.get(key):
            if key in mailbox or key in HOST_SPECIFIC:
                still[key] = HOST_SPECIFIC.get(key, "differs" if mode != "mailbox" else "UNEXPLAINED")
    if mode == "mailbox" and "UNEXPLAINED" in still.values():
        raise SystemExit(f"settings differ from the mailbox with no stated reason: {[k for k, v in still.items() if v == 'UNEXPLAINED']}")
    watched = [
        "security.mediator_acl_mode",
        "security.global_acl_default",
        "security.block_anonymous_outer_envelope",
        "security.force_session_did_match",
        "limits.queued_send_messages_per_peer",
        "limits.queued_send_messages_soft",
        "limits.queued_send_messages_hard",
        "limits.queued_receive_messages_soft",
        "limits.queued_receive_messages_hard",
        "limits.rate_limit_per_ip",
        "limits.rate_limit_burst",
        "limits.did_rate_limit_per_second",
        "limits.did_rate_limit_burst",
        "processors.forwarding.external_forwarding",
        "processors.wake.enabled",
    ]
    print(json.dumps({
        "mode": mode,
        "set": overrides,
        "settings": {key: result.get(key) for key in watched},
        "differsFromMailbox": still if mode == "mailbox" else None,
    }, indent=2))


if __name__ == "__main__":
    main()
