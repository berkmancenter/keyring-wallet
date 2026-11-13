"""
SEDI demo State office (K1): a local issuer with KEPT keys.

    roy-k1 (State root) --Unit--> deb-k1 (org unit) --Agent--> sue-k1 (issuing agent) --Guardian--> <holder>

The same profile as the K0 kit (bifold sedi/__tests__/fixtures/k0-utah-v2/PROVENANCE.json): keripy 7143832
(2.1.0-dev1), KERI/ACDC protocol 2, JSON; P-256 keys, SHA2-256 prefixes and next-key digests, Blake3 event/ACDC/TEL
SAIDs (keripy's), no witnesses, kt=1, I2I edges, one registry per credential, each registry event anchored by an
interaction-event seal in its issuer's KEL. Unlike K0, the keys are kept (an encrypted keripy store, opened with a
passcode), the nonces and registry salts are random, and the dates are real.

Commands (see README.md):
    office.py init     [--keystore DIR]
    office.py issue    --holder AID --ward AID [--valid-days N] [--role TEXT] [--label TEXT]
    office.py revoke   SAID
    office.py publish  (rewrite the publish tree from the store)
    office.py serve    [--port 8790]
    office.py show

Test issuer only: not a government service.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import getpass
import hmac
import html
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
DEFAULT_KEYSTORE = Path.home() / ".keyring-sedi-k1"
DEFAULT_KERIPY = Path.home() / ".cache" / "keyring-sedi-office" / "keripy"
CARD_TYPE = "keyring.sedi.guardian-card/0.1"
MAX_CARD_BYTES = 64 * 1024  # bifold GUARDIAN_EVIDENCE_MAX_BYTES: the phone refuses anything bigger
DID_PATH = "keyring-demo-state"  # the DID path segment under the site root, as K0's
HAB_NAME = "k1-state"
API_PORT = 8790  # the officer API: 127.0.0.1 only, never tunnelled
PUBLIC_PORT = 8798  # the public server (62's serve-demo-state.mjs) serves the publish tree here; never the API
K0_KIT_PATH = "packages/core/src/modules/sedi/__tests__/fixtures/k0-utah-v2"
# A folder, or git:<repo>:<ref> (read with git show, so no checkout has to be at that ref).
DEFAULT_K0_DIR = f"git:{Path.home() / 'Documents' / 'keyring-wallet' / 'bifold'}:origin/main"
K0_ROOT = "IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6"
ROLES = ("roy", "deb", "sue")
B64URL = re.compile(r"^[A-Za-z0-9_-]+$")
DEFAULT_STATE_NAME = "State of Utah"  # Alberto's display name; pages always add "(Demo)" and NOT_ISSUED_BY
DEFAULT_VALID_DAYS = 365
DEFAULT_ROLE = "legal guardian"
KEYCHAIN_SERVICE = "keyring-sedi-k1"


class OfficeError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status


# ---------------------------------------------------------------------------------------------------------------
# Codes and site addresses


def holder_problem(aid: str) -> str | None:
    """A guardian's holder code: a TRANSFERABLE self-addressing AID ('E' Blake3 or 'I' SHA2-256), 44 chars."""
    if not isinstance(aid, str) or len(aid) != 44 or not B64URL.match(aid) or aid[0] not in "EI":
        return "a holder code is a 44-character transferable AID starting with E or I"
    return None


def ward_problem(aid: str) -> str | None:
    """A ward code: a non-transferable AID, Ed25519 ('B', 44 chars) or P-256 ('1AAI', 48 chars), or transferable."""
    if not isinstance(aid, str) or not B64URL.match(aid or "-"):
        return "a ward code is a base64url AID"
    if (len(aid) == 44 and aid[0] in "BEI") or (len(aid) == 48 and aid.startswith("1AAI")):
        return None
    return "a ward code is a 44-character AID starting with B, E or I, or a 48-character one starting with 1AAI"


class Site:
    """Where the publish tree is served: https://<host>/<prefix…>/. Every DID and URL is built here, from two flags.

    host: a bare hostname, optionally with a port (only the port's ':' is %3A-encoded in a DID).
    prefix: path segments of the site root under the host ('' for our own hostname, '<bucket>' for a bucket URL).
    """

    def __init__(self, host: str, prefix: str = ""):
        if not host or "/" in host or "://" in host or not re.match(r"^[A-Za-z0-9.-]+(:[0-9]{1,5})?$", host):
            raise OfficeError("badHost", f"--host must be a bare hostname, optionally :port, got {host!r}")
        segs = [s for s in (prefix or "").strip("/").split("/") if s]
        for s in segs:
            if not re.match(r"^[A-Za-z0-9._~-]+$", s):
                raise OfficeError("badPathPrefix", f"--path-prefix segment {s!r} is not a plain path segment")
        self.host, self.segs = host, segs

    @property
    def label(self) -> str:
        return self.host.replace(":", "%3A")  # the host only, never a path

    def did_segments(self, aid: str) -> list[str]:
        return [*self.segs, DID_PATH, aid]

    def webs_did(self, aid: str) -> str:
        return ":".join(["did:webs", self.label, *self.did_segments(aid)])

    def web_did(self, aid: str) -> str:
        return ":".join(["did:web", self.label, *self.did_segments(aid)])

    def url(self, *path: str) -> str:
        return "https://" + "/".join([self.host, *self.segs, *path])

    def card_url(self, pickup_id: str, ext: str) -> str:
        return self.url("cards", f"{pickup_id}.{ext}")

    def offer_url(self, pickup_id: str) -> str:
        return "keyring://guardian-card?u=" + quote(self.card_url(pickup_id, "json"), safe="")


