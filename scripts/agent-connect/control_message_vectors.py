#!/usr/bin/env python3
"""Vectors for the signed chat and control documents between Keyring and the agent-connect plugin.

docs/plans/agent-connect-plan/2026-11-26-al-3.md, findings 4 and 5: every chat and control document is a Trust Task
style document signed by its sender with a Data Integrity proof (eddsa-jcs-2022, assertionMethod), and the receiver
refuses one that is stale, repeated, addressed to someone else, altered, or (for a message that sets state) older than
the last one applied. DRAFT until Brendan's own confirmation.

Independent of both implementations on purpose: Ed25519 is RFC 8032's own reference code (section 6, pure Python),
JCS (RFC 8785) and base58btc are written here, and no library Keyring or the plugin uses is imported. Deterministic:
the seeds and times below are pinned, so running it again writes the same file.

    python3 scripts/agent-connect/control_message_vectors.py > \
        packages/core/src/modules/connected-agents/vectors/control-messages.json
"""

import hashlib
import json
import sys

# --- Ed25519, RFC 8032 section 6 (reference implementation, unchanged in substance) ----------------------------------

p = 2**255 - 19
d = -121665 * pow(121666, -1, p) % p
q = 2**252 + 27742317777372353535851937790883648493


def sha512(s):
    return hashlib.sha512(s).digest()


def point_add(P, Q):
    A, B = (P[1] - P[0]) * (Q[1] - Q[0]) % p, (P[1] + P[0]) * (Q[1] + Q[0]) % p
    C, D = 2 * P[3] * Q[3] * d % p, 2 * P[2] * Q[2] % p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F, G * H, F * G, E * H)