# ---------------------------------------------------------------------------------------------------------------
# Keystore


class Keystore:
    def __init__(self, path: Path):
        self.path = path.expanduser().resolve()
        for repo_marker in (".git",):
            for parent in [self.path, *self.path.parents]:
                if (parent / repo_marker).exists():
                    raise OfficeError("keystoreInRepo", f"the keystore {self.path} is inside a git checkout ({parent}); "
                                                        "keys must never be in a repo", 2)
        self.keys = self.path / "keys"
        self.publish = self.path / "publish"
        self.index = self.path / "office.json"
        self.salts = self.keys / "blind-salts.json"
        self.token_file = self.path / "officer.token"
        self.api_port_file = self.path / "api.port"
        self.lock_file = self.path / "office.lock"
        self._lock = None

    def ensure(self):
        self.path.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.path, 0o700)
        self.keys.mkdir(mode=0o700, exist_ok=True)
        self.publish.mkdir(mode=0o755, exist_ok=True)

    def lock(self):
        self._lock = open(self.lock_file, "w")
        try:
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OfficeError("busy", "another office.py (the server?) has this keystore open; stop it first", 3)

    def load(self) -> dict:
        return json.loads(self.index.read_text()) if self.index.exists() else {}

    def save(self, data: dict):
        tmp = self.index.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        os.chmod(tmp, 0o600)
        tmp.replace(self.index)

    def load_salts(self) -> dict:
        return json.loads(self.salts.read_text()) if self.salts.exists() else {}

    def save_salts(self, salts: dict):
        tmp = self.salts.with_suffix(".tmp")
        tmp.write_text(json.dumps(salts))
        os.chmod(tmp, 0o600)
        tmp.replace(self.salts)

    def token(self) -> str:
        if not self.token_file.exists():
            self.token_file.write_text(secrets.token_urlsafe(32))
            os.chmod(self.token_file, 0o600)
        return self.token_file.read_text().strip()


def keychain_passcode() -> str | None:
    """The passcode from the macOS Keychain item Alberto adds himself (service keyring-sedi-k1, account $USER).
    Never created, chosen, echoed or logged here. None when there is no such item."""
    if sys.platform != "darwin" or not shutil.which("security"):
        return None
    r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", getpass.getuser(), "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout.rstrip("\n") or None


PASSCODE_FROM_KEYCHAIN = None  # set by --passcode-from-keychain: True requires the item, False skips it


def passcode() -> str:
    """The Keychain item when it exists (the default), else KEYRING_SEDI_K1_PASSCODE, else a prompt."""
    code = None
    if PASSCODE_FROM_KEYCHAIN is not False:
        code = keychain_passcode()
        if not code and PASSCODE_FROM_KEYCHAIN:
            raise OfficeError("noKeychainItem", f"no Keychain item for service {KEYCHAIN_SERVICE}, account "
                                                f"{getpass.getuser()} (add it with security add-generic-password; "
                                                "see README)", 2)
    if not code:
        code = os.environ.get("KEYRING_SEDI_K1_PASSCODE")
    if not code:
        code = getpass.getpass("K1 keystore passcode (21+ chars): ")
    if len(code) < 21:
        raise OfficeError("badPasscode", "the passcode must be at least 21 characters (keripy's bran)", 2)
    return code


# ---------------------------------------------------------------------------------------------------------------
# keripy


def load_keripy(src: Path):
    """Import keripy and the SEDI schemas from the pinned clone (tests.sedi lives in its source tree only)."""
    sys.path.insert(0, str(src))
    global keri, Vrsn_2_0, Kinds, Habery, Configer, MtrDex, Mapper, Compactor, Noncer, Salter, Schemer, SerderKERI
    global Regery, Registrar, RegBaser, acdcmap, messagize, SealEvent, SCHEMAS, VALIDATE
    global UnitSchemaSaid, AgentSchemaSaid, GuardianSchemaSaid
    import keri  # noqa: F401
    from keri import Vrsn_2_0, Kinds  # noqa: F811
    from keri.app.habbing import Habery  # noqa: F811
    from keri.app.configing import Configer  # noqa: F811
    from keri.core import (MtrDex, Mapper, Compactor, Noncer, Salter, Schemer, SerderKERI,  # noqa: F811
                           SealEvent, messagize)
    from keri.acdc import Regery, Registrar, acdcmap  # noqa: F811
    from keri.acdc.regbasing import RegBaser  # noqa: F811
    from jsonschema import Draft202012Validator
    from tests.sedi.test_sedi import (GuardianSchema, GuardianSchemaSaid, AgentSchema, AgentSchemaSaid,  # noqa: F811
                                      UnitSchema, UnitSchemaSaid)
    SCHEMAS = [(UnitSchemaSaid, UnitSchema), (AgentSchemaSaid, AgentSchema), (GuardianSchemaSaid, GuardianSchema)]
    VALIDATE = {s: Draft202012Validator(schema=sch) for s, sch in SCHEMAS}
    if keri.__version__ != "2.1.0-dev1":
        raise OfficeError("keripyVersion", f"keripy {keri.__version__}; the K1 profile needs 2.1.0-dev1 (7143832)", 2)


def nonce() -> str:
    return Noncer(raw=os.urandom(16)).qb64


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")


def compact(mad, paths):
    return Compactor(mad=mad, makify=True, compactify=True, saidive=True, kind=Kinds.json).partials[paths].mad


def rule():
    return Mapper(mad=dict(d="", l="Demo only. Not a legal instrument."), makify=True, saidive=True,
                  kind=Kinds.json).mad


class Office:
    """The open keripy store: three habs (roy, deb, sue) in one Habery, and their registries."""

    def __init__(self, ks: Keystore, site: Site, state_name: str, k0_dir: str | None = None):
        self.ks, self.site, self.state_name, self.k0_dir = ks, site, state_name, k0_dir
        bran = passcode()
        fresh = not any(ks.keys.glob("**/data.mdb"))
        self.cf = Configer(name=HAB_NAME, base="", temp=False, reopen=True, headDirPath=str(ks.keys))
        from keri.kering import AuthError
        try:
            self.hby = Habery(name=HAB_NAME, base="", temp=False, headDirPath=str(ks.keys), cf=self.cf, bran=bran,
                              salt=Salter().qb64 if fresh else None, version=Vrsn_2_0)
        except AuthError:
            self.cf.close()
            raise OfficeError("badPasscode", "that passcode does not open this keystore", 2)
        for said, sch in SCHEMAS:
            self.hby.db.schema.pin(said, Schemer(sed=dict(sch)))
        self.rgy = Regery(hby=self.hby, name=HAB_NAME,
                          baser=RegBaser(name=HAB_NAME, headDirPath=str(ks.keys), reopen=True))
        self.reg = Registrar(rgy=self.rgy)
        self.data = ks.load()
        self.salts = ks.load_salts()

    def remember_site(self):
        site = {"host": self.site.host, "pathPrefix": "/".join(self.site.segs)}
        if self.data.get("site") != site:
            self.data["site"] = site
            if self.data.get("aids"):
                self.ks.save(self.data)

    def close(self):
        self.rgy.close()
        self.hby.close()
        self.cf.close()

    # ---- habs ----

    def hab(self, role: str):
        hab = self.hby.habByName(f"{role}-k1")
        if hab is None:
            raise OfficeError("notInitialised", "run `office.py init` first", 409)
        return hab

    def kel(self, role: str) -> bytes:
        hab = self.hab(role)
        return b"".join(bytes(hab.msgOwnEvent(sn=i, framed=True, gvrsn=Vrsn_2_0)) for i in range(hab.kever.sn + 1))

    def salt(self, role: str) -> str:
        if role not in self.salts:
            self.salts[role] = Salter().qb64
            self.ks.save_salts(self.salts)
        return self.salts[role]

    # ---- registries and credentials ----

    def _anchor(self, hab, registry, event):
        seal = dict(i=registry.regk, s=event.sad["n"], d=event.said)
        hab.interact(data=[seal], framed=True, gvrsn=Vrsn_2_0)
        if registry.anchorMsg(event.said) is not True:
            raise OfficeError("anchorFailed", f"registry {registry.regk} did not take the anchor for {event.said}", 500)

    def _proofed(self, acdc_raw: bytes, blinder) -> str:
        from keri.core import SerderACDC
        acdc = SerderACDC(raw=acdc_raw)
        return bytes(messagize(serder=acdc, bonds=[blinder.data], framed=False, gvrsn=Vrsn_2_0)).decode()

    def _issue(self, role: str, reg_name: str, schema: str, attribute, edge=None) -> dict:
        hab = self.hab(role)
        r = self.reg.makeRegistry(name=reg_name, prefix=hab.pre)
        rip = self.rgy.store.event(r.regk)
        self._anchor(hab, r, rip)
        acdc = acdcmap(israid=hab.pre, uuid=nonce(), regid=r.regk, schema=schema, attribute=attribute, edge=edge,
                       rule=rule(), kind=Kinds.json)
        VALIDATE[schema].validate(acdc.sad)
        blinder, bup = self.reg.issue(r, acdc=acdc, state="issued", salt=self.salt(role))
        self._anchor(hab, r, bup)
        return dict(said=acdc.said, issuer=role, regk=r.regk, regName=reg_name, schema=schema,
                    acdc=bytes(acdc.raw).decode(), ripText=bytes(rip.raw).decode(),
                    updateTexts=[bytes(bup.raw).decode()], proof=self._proofed(acdc.raw, blinder), state="issued")

    def _revoke(self, cred: dict):
        from keri.core import SerderACDC
        hab = self.hab(cred["issuer"])
        r = self.rgy.regs[cred["regk"]]
        acdc = SerderACDC(raw=cred["acdc"].encode())
        blinder, bup = self.reg.issue(r, acdc=acdc, state="revoked", salt=self.salt(cred["issuer"]))
        self._anchor(hab, r, bup)
        cred["updateTexts"].append(bytes(bup.raw).decode())
        cred["proof"] = self._proofed(acdc.raw, blinder)
        cred["state"] = "revoked"

    # ---- commands ----

    def init(self) -> dict:
        if self.data.get("aids"):
            raise OfficeError("alreadyInitialised", f"this keystore already holds K1 ({self.data['aids']['roy']})", 409)
        for role in ROLES:
            if self.hby.habByName(f"{role}-k1") is None:
                self.hby.makeHab(name=f"{role}-k1", icode=MtrDex.ECDSA_256r1_Seed, code=MtrDex.SHA2_256,
                                 dcode=MtrDex.SHA2_256, version=Vrsn_2_0)
        roy, deb, sue = (self.hab(r) for r in ROLES)
        now = iso(datetime.now(timezone.utc))
        unit = self._issue("roy", "unit", UnitSchemaSaid,
                           Mapper(mad=dict(d="", u=nonce(), i=deb.pre, issuedDate=now,
                                           unit="KeyringDemoSediProgramOffice"),
                                  makify=True, saidive=True, kind=Kinds.json).mad)
        agent = self._issue("deb", "agent", AgentSchemaSaid,
                            compact(dict(d="", u=nonce(), i=sue.pre, issuedDate=now, role="SediIssuingAgent",
                                         name=dict(d="", u=nonce(), value="Demo Issuing Agent")), (".name",)),
                            compact(dict(d="", u=nonce(),
                                         orgUnit=dict(d="", u=nonce(), n=unit["said"], s=UnitSchemaSaid, o="I2I")),
                                    (".orgUnit",)))
        self.data = dict(kit="keyring K1 (kept keys)", createdAt=now, aids={r: self.hab(r).pre for r in ROLES},
                         unit=unit, agent=agent, cards={},
                         site={"host": self.site.host, "pathPrefix": "/".join(self.site.segs)})
        self.ks.save(self.data)
        return dict(aids=self.data["aids"])

    def issue(self, holder: str, ward: str, valid_days: int = DEFAULT_VALID_DAYS, role: str = DEFAULT_ROLE,
              label: str = "") -> dict:
        if not self.data.get("aids"):
            raise OfficeError("notInitialised", "run `office.py init` first", 409)
        if (p := holder_problem(holder)):
            raise OfficeError("badHolder", p)
        if (p := ward_problem(ward)):
            raise OfficeError("badWard", p)
        if holder == ward:
            raise OfficeError("badWard", "the holder and the ward are the same AID")
        if not isinstance(valid_days, int) or not 1 <= valid_days <= 366:
            raise OfficeError("badValidity", "validDays is a whole number of days from 1 to 366")
        if not isinstance(role, str) or not re.match(r"^[A-Za-z][A-Za-z -]{0,39}$", role):
            raise OfficeError("badRole", "role is 1 to 40 letters, spaces or hyphens")
        if not isinstance(label, str) or len(label) > 120:
            raise OfficeError("badLabel", "label is at most 120 characters")
        issued = datetime.now(timezone.utc)
        expires = issued + timedelta(days=valid_days)
        pickup_id = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")
        g = self._issue("sue", f"guardian-{pickup_id}", GuardianSchemaSaid,
                        compact({"d": "", "u": nonce(), "i": holder, "role": role, "ward": ward,
                                 "issuedDate": {"d": "", "u": nonce(), "value": iso(issued)},
                                 "expirationDate": {"d": "", "u": nonce(), "value": iso(expires)}},
                                (".issuedDate", ".expirationDate")),
                        compact({"d": "", "u": nonce(),
                                 "utahAgent": {"d": "", "u": nonce(), "n": self.data["agent"]["said"],
                                               "s": AgentSchemaSaid, "o": "I2I"}}, (".utahAgent",)))
        g.update(pickupId=pickup_id, holder=holder, ward=ward, role=role, label=label,
                 issuedAt=iso(issued), expiresAt=iso(expires))
        self.data["cards"][g["said"]] = g
        self.ks.save(self.data)
        bundle = self.bundle(g)
        if len(json.dumps(bundle).encode()) > MAX_CARD_BYTES:
            # Issued and anchored, so it is revoked rather than left live and unpublishable.
            self._revoke(g)
            self.ks.save(self.data)
            raise OfficeError("tooLarge", "the card bundle is over 64 KiB; it was revoked at once", 500)
        return g

    def revoke(self, said: str) -> dict:
        card = self.data.get("cards", {}).get(said)
        if card is None:
            raise OfficeError("notFound", f"no card {said}", 404)
        if card["state"] != "revoked":
            self._revoke(card)
            card["revokedAt"] = iso(datetime.now(timezone.utc))
            self.ks.save(self.data)
        return card

    # ---- outputs ----

    def bundle(self, card: dict) -> dict:
        """The card as the phone keeps it: bifold's GuardianEvidence plus a type tag and dates."""
        return {
            "type": CARD_TYPE,
            "guardianSaid": card["said"],
            "holder": card["holder"],
            "kels": [self.kel(r).decode() for r in ROLES],
            "tels": [{"ripText": c["ripText"], "updateTexts": list(c["updateTexts"])}
                     for c in (self.data["unit"], self.data["agent"], card)],
            "creds": [self.data["unit"]["proof"], self.data["agent"]["proof"], card["proof"]],
            "issuedAt": card["issuedAt"],
            "expiresAt": card["expiresAt"],
            "pickupJsonUrl": self.site.card_url(card["pickupId"], "json"),
            "offerUrl": self.site.offer_url(card["pickupId"]),
        }

    def did_doc(self, role: str) -> dict:
        hab = self.hab(role)
        return did_document(self.site, hab.pre, [v.qb64 for v in hab.kever.verfers])

    def write_k0(self, put) -> list[str]:
        """K0's root, org unit and issuing agent, from bifold's kit, as webs-k0-root.gen.mjs lays them out."""
        if not self.k0_dir:
            return []
        aids = []
        for who in ROLES:
            kel = read_k0_kel(self.k0_dir, who)
            aid, keys = kel_current_keys(kel)
            if who == "roy" and aid != K0_ROOT:
                raise OfficeError("badK0", f"{self.k0_dir} is not the K0 kit (root {aid})", 2)
            base = "/".join([DID_PATH, aid])
            put(f"{base}/keri.cesr", kel)
            put(f"{base}/did.json", (json.dumps(did_document(self.site, aid, keys), indent=2) + "\n").encode())
            aids.append(aid)
        return aids

    def write_publish_tree(self) -> list[str]:
        """Rewrite every public file from the store. Returns the paths written, relative to publish/."""
        out, written = self.ks.publish, []

        def put(rel: str, data: bytes):
            p = out / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_name(p.name + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(p)
            written.append(rel)

        for role in ROLES:
            aid = self.hab(role).pre
            base = "/".join([DID_PATH, aid])
            put(f"{base}/keri.cesr", self.kel(role))
            put(f"{base}/did.json", (json.dumps(self.did_doc(role), indent=2) + "\n").encode())
        self.write_k0(put)
        for card in self.data.get("cards", {}).values():
            pid = card["pickupId"]
            put(f"cards/{pid}.json", json.dumps(self.bundle(card), separators=(",", ":")).encode())
            status = {"status": card["state"]}
            if card.get("revokedAt"):
                status["revokedAt"] = card["revokedAt"]
            put(f"cards/{pid}.status.json", json.dumps(status).encode())
            put(f"cards/{pid}.html", self.pickup_html(card).encode())
        return written

    def card_view(self, card: dict, published: bool | None = None, publish_error: str | None = None) -> dict:
        pid = card["pickupId"]
        view = {
            "id": card["said"], "pickupId": pid, "label": card.get("label", ""), "holder": card["holder"],
            "ward": card["ward"], "role": card["role"], "issuedAt": card["issuedAt"], "expiresAt": card["expiresAt"],
            "status": card["state"],
            "pickupUrl": self.site.card_url(pid, "html"), "pickupJsonUrl": self.site.card_url(pid, "json"),
            "statusJsonUrl": self.site.card_url(pid, "status.json"), "offerUrl": self.site.offer_url(pid),
            "qrSvg": qr_svg(self.site.offer_url(pid)) if card["state"] == "issued" else "",
        }
        if card.get("revokedAt"):
            view["revokedAt"] = card["revokedAt"]
        if published is not None:
            view["published"] = published
        if publish_error:
            view["publishError"] = publish_error
        return view

    def pickup_html(self, card: dict) -> str:
        view = self.card_view(card)
        values = {**{k: view.get(k, "") for k in ("pickupJsonUrl", "offerUrl", "statusJsonUrl")},
                  "notIssuedBy": not_issued_by(self.state_name),
                  **{k: human_date(view.get(k)) for k in ("issuedAt", "expiresAt", "revokedAt")},
                  "stateName": self.state_name, "host": self.site.host, "qrSvg": view["qrSvg"]}
        name = "pickup.html" if card["state"] == "issued" else "pickup-revoked.html"
        template = HERE / "templates" / name
        text = template.read_text() if template.exists() else PLACEHOLDER[card["state"]]
        return with_not_issued_line(render(text, values), self.state_name)


# ---------------------------------------------------------------------------------------------------------------
# Rendering


PLACEHOLDER = {
    "issued": """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Your Guardian card</title></head>
<body><p>{{notIssuedBy}}. Demo state: a test issuer, not a government service.</p><h1>Your Guardian card from {{stateName}} (Demo)
is ready</h1><p>Scan this with Keyring, or open it on the phone it was issued to.</p>{{qrSvg}}
<p><a href="{{offerUrl}}">Open in Keyring</a></p><p>Issued {{issuedAt}}, valid until {{expiresAt}}.</p></body></html>
""",
    "revoked": """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Guardian card revoked</title></head>
<body><p>{{notIssuedBy}}. Demo state: a test issuer, not a government service.</p><h1>This Guardian card from {{stateName}} (Demo)
was revoked</h1><p>Revoked {{revokedAt}}. It was issued {{issuedAt}}.</p></body></html>
""",
}


def not_issued_by(state_name: str) -> str:
    """The plain line every public page carries, as K0's DemoNote does ("not issued by the State of Utah")."""
    return f"Not issued by the {state_name[0].upper()}{state_name[1:]}" if state_name.lower().startswith("state of ") \
        else f"Not issued by {state_name}"


def with_not_issued_line(page: str, state_name: str) -> str:
    """A rendered page always says who did NOT issue it. A template that leaves the line out gets it before </body>."""
    line = not_issued_by(state_name)
    if html.escape(line) in page:
        return page
    tag = f'<p class="not-issued"><strong>{html.escape(line)}.</strong> A demo card from a test issuer.</p>'
    at = page.lower().rfind("</body>")
    return page[:at] + tag + page[at:] if at >= 0 else page + tag


def render(template: str, values: dict) -> str:
    """Fill {{name}} placeholders. Only qrSvg is raw markup (made here, from the offer URL); everything else is
    HTML-escaped. An unknown placeholder is left empty."""
    def sub(m):
        key = m.group(1)
        value = values.get(key, "")
        return value if key == "qrSvg" else html.escape(str(value), quote=True)
    return re.sub(r"\{\{\s*([A-Za-z]+)\s*\}\}", sub, template)


def human_date(value: str | None) -> str:
    """An ISO time as people read it on the pickup page: "13 Nov 2026" (UTC)."""
    if not value:
        return ""
    return datetime.fromisoformat(value).astimezone(timezone.utc).strftime("%-d %b %Y")


def qr_svg(text: str) -> str:
    import segno
    return segno.make(text, error="m").svg_inline(scale=4, border=2, title="Guardian card QR code")


def read_k0_kel(source: str, who: str) -> bytes:
    """kel-<who>.cesr of the K0 kit, from a folder or from git:<repo>:<ref> (bifold's own fixture, never a copy)."""
    if source.startswith("git:"):
        repo, _, ref = source[4:].rpartition(":")
        r = subprocess.run(["git", "-C", repo, "show", f"{ref}:{K0_KIT_PATH}/kel-{who}.cesr"], capture_output=True)
        if r.returncode != 0:
            raise OfficeError("noK0", f"K0 kit not found at {source} ({r.stderr.decode().strip()[:160]}); "
                                      "pass --k0-dir DIR, or --k0-dir '' to leave K0 out", 2)
        return r.stdout
    path = Path(source).expanduser() / f"kel-{who}.cesr"
    if not path.exists():
        raise OfficeError("noK0", f"no K0 kit at {source} (pass --k0-dir '' to leave K0 out)", 2)
    return path.read_bytes()


def did_document(site: Site, aid: str, keys: list[str]) -> dict:
    """did.json as webs-k0-root.gen.mjs writes it: the did:web twin as id, the did:webs first in alsoKnownAs."""
    subject = site.web_did(aid)
    return {
        "id": subject,
        "verificationMethod": [{"id": f"#{k}", "type": "JsonWebKey", "controller": subject,
                                "publicKeyJwk": p256_jwk(k)} for k in keys],
        "service": [],
        "alsoKnownAs": [site.webs_did(aid), f"did:keri:{aid}"],
    }


B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def kel_current_keys(kel: bytes) -> tuple[str, list[str]]:
    """The AID and current keys (the last icp/rot "k") of a KEL stream, read as webs-k0-root.gen.mjs reads it:
    each body found by its version string, sized by the string's four size characters."""
    text = kel.decode("latin1")
    aid, keys, at = None, None, text.find('{"v":"')
    while at >= 0:
        size = 0
        for c in text[at + 20:at + 24]:
            size = size * 64 + B64.index(c)
        body = json.loads(text[at:at + size])
        aid = body["i"]
        if body["t"] in ("icp", "rot"):
            keys = body["k"]
        at = text.find('{"v":"', at + 1)
    if not aid or not keys:
        raise OfficeError("badKel", "no inception found in a KEL", 2)
    return aid, keys


def p256_jwk(k: str) -> dict:
    """A P-256 verfer (1AAJ transferable, 1AAI non-transferable) as a JWK, as webs-k0-root.gen.mjs builds it."""
    if not (k.startswith("1AAJ") or k.startswith("1AAI")):
        raise OfficeError("badKey", f"P-256 keys only, got {k}", 500)
    raw = base64.urlsafe_b64decode("AAAA" + k[4:] + "=" * (-len("AAAA" + k[4:]) % 4))[3:]
    from cryptography.hazmat.primitives.asymmetric import ec
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    nums = pub.public_numbers()
    b64 = lambda n: base64.urlsafe_b64encode(n.to_bytes(32, "big")).decode().rstrip("=")
    return {"kid": k, "kty": "EC", "crv": "P-256", "x": b64(nums.x), "y": b64(nums.y)}


# ---------------------------------------------------------------------------------------------------------------
# Publishing (the upload itself is a separate command, run on each change when --publish-cmd is given)


def run_publish(cmd: str | None, publish_dir: Path) -> tuple[bool, str | None]:
    if not cmd:
        return False, None
    try:
        r = subprocess.run(cmd, shell=True, cwd=str(publish_dir), capture_output=True, text=True, timeout=120,
                           env={**os.environ, "KEYRING_SEDI_PUBLISH_DIR": str(publish_dir)})
    except subprocess.TimeoutExpired:
        return False, "the publish command timed out"
    if r.returncode != 0:
        return False, (r.stderr or r.stdout or f"exit {r.returncode}").strip().splitlines()[-1][:300]
    return True, None


# ---------------------------------------------------------------------------------------------------------------
# The officer API


class Api(BaseHTTPRequestHandler):
    office: Office
    token: str
    port: int
    publish_cmd: str | None
    lock = threading.Lock()
    server_version = "KeyringStateOffice/0.1"

    def log_message(self, fmt, *args):  # no request bodies or tokens in logs
        sys.stderr.write(f"{self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}\n")

    def _origin_ok(self) -> bool:
        allowed_hosts = {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}
        if self.headers.get("Host") not in allowed_hosts:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in allowed_hosts}

    def _send(self, status: int, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, obj):
        self._send(status, json.dumps(obj).encode(), "application/json")

    def _authed(self) -> bool:
        auth = self.headers.get("Authorization", "")
        given = auth[7:] if auth.startswith("Bearer ") else ""
        return hmac.compare_digest(given.encode(), self.token.encode())

    def _guard(self, api: bool) -> bool:
        if not self._origin_ok():
            self._json(403, {"error": "badOrigin"})
            return False
        if api and not self._authed():
            self._json(401, {"error": "badToken"})
            return False
        return True

    def do_OPTIONS(self):  # no CORS, ever
        self._json(405, {"error": "noCors"})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/"):
            if not self._guard(api=True):
                return
            with self.lock:
                if path == "/api/health":
                    o = self.office
                    return self._json(200, {"root": o.data.get("aids", {}).get("roy"), "aids": o.data.get("aids"),
                                            "host": o.site.host, "pathPrefix": "/".join(o.site.segs),
                                            "keystore": "unlocked"})
                if path == "/api/cards":
                    cards = sorted(self.office.data.get("cards", {}).values(), key=lambda c: c["issuedAt"])
                    return self._json(200, [self.office.card_view(c) for c in cards])
            return self._json(404, {"error": "notFound"})
        if not self._guard(api=False):
            return
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        root = (HERE / "officer").resolve()
        target = (root / rel).resolve()
        if root not in target.parents and target != root or not target.is_file():
            return self._json(404, {"error": "notFound"})
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}.get(target.suffix, "application/octet-stream")
        self._send(200, target.read_bytes(), ctype)

    def do_POST(self):
        path = self.path.split("?")[0]
        if not self._guard(api=True):
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 16 * 1024:
                return self._json(413, {"error": "tooLarge"})
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            if not isinstance(body, dict):
                return self._json(400, {"error": "badBody"})
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "badBody"})
        with self.lock:
            try:
                if path == "/api/cards":
                    card = self.office.issue(holder=body.get("holder"), ward=body.get("ward"),
                                             valid_days=body.get("validDays", DEFAULT_VALID_DAYS),
                                             role=body.get("role", DEFAULT_ROLE),
                                             label=body.get("label", "") or "")
                    self.office.write_publish_tree()
                    ok, err = run_publish(self.publish_cmd, self.office.ks.publish)
                    return self._json(201, self.office.card_view(card, ok, err))
                m = re.match(r"^/api/cards/([A-Za-z0-9_-]{44})/revoke$", path)
                if m:
                    card = self.office.revoke(m.group(1))
                    self.office.write_publish_tree()
                    ok, err = run_publish(self.publish_cmd, self.office.ks.publish)
                    return self._json(200, self.office.card_view(card, ok, err))
            except OfficeError as e:
                return self._json(e.status if e.status >= 400 else 400, {"error": e.code, "message": str(e)})
        return self._json(404, {"error": "notFound"})