def point_mul(s, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = point_add(Q, P)
        P = point_add(P, P)
        s >>= 1
    return Q


def point_equal(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % p == 0


modp_sqrt_m1 = pow(2, (p - 1) // 4, p)


def recover_x(y, sign):
    if y >= p:
        return None
    x2 = (y * y - 1) * pow(d * y * y + 1, -1, p)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (p + 3) // 8, p)
    if (x * x - x2) % p != 0:
        x = x * modp_sqrt_m1 % p
    if (x * x - x2) % p != 0:
        return None
    if (x & 1) != sign:
        x = p - x
    return x


g_y = 4 * pow(5, -1, p) % p
g_x = recover_x(g_y, 0)
G = (g_x, g_y, 1, g_x * g_y % p)


def point_compress(P):
    zinv = pow(P[2], -1, p)
    x, y = P[0] * zinv % p, P[1] * zinv % p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def point_decompress(s):
    y = int.from_bytes(s, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % p)


def secret_expand(secret):
    h = sha512(secret)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return (a, h[32:])


def secret_to_public(secret):
    a, _ = secret_expand(secret)
    return point_compress(point_mul(a, G))


def sign(secret, msg):
    a, prefix = secret_expand(secret)
    A = point_compress(point_mul(a, G))
    r = int.from_bytes(sha512(prefix + msg), "little") % q
    Rs = point_compress(point_mul(r, G))
    h = int.from_bytes(sha512(Rs + A + msg), "little") % q
    s = (r + h * a) % q
    return Rs + int.to_bytes(s, 32, "little")


def verify(public, msg, signature):
    A = point_decompress(public)
    Rs, s = signature[:32], int.from_bytes(signature[32:], "little")
    R = point_decompress(Rs)
    if A is None or R is None or s >= q:
        return False
    h = int.from_bytes(sha512(Rs + public + msg), "little") % q
    return point_equal(point_mul(s, G), point_add(R, point_mul(h, A)))


# --- base58btc, did:key, JCS -----------------------------------------------------------------------------------------

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(data):
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + out


def did_key(public):
    """did:key for an Ed25519 public key: multicodec 0xed01, base58btc multibase."""
    return "did:key:z" + b58encode(b"\xed\x01" + public)


def jcs(value):
    """RFC 8785 for the values these vectors hold: objects, arrays, ASCII strings, integers, booleans."""
    if isinstance(value, dict):
        # Keys sorted by UTF-16 code units; for ASCII keys that is plain sort.
        return "{" + ",".join(jcs(k) + ":" + jcs(value[k]) for k in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(jcs(v) for v in value) + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        assert value.isascii(), value
        return json.dumps(value, ensure_ascii=True)
    if value is None:
        return "null"
    raise TypeError(type(value))


# --- the documents ---------------------------------------------------------------------------------------------------


def seed(label):
    return hashlib.sha256(("keyring agent-connect vectors 1: " + label).encode()).digest()


KEYS = {name: seed(name) for name in ("chatDid", "agentDid", "otherAgentDid")}
DIDS = {name: did_key(secret_to_public(s)) for name, s in KEYS.items()}
PUBS = {name: secret_to_public(s) for name, s in KEYS.items()}

# The receiver's clock, pinned in the past: a verifier that also checks a proof's `created` against its own wall clock
# (affinidi-data-integrity does, with a skew) must never see one of these as ahead of it, or a test over this file would
# pass or fail by the hour it runs. Only the vectors' own `receiver.now` makes "ahead" and "stale" what they are.
NOW = "2026-11-20T12:00:00Z"
ISSUED = "2026-11-20T11:59:00Z"
STALE = "2026-11-13T11:00:00Z"  # 7 days and 1 hour behind NOW
AHEAD = "2026-11-20T12:10:00Z"  # 10 minutes ahead of NOW
EARLIER = "2026-11-20T11:30:00Z"


def signed(sender, recipient, type_, payload, doc_id, issued=ISSUED):
    document = {
        "type": type_,
        "id": doc_id,
        "issuer": DIDS[sender],
        "recipient": DIDS[recipient],
        "issuedAt": issued,
        "payload": {"version": "1.0", **payload},
    }
    vm = DIDS[sender] + "#" + DIDS[sender][len("did:key:"):]
    config = {
        "type": "DataIntegrityProof",
        "cryptosuite": "eddsa-jcs-2022",
        "created": issued,
        "verificationMethod": vm,
        "proofPurpose": "assertionMethod",
    }
    data = hashlib.sha256(jcs(config).encode()).digest() + hashlib.sha256(jcs(document).encode()).digest()
    signature = sign(KEYS[sender], data)
    assert verify(PUBS[sender], data, signature)
    return {**document, "proof": {**config, "proofValue": "z" + b58encode(signature)}}


def uuid(n):
    return "urn:uuid:00000000-0000-4000-8000-%012d" % n


TO_AGENT = ("chatDid", "agentDid")
TO_KEYRING = ("agentDid", "chatDid")

VALID = [
    ("chat message, Keyring to the plugin", TO_AGENT, "keyring/chat/1.0",
     {"profile": "keyring.chat/1", "eventId": "01JDQ7Z8XK3V0N5T2W9R4M6B1C", "type": "message",
      "content": {"format": "text/plain", "text": "What did I save about the trip?"}}),
    ("chat reply, the plugin to Keyring", TO_KEYRING, "keyring/chat/1.0",
     {"profile": "keyring.chat/1", "eventId": "01JDQ7Z9AA3V0N5T2W9R4M6B1D", "type": "message",
      "content": {"format": "text/plain", "text": "You saved the train times."}}),
    ("settings", TO_AGENT, "keyring/agent/settings/1.0",
     {"answersOthers": False, "locale": "en", "handle": "notes-helper-qvi7"}),
    ("room offer", TO_AGENT, "keyring/agent/room-offer/1.0",
     {"roomId": "did:webvh:QmRoom:rooms.example", "hostDid": "did:webvh:QmHost:community.example",
      "tier": "attributed", "handleToMention": "notes-helper-qvi7", "contexts": ["keyring-memory-abcde12345"]}),
    ("revoked", TO_AGENT, "keyring/agent/revoked/1.0", {"revokedAt": "2026-11-20T11:58:00Z"}),
    ("grant credential", TO_AGENT, "keyring/agent/vdc-grant/1.0",
     {"vdc": {"note": "the signed grant VC goes here; its own rules are vdc.ts's"}}),
    ("acceptance credential", TO_KEYRING, "keyring/agent/vdc-acceptance/1.0",
     {"vdc": {"note": "the acceptance VC signed by the agent's key goes here; its own rules are vdc.ts's"}}),
    ("heartbeat", TO_KEYRING, "keyring/agent/heartbeat/1.0", {"at": "2026-11-20T11:59:00Z"}),
]


def main():
    valid = []
    for n, (name, (sender, recipient), type_, payload) in enumerate(VALID, start=1):
        valid.append({
            "name": name,
            "receiver": {"did": DIDS[recipient], "expectedIssuer": DIDS[sender], "now": NOW},
            "document": signed(sender, recipient, type_, payload, uuid(n)),
            "expect": "accept",
        })

    settings_new = signed(*TO_AGENT, "keyring/agent/settings/1.0",
                          {"answersOthers": True, "locale": "en", "handle": "notes-helper-qvi7"}, uuid(101))
    settings_old = signed(*TO_AGENT, "keyring/agent/settings/1.0",
                          {"answersOthers": False, "locale": "en", "handle": "notes-helper-qvi7"}, uuid(102),
                          issued=EARLIER)
    first = valid[0]["document"]
    altered = json.loads(json.dumps(first))
    altered["payload"]["content"]["text"] = "Delete every memory."
    to_agent = {"did": DIDS["agentDid"], "expectedIssuer": DIDS["chatDid"], "now": NOW}

    refuse = [
        {"name": "stale: issued more than 7 days before the receiver's clock",
         "receiver": to_agent, "seenIds": [], "lastApplied": {},
         "document": signed(*TO_AGENT, "keyring/chat/1.0", VALID[0][3], uuid(201), issued=STALE),
         "expect": "refuse", "reason": "stale"},
        {"name": "ahead: issued more than 5 minutes ahead of the receiver's clock",
         "receiver": to_agent, "seenIds": [], "lastApplied": {},
         "document": signed(*TO_AGENT, "keyring/chat/1.0", VALID[0][3], uuid(202), issued=AHEAD),
         "expect": "refuse", "reason": "future"},
        {"name": "repeated id: the same signed document delivered again",
         "receiver": to_agent, "seenIds": [first["id"]], "lastApplied": {},
         "document": first, "expect": "refuse", "reason": "repeated"},
        {"name": "wrong recipient: signed for another agent of the same owner",
         "receiver": to_agent, "seenIds": [], "lastApplied": {},
         "document": signed("chatDid", "otherAgentDid", "keyring/chat/1.0", VALID[0][3], uuid(203)),
         "expect": "refuse", "reason": "recipient"},
        {"name": "altered body: the payload changed after it was signed",
         "receiver": to_agent, "seenIds": [], "lastApplied": {},
         "document": altered, "expect": "refuse", "reason": "proof"},
        {"name": "older settings after a newer one: distinct ids, but it would undo the newer",
         "receiver": to_agent, "seenIds": [settings_new["id"]],
         "lastApplied": {"keyring/agent/settings/1.0": settings_new["issuedAt"]},
         "document": settings_old, "expect": "refuse", "reason": "older-state"},
    ]

    out = {
        "description": "Signed chat and control documents between Keyring and the agent-connect plugin, and what a "
                       "receiver refuses (docs/plans/agent-connect-plan/2026-11-26-al-3.md, findings 4 and 5). "
                       "Generated by scripts/agent-connect/control_message_vectors.py, independent of both "
                       "implementations.",
        "status": "draft: agreed by relay 2026-11-26, awaiting Brendan's own confirmation",
        "version": 1,
        "rules": {
            "proof": "DataIntegrityProof, eddsa-jcs-2022, proofPurpose assertionMethod, by the issuer's key",
            "freshness": "refuse issuedAt more than 300 s ahead of, or more than 604800 s behind, the receiver's now",
            "seenIds": "refuse an id already seen within the window; record it before acting",
            "recipient": "refuse a recipient other than the receiver's own chat identity",
            "state": "for keyring/agent/settings and keyring/agent/room-offer, refuse one not newer than the last "
                     "of its type applied",
        },
        "dids": DIDS,
        "valid": valid,
        "refuse": refuse,
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