def free_port(preferred: int) -> int:
    import socket
    for port in [preferred, *range(preferred + 1, preferred + 50)]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise OfficeError("noPort", "no free port near the preferred one", 2)


# ---------------------------------------------------------------------------------------------------------------


def main(argv=None):
    ap = argparse.ArgumentParser(description="SEDI demo State office (K1)")
    ap.add_argument("--keystore", default=os.environ.get("KEYRING_SEDI_K1_KEYSTORE", str(DEFAULT_KEYSTORE)))
    ap.add_argument("--keripy", default=os.environ.get("KEYRING_SEDI_KERIPY", str(DEFAULT_KERIPY)))
    ap.add_argument("--host", default=os.environ.get("KEYRING_SEDI_K1_HOST"),
                    help="bare hostname the publish tree is served from (a tunnel's, for now). Remembered in the "
                         "keystore; every did.json and card page is rewritten for it. Default: the last one used, "
                         "else the placeholder example.org")
    ap.add_argument("--path-prefix", default=os.environ.get("KEYRING_SEDI_K1_PATH_PREFIX"),
                    help="path of the site root under the host, e.g. the bucket name for a bucket URL (default: the "
                         "last one used, else none)")
    ap.add_argument("--k0-dir", default=os.environ.get("KEYRING_SEDI_K0_DIR", DEFAULT_K0_DIR),
                    help="bifold's K0 kit fixtures; its root, org unit and issuing agent are published beside K1's "
                         "so one host serves both ('' to leave K0 out)")
    kc = ap.add_mutually_exclusive_group()
    kc.add_argument("--passcode-from-keychain", dest="keychain", action="store_true", default=None,
                    help=f"read the passcode from the Keychain item {KEYCHAIN_SERVICE} (the default when it exists)")
    kc.add_argument("--no-keychain", dest="keychain", action="store_false", help="never read the Keychain")
    ap.add_argument("--state-name", default=os.environ.get("KEYRING_SEDI_K1_STATE_NAME", DEFAULT_STATE_NAME))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    p = sub.add_parser("issue")
    p.add_argument("--holder", required=True)
    p.add_argument("--ward", required=True)
    p.add_argument("--valid-days", type=int, default=DEFAULT_VALID_DAYS)
    p.add_argument("--role", default=DEFAULT_ROLE)
    p.add_argument("--label", default="")
    p = sub.add_parser("revoke")
    p.add_argument("said")
    sub.add_parser("publish")
    sub.add_parser("show")
    p = sub.add_parser("serve")
    p.add_argument("--port", type=int, default=API_PORT)
    p.add_argument("--publish-cmd", default=os.environ.get("KEYRING_SEDI_PUBLISH_CMD"),
                   help="run after each change, in the publish dir (e.g. the upload script); none = local tree only")
    a = ap.parse_args(argv)
    global PASSCODE_FROM_KEYCHAIN
    PASSCODE_FROM_KEYCHAIN = a.keychain

    try:
        ks = Keystore(Path(a.keystore))
        ks.ensure()
        ks.lock()
        saved = ks.load().get("site", {})
        site = Site(a.host or saved.get("host") or "example.org",
                    a.path_prefix if a.path_prefix is not None else saved.get("pathPrefix", ""))
        load_keripy(Path(a.keripy))
        office = Office(ks, site, a.state_name, a.k0_dir or None)
        office.remember_site()
        try:
            if a.cmd == "init":
                aids = office.init()["aids"]
                office.write_publish_tree()
                print(f"root  {aids['roy']}\nunit  {aids['deb']}\nagent {aids['sue']}")
            elif a.cmd == "issue":
                card = office.issue(a.holder, a.ward, a.valid_days, a.role, a.label)
                office.write_publish_tree()
                v = office.card_view(card)
                v.pop("qrSvg")
                print(json.dumps(v, indent=2))
            elif a.cmd == "revoke":
                v = office.card_view(office.revoke(a.said))
                office.write_publish_tree()
                v.pop("qrSvg")
                print(json.dumps(v, indent=2))
            elif a.cmd == "publish":
                print("\n".join(office.write_publish_tree()))
            elif a.cmd == "show":
                d = office.data
                print(json.dumps({"aids": d.get("aids"), "cards": {s: {k: c[k] for k in (
                    "pickupId", "state", "holder", "ward", "issuedAt", "expiresAt")} for s, c in
                    d.get("cards", {}).items()}}, indent=2))
            elif a.cmd == "serve":
                port = free_port(a.port)
                if port == PUBLIC_PORT:
                    raise OfficeError("portClash", f"{PUBLIC_PORT} is the public server's port; the API never uses it", 2)
                ks.api_port_file.write_text(str(port))
                office.write_publish_tree()
                Api.office, Api.token, Api.port, Api.publish_cmd = office, ks.token(), port, a.publish_cmd
                srv = HTTPServer(("127.0.0.1", port), Api)
                print(f"State office on http://127.0.0.1:{port}/  (officer token: {Api.token})", flush=True)
                print(f"Token also in {ks.token_file} (mode 600). Publish tree: {ks.publish}", flush=True)
                try:
                    srv.serve_forever()
                except KeyboardInterrupt:
                    pass
                finally:
                    srv.server_close()
        finally:
            office.close()
    except OfficeError as e:
        print(f"error ({e.code}): {e}", file=sys.stderr)
        return e.status if e.status < 100 else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
