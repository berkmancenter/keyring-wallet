"""Tests for office.py. Run with the office's venv: python -I -m unittest test_office (from this folder).

The first group needs no keripy. The end-to-end group (init, issue, revoke on a throwaway keystore) needs the pinned
keripy clone (KEYRING_SEDI_KERIPY or the default path) and is skipped without it.
"""
import http.client
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import office  # noqa: E402

AID_E = "E" + "A" * 43
AID_I = "IIJfHGUVWYHR3-ODUwcD4zEg18OsF1ke3-0I8ojPgQav"
WARD_B = "BO06-duiao9wxLLhTOOfl03Lavbr30WUqcc9LgzImLtd"
WARD_1AAI = "1AAI" + "A" * 44


class Render(unittest.TestCase):
    def test_every_value_but_qr_svg_is_escaped(self):
        t = "<h1>{{stateName}}</h1><p>{{issuedAt}}</p><a href='{{offerUrl}}'>x</a>{{qrSvg}}"
        out = office.render(t, {"stateName": "<script>alert(1)</script>", "issuedAt": "a & b",
                                "offerUrl": "keyring://x?u='y'", "qrSvg": "<svg><rect/></svg>"})
        self.assertNotIn("<script>", out)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", out)
        self.assertIn("a &amp; b", out)
        self.assertIn("keyring://x?u=&#x27;y&#x27;", out)
        self.assertIn("<svg><rect/></svg>", out)  # control: the one raw value

    def test_an_unknown_placeholder_is_left_empty(self):
        self.assertEqual(office.render("[{{nope}}]", {}), "[]")

    def test_the_revoked_placeholder_page_has_no_qr(self):
        self.assertNotIn("{{qrSvg}}", office.PLACEHOLDER["revoked"])
        self.assertIn("{{qrSvg}}", office.PLACEHOLDER["issued"])

    def test_dates_are_for_people(self):
        self.assertEqual(office.human_date("2026-11-13T00:10:09.223559+00:00"), "13 Nov 2026")
        self.assertEqual(office.human_date(None), "")


class SiteAddresses(unittest.TestCase):
    def test_our_own_hostname(self):
        s = office.Site("demo-state.example.org")
        self.assertEqual(s.webs_did(AID_I), f"did:webs:demo-state.example.org:keyring-demo-state:{AID_I}")
        self.assertEqual(s.web_did(AID_I), f"did:web:demo-state.example.org:keyring-demo-state:{AID_I}")
        self.assertEqual(s.card_url("abc", "json"), "https://demo-state.example.org/cards/abc.json")

    def test_a_bucket_path_is_path_segments_never_a_port(self):
        s = office.Site("storage.googleapis.com", "my-bucket")
        self.assertEqual(s.webs_did(AID_I),
                         f"did:webs:storage.googleapis.com:my-bucket:keyring-demo-state:{AID_I}")
        self.assertEqual(s.card_url("abc", "json"), "https://storage.googleapis.com/my-bucket/cards/abc.json")
        self.assertNotIn("%3A", s.webs_did(AID_I))

    def test_only_a_real_port_is_encoded(self):
        s = office.Site("localhost:8443")
        self.assertEqual(s.webs_did(AID_I), f"did:webs:localhost%3A8443:keyring-demo-state:{AID_I}")
        self.assertEqual(s.card_url("abc", "json"), "https://localhost:8443/cards/abc.json")

    def test_the_offer_link_carries_the_card_url_encoded(self):
        s = office.Site("storage.googleapis.com", "b")
        self.assertEqual(s.offer_url("abc"),
                         "keyring://guardian-card?u=https%3A%2F%2Fstorage.googleapis.com%2Fb%2Fcards%2Fabc.json")

    def test_a_host_with_a_path_or_scheme_is_refused(self):
        for bad in ("https://x.org", "x.org/p", "", "x.org:", "x org"):
            with self.assertRaises(office.OfficeError, msg=bad):
                office.Site(bad)
        with self.assertRaises(office.OfficeError):
            office.Site("x.org", "a/../b c")


class Codes(unittest.TestCase):
    def test_holder_codes_are_transferable(self):
        self.assertIsNone(office.holder_problem(AID_I))
        self.assertIsNone(office.holder_problem(AID_E))
        for bad in (WARD_B, WARD_1AAI, AID_I[:-1], AID_I + "A", "I" + "*" * 43, None):
            self.assertIsNotNone(office.holder_problem(bad), bad)

    def test_ward_codes(self):
        for good in (WARD_B, WARD_1AAI, AID_I):
            self.assertIsNone(office.ward_problem(good), good)
        for bad in ("B" * 43, "1AAJ" + "A" * 44, "", None, "B" + "!" * 43):
            self.assertIsNotNone(office.ward_problem(bad), bad)


class KeystorePlace(unittest.TestCase):
    def test_a_keystore_inside_a_git_checkout_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / ".git").mkdir()
            with self.assertRaises(office.OfficeError) as e:
                office.Keystore(Path(d) / "ks")
            self.assertEqual(e.exception.code, "keystoreInRepo")

    def test_a_keystore_outside_any_checkout_is_taken(self):
        with tempfile.TemporaryDirectory() as d:
            office.Keystore(Path(d) / "ks")  # control


BIFOLD = Path(office.DEFAULT_K0_DIR[4:].rpartition(":")[0])


@unittest.skipUnless((BIFOLD / ".git").exists(), "no bifold clone for the K0 kit")
class K0InTheSameTree(unittest.TestCase):
    """The K0 port of webs-k0-root.gen.mjs gives bifold's committed fixture bytes for example.org."""

    def test_k0_did_json_matches_bifolds_fixture(self):
        import subprocess
        site = office.Site("example.org")
        for who in office.ROLES:
            kel = office.read_k0_kel(office.DEFAULT_K0_DIR, who)
            aid, keys = office.kel_current_keys(kel)
            ours = (json.dumps(office.did_document(site, aid, keys), indent=2) + "\n").encode()
            theirs = subprocess.run(["git", "-C", str(BIFOLD), "show", "origin/main:packages/core/src/modules/sedi/"
                                     f"__tests__/fixtures/webs-k0-root/example.org/keyring-demo-state/{aid}/did.json"],
                                    capture_output=True).stdout
            self.assertEqual(ours, theirs, who)

    def test_a_folder_without_the_kit_is_refused(self):
        with tempfile.TemporaryDirectory() as d, self.assertRaises(office.OfficeError):
            office.read_k0_kel(d, "roy")


class NotIssuedOnce(unittest.TestCase):
    """With the templates in this folder (6e's, when present) or the built-in placeholders: the sentence, once."""

    def test_each_page_carries_the_sentence_exactly_once(self):
        values = {"stateName": "State of Utah", "notIssuedBy": office.not_issued_by("State of Utah"), "qrSvg": "<svg/>"}
        for state, name in (("issued", "pickup.html"), ("revoked", "pickup-revoked.html")):
            t = office.HERE / "templates" / name
            text = t.read_text() if t.exists() else office.PLACEHOLDER[state]
            self.assertEqual(office.render(text, values).count("Not issued by the State of Utah."), 1, name)


class Defaults(unittest.TestCase):
    def test_alberto_s_defaults(self):
        self.assertEqual((office.DEFAULT_STATE_NAME, office.DEFAULT_VALID_DAYS, office.DEFAULT_ROLE),
                         ("State of Utah", 365, "legal guardian"))

    def test_the_not_issued_sentence(self):
        self.assertEqual(office.not_issued_by("State of Utah"), "Not issued by the State of Utah.")

    def test_the_qr_svg_carries_the_svg_namespace(self):
        svg = office.qr_svg("keyring://guardian-card?u=x")
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn('xmlns="http://www.w3.org/2000/svg"', svg)

    def test_the_keychain_comes_first_then_the_env_then_a_prompt(self):
        saved = (office.keychain_passcode, os.environ.get("KEYRING_SEDI_K1_PASSCODE"), office.PASSCODE_FROM_KEYCHAIN)
        try:
            os.environ["KEYRING_SEDI_K1_PASSCODE"] = "from-the-environment-123456"
            office.keychain_passcode = lambda: "from-the-keychain-1234567890"
            office.PASSCODE_FROM_KEYCHAIN = None
            self.assertEqual(office.passcode(), "from-the-keychain-1234567890")
            office.PASSCODE_FROM_KEYCHAIN = False  # --no-keychain
            self.assertEqual(office.passcode(), "from-the-environment-123456")
            office.PASSCODE_FROM_KEYCHAIN = None
            office.keychain_passcode = lambda: None  # no item: the env var
            self.assertEqual(office.passcode(), "from-the-environment-123456")
            office.PASSCODE_FROM_KEYCHAIN = True  # --passcode-from-keychain with no item refuses
            with self.assertRaises(office.OfficeError):
                office.passcode()
        finally:
            office.keychain_passcode, env, office.PASSCODE_FROM_KEYCHAIN = saved
            if env is None:
                os.environ.pop("KEYRING_SEDI_K1_PASSCODE", None)
            else:
                os.environ["KEYRING_SEDI_K1_PASSCODE"] = env


SECRETS = ("SECRET-KEY-BYTES", "SECRET-INDEX", "SECRET-TOKEN", "SECRET-LOCK")
REAL_FILES = {
    f"keyring-demo-state/{AID_I}/did.json": b'{"id": "did:web:x"}\n',
    f"keyring-demo-state/{AID_I}/keri.cesr": b'{"v":"KERI10JSON0000fd_","t":"icp"}-AABAA',
    f"keyring-demo-state/{AID_I}/designated-aliases.json": b'{"said": "E1"}\n',
    "cards/p1.json": b'{"type":"card"}',
    "cards/p1.status.json": b'{"status": "issued"}',
    "cards/p1.html": b"<!doctype html><title>card</title><script>no</script>",
}


def published_fixture(base: Path) -> Path:
    """A keystore as `serve` lays it out: the secrets BESIDE publish/, the public files in it, and decoys that each
    guard alone must refuse."""
    ks = base / "ks"
    (ks / "keys").mkdir(parents=True)
    (ks / "keys" / "secret.json").write_text(SECRETS[0])
    (ks / "office.json").write_text(SECRETS[1])
    (ks / "officer.token").write_text(SECRETS[2])
    (ks / "office.lock").write_text(SECRETS[3])
    pub = ks / "publish"
    for rel, data in REAL_FILES.items():
        (pub / rel).parent.mkdir(parents=True, exist_ok=True)
        (pub / rel).write_bytes(data)
    (pub / ".hidden.json").write_text("{}")  # the path rule only
    (pub / "cards" / "p1.json.tmp").write_text("{}")  # the suffix rule
    (pub / "notes.txt").write_text("x")  # the suffix rule
    (pub / "big.json").write_bytes(b" " * (office.PUBLISHED_MAX_BYTES + 1))  # the size cap only
    (pub / "big.cesr").write_bytes(b"-" * (office.PUBLISHED_MAX_BYTES + 1))  # published, listed, not opened
    (pub / "dir.json").mkdir()  # a folder with an allowed name (is_file, and its link count)
    os.mkfifo(pub / "fifo.json")  # not a regular file, one link: is_file only (reading it would hang the office)
    (pub / ".git").mkdir()
    (pub / ".git" / "x.json").write_text("{}")
    os.symlink(ks / "keys" / "secret.json", pub / "link-key.json")  # out of the tree
    os.symlink(pub / "cards" / "p1.json", pub / "link-inside.json")  # stays inside: the symlink rule only
    os.symlink(ks / "keys", pub / "linkdir")  # a folder link out
    os.symlink(ks, pub / "linkks")  # the whole keystore
    os.link(ks / "officer.token", pub / "hard.json")  # a hard link to the token: the link-count rule only
    return pub


# Every entry the viewer won't open, and why: listed all the same (the public server hands them out).
LISTED_REFUSED = {
    ".hidden.json": "notPlainPath", ".git/x.json": "notPlainPath",
    "cards/p1.json.tmp": "notViewableType", "notes.txt": "notViewableType",
    "big.json": "tooLarge", "big.cesr": "tooLarge", "fifo.json": "notRegularFile", "hard.json": "hardLinked",
    "link-key.json": "symlinked", "link-inside.json": "symlinked", "linkdir": "symlinked", "linkks": "symlinked",
}

REFUSED = [
    "../office.json", "../officer.token", "../office.lock", "../keys/secret.json", "keys/secret.json",
    "cards/../../office.json", "/etc/hosts", "cards\\p1.json", "cards//p1.json", "cards/p1.json/", "",
    ".hidden.json", ".git/x.json", "cards/p1.json.tmp", "notes.txt", "big.json", "big.cesr", "dir.json", "fifo.json",
    "link-key.json", "link-inside.json", "linkdir/secret.json", "linkks/office.json", "linkks/officer.token",
    "linkks/publish/cards/p1.json", "hard.json", "missing.json", None, 7,
]


class PublishedFiles(unittest.TestCase):
    """Read only, the publish tree only: never keys/, office.json, office.lock, officer.token or the passcode."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pub = published_fixture(Path(self.tmp.name))
        self.site = office.Site("storage.googleapis.com", "bkt")

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_list_shows_every_entry_and_marks_what_the_viewer_wont_open(self):
        # The public server hands out the whole folder, so nothing in it may be missing from the list: a file the
        # viewer won't open is listed with why, never dropped.
        got = office.published_files(self.pub, self.site)
        listed = {f["path"]: f for f in got["files"]}
        self.assertFalse(got["truncated"])
        self.assertEqual({p for p, f in listed.items() if f["viewable"]}, set(REAL_FILES))  # control
        self.assertEqual({p: f.get("reason") for p, f in listed.items() if not f["viewable"]}, LISTED_REFUSED)
        self.assertNotIn("dir.json", listed)  # a folder is not an entry; what is in it is
        # Nothing outside the tree: no path through a link, and none of the secrets' contents or sizes.
        self.assertFalse(any(p.startswith(("linkdir/", "linkks/")) for p in listed))
        self.assertFalse(any(s in json.dumps(got) for s in SECRETS))
        self.assertNotEqual(listed["link-key.json"]["size"], len(SECRETS[0]))  # lstat: the link, not the key

    def test_an_oversize_kel_is_listed_flagged_and_not_opened(self):
        listed = {f["path"]: f for f in office.published_files(self.pub, self.site)["files"]}
        self.assertEqual((listed["big.cesr"]["viewable"], listed["big.cesr"]["reason"]), (False, "tooLarge"))
        self.assertEqual(listed["big.cesr"]["publicUrl"], "https://storage.googleapis.com/bkt/big.cesr")
        self.assertIsNone(office.published_file(self.pub, "big.cesr"))

    def test_each_public_link_follows_the_host(self):
        listed = {f["path"]: f for f in office.published_files(self.pub, self.site)["files"]}
        self.assertEqual(listed["cards/p1.json"]["publicUrl"], "https://storage.googleapis.com/bkt/cards/p1.json")
        other = office.published_files(self.pub, office.Site("demo-state.example.org"))["files"]
        self.assertIn("https://demo-state.example.org/cards/p1.html", {f["publicUrl"] for f in other})
        self.assertEqual(listed["cards/p1.json"]["size"], len(REAL_FILES["cards/p1.json"]))

    def test_every_real_file_opens(self):  # control for the refusals below
        for rel, data in REAL_FILES.items():
            with self.subTest(rel=rel):
                self.assertEqual(office.published_file(self.pub, rel).read_bytes(), data)

    def test_anything_else_is_refused(self):
        for rel in REFUSED:
            with self.subTest(rel=rel):
                self.assertIsNone(office.published_file(self.pub, rel))


class PublishedFilesApi(unittest.TestCase):
    """The two routes over a real local server, with a stand-in office (no keys, no keripy)."""

    TOKEN = "t" * 32

    @classmethod
    def setUpClass(cls):
        import http.client
        import threading as th
        from types import SimpleNamespace
        cls.http = http.client
        cls.tmp = tempfile.TemporaryDirectory()
        pub = published_fixture(Path(cls.tmp.name))
        cls.saved = {k: getattr(office.Api, k, None) for k in ("office", "token", "port", "publish_cmd")}
        cls.srv = office.HTTPServer(("127.0.0.1", 0), office.Api)
        port = cls.srv.server_address[1]
        stub = SimpleNamespace(site=office.Site("storage.googleapis.com", "bkt"), test_site=None,
                               ks=SimpleNamespace(publish=pub, publish_test=pub),  # a TEST tree on disk, no TEST host
                               data={})
        office.Api.office, office.Api.token, office.Api.port, office.Api.publish_cmd = stub, cls.TOKEN, port, None
        office.Api.log_message = lambda *a: None
        cls.port = port
        cls.thread = th.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        for k, v in cls.saved.items():
            setattr(office.Api, k, v)
        del office.Api.log_message
        cls.tmp.cleanup()

    def get(self, target, token=TOKEN, host=None):
        c = self.http.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Host": host or f"127.0.0.1:{self.port}"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        c.request("GET", target, headers=headers)
        r = c.getresponse()
        out = (r.status, r.getheader("Content-Type"), r.getheader("X-Content-Type-Options"), r.read())
        c.close()
        return out

    def view(self, rel):
        from urllib.parse import quote as q
        return self.get(f"/api/files/view?path={q(rel, safe='')}")

    def test_the_list(self):
        status, ctype, _, body = self.get("/api/files")
        self.assertEqual((status, ctype), (200, "application/json"))
        got = json.loads(body)
        self.assertEqual({f["path"] for f in got["files"] if f["viewable"]}, set(REAL_FILES))
        self.assertEqual({f["path"]: f.get("reason") for f in got["files"] if not f["viewable"]}, LISTED_REFUSED)
        self.assertEqual(got["siteUrl"], "https://storage.googleapis.com/bkt/")
        self.assertFalse(any(s.encode() in body for s in SECRETS))

    def test_a_file_is_plain_text_so_a_page_shows_as_source(self):
        status, ctype, nosniff, body = self.view("cards/p1.html")
        self.assertEqual((status, ctype, nosniff), (200, "text/plain; charset=utf-8", "nosniff"))
        self.assertEqual(body, REAL_FILES["cards/p1.html"])

    def test_every_refusal_is_the_same_404_and_carries_nothing(self):
        for rel in [r for r in REFUSED if isinstance(r, str)] + ["%2e%2e/office.json", "..%2Fofficer.token"]:
            with self.subTest(rel=rel):
                status, _, _, body = self.view(rel)
                self.assertEqual((status, json.loads(body)), (404, {"error": "notFound"}))
                self.assertFalse(any(s.encode() in body for s in SECRETS))
        for target in ("/api/files/view", "/api/files/view?path=", "/api/files/view?path=cards/p1.json&path=cards/p1.json",
                       "/api/files/view/../../office.json"):
            with self.subTest(target=target):
                self.assertEqual(self.get(target)[0], 404)
        self.assertEqual(self.get("/api/files/view?path=cards/p1.json")[0], 200)  # control

    def test_no_test_tree_without_a_test_host_even_on_disk(self):
        self.assertEqual(self.get("/api/files?tree=test")[0], 404)
        self.assertEqual(self.get("/api/files?tree=prod")[0], 200)  # control

    def test_the_token_and_the_loopback_host_are_required(self):
        for target in ("/api/files", "/api/files/view?path=cards/p1.json"):
            with self.subTest(target=target):
                self.assertEqual(self.get(target, token=None)[0], 401)
                self.assertEqual(self.get(target, token="wrong")[0], 401)
                self.assertEqual(self.get(target, host="demo-state.example.org")[0], 403)
                self.assertEqual(self.get(target)[0], 200)  # control


KERIPY = Path(os.environ.get("KEYRING_SEDI_KERIPY", str(office.DEFAULT_KERIPY)))


@unittest.skipUnless((KERIPY / "tests" / "sedi" / "test_sedi.py").exists(), "pinned keripy clone not found")
class EndToEnd(unittest.TestCase):
    """init, issue, revoke on a throwaway keystore; the bundle's shape and the public files."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["KEYRING_SEDI_K1_PASSCODE"] = "a-throwaway-test-passcode-123"
        office.PASSCODE_FROM_KEYCHAIN = False  # tests never read the real Keychain item
        office.load_keripy(KERIPY)
        cls.ks = office.Keystore(Path(cls.tmp.name) / "ks")
        cls.ks.ensure()
        cls.office = office.Office(cls.ks, office.Site("storage.googleapis.com", "bkt"), "Demo <b>State</b>")
        cls.aids = cls.office.init()["aids"]
        cls.card = cls.office.issue(AID_I, WARD_B, valid_days=7, role="parent", label="<script>x</script>")
        cls.gone = cls.office.issue(AID_I, WARD_1AAI)
        cls.office.revoke(cls.gone["said"])
        cls.written = cls.office.write_publish_tree()

    @classmethod
    def tearDownClass(cls):
        cls.office.close()
        cls.tmp.cleanup()

    def test_three_p256_state_aids_with_sha2_prefixes(self):
        self.assertEqual(sorted(self.aids), ["deb", "roy", "sue"])
        for role in office.ROLES:
            hab = self.office.hab(role)
            self.assertTrue(hab.pre.startswith("I"), role)
            self.assertTrue(all(v.qb64.startswith("1AAJ") for v in hab.kever.verfers), role)
            self.assertEqual(hab.kever.wits, [], role)

    def test_the_bundle_has_the_guardian_evidence_shape(self):
        b = self.office.bundle(self.card)
        self.assertEqual(b["type"], office.CARD_TYPE)
        self.assertEqual(b["holder"], AID_I)
        self.assertEqual(len(b["kels"]), 3)
        self.assertEqual(len(b["tels"]), 3)
        self.assertEqual(len(b["creds"]), 3)
        sad = json.loads(b["creds"][2][: b["creds"][2].index("}}-") + 2])
        self.assertEqual((sad["a"]["i"], sad["a"]["ward"], sad["a"]["role"]), (AID_I, WARD_B, "parent"))
        self.assertEqual(sad["e"]["utahAgent"]["n"], self.office.data["agent"]["said"])
        self.assertLess(len(json.dumps(b)), office.MAX_CARD_BYTES)

    def test_a_revoke_adds_one_tel_update_and_is_idempotent(self):
        card = self.office.data["cards"][self.gone["said"]]
        self.assertEqual(card["state"], "revoked")
        self.assertEqual(len(card["updateTexts"]), 2)
        before = card["revokedAt"]
        self.office.revoke(self.gone["said"])
        self.assertEqual((len(card["updateTexts"]), card["revokedAt"]), (2, before))

    def test_the_publish_tree_holds_the_did_files_and_cards_and_no_label(self):
        pub = self.ks.publish
        for aid in self.aids.values():
            doc = json.loads((pub / "keyring-demo-state" / aid / "did.json").read_text())
            self.assertEqual(doc["id"], f"did:web:storage.googleapis.com:bkt:keyring-demo-state:{aid}")
            self.assertEqual(doc["alsoKnownAs"][0], f"did:webs:storage.googleapis.com:bkt:keyring-demo-state:{aid}")
            self.assertTrue((pub / "keyring-demo-state" / aid / "keri.cesr").read_bytes().startswith(b'{"v":"KERI'))
        everything = "".join(p.read_text() for p in pub.rglob("*") if p.is_file() and p.suffix != ".cesr")
        self.assertNotIn("<script>x</script>", everything)  # the label never leaves the keystore
        self.assertNotIn("&lt;script&gt;x", everything)
        self.assertFalse(any("keys" in p.parts for p in pub.rglob("*")))

    def test_the_pickup_pages_escape_the_state_name_and_drop_the_qr_once_revoked(self):
        pub = self.ks.publish / "cards"
        live = (pub / f"{self.card['pickupId']}.html").read_text()
        gone = (pub / f"{self.gone['pickupId']}.html").read_text()
        self.assertNotIn("<b>State</b>", live + gone)
        self.assertIn("Demo &lt;b&gt;State&lt;/b&gt;", live)
        self.assertIn("<svg", live)  # control
        for page in (live, gone):
            self.assertEqual(page.count("Not issued by the Demo &lt;b&gt;State&lt;/b&gt;."), 1)
        self.assertNotIn("<svg", gone)
        self.assertEqual(json.loads((pub / f"{self.gone['pickupId']}.status.json").read_text())["status"], "revoked")


class TwoHostSites(unittest.TestCase):
    """The TEST site and the PROD warning: no keripy needed."""

    def test_no_test_host_is_one_host_as_before(self):
        self.assertIsNone(office.test_site_for(office.Site("prod.example.org"), None))
        self.assertIsNone(office.test_site_for(office.Site("prod.example.org"), ""))

    def test_test_is_never_prod(self):
        prod = office.Site("prod.example.org")
        for same in ("prod.example.org", "PROD.example.org"):
            with self.subTest(same=same):
                with self.assertRaises(office.OfficeError) as e:
                    office.test_site_for(prod, same)
                self.assertEqual(e.exception.code, "badHost")
        self.assertEqual(office.test_site_for(prod, "tunnel.example.com").host, "tunnel.example.com")  # control
        with self.assertRaises(office.OfficeError):
            office.test_site_for(prod, "tunnel.example.com/x")  # a bare hostname only

    def test_a_prod_path_prefix_is_said_not_refused(self):
        self.assertEqual(len(office.site_warnings(office.Site("storage.googleapis.com", "bkt"))), 1)
        self.assertEqual(office.site_warnings(office.Site("prod.example.org")), [])  # control


PROD_HOST, TEST_HOST = "prod.example.org", "tunnel.example.com"


def throwaway_office(base: Path, prod: str, test: str | None, k0_dir=None):
    os.environ["KEYRING_SEDI_K1_PASSCODE"] = "a-throwaway-test-passcode-123"
    office.PASSCODE_FROM_KEYCHAIN = False  # tests never read the real Keychain item
    office.load_keripy(KERIPY)
    ks = office.Keystore(base / "ks")
    ks.ensure()
    prod_site = office.Site(prod)
    return office.Office(ks, prod_site, "Demo State", k0_dir, office.test_site_for(prod_site, test))


def tree_bytes(root: Path) -> dict:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


@unittest.skipUnless((KERIPY / "tests" / "sedi" / "test_sedi.py").exists(), "pinned keripy clone not found")
class TwoHosts(unittest.TestCase):
    """PROD and TEST on one throwaway keystore: one designation naming both, one tree each, cards the same in both."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.office = throwaway_office(Path(cls.tmp.name), PROD_HOST, TEST_HOST)
        cls.aids = cls.office.init()["aids"]
        cls.prod_card = cls.office.issue(AID_I, WARD_B)
        cls.test_card = cls.office.issue(AID_I, WARD_1AAI, host="test")
        cls.written = cls.office.write_publish_tree()
        cls.prod, cls.test = cls.office.ks.publish, cls.office.ks.publish_test

    @classmethod
    def tearDownClass(cls):
        cls.office.close()
        cls.tmp.cleanup()

    def test_the_root_designates_the_three_dids_at_each_host(self):
        ids = self.office.current_aliases()["ids"]
        self.assertEqual(ids, [f"did:webs:{h}:keyring-demo-state:{self.aids[r]}"
                               for h in (PROD_HOST, TEST_HOST) for r in office.ROLES])
        self.assertEqual(len(self.office.data["aliases"]), 1)  # one ACDC for both hosts
        self.assertEqual(self.office.data["site"]["testHost"], TEST_HOST)  # remembered, like --host
        self.assertIs(self.office.designate(), self.office.current_aliases())  # the same hosts: a no-op

    def test_each_tree_names_its_own_host_and_shares_the_kels_and_the_designation(self):
        for aid in self.aids.values():
            d = f"keyring-demo-state/{aid}"
            for tree, host in ((self.prod, PROD_HOST), (self.test, TEST_HOST)):
                with self.subTest(aid=aid, host=host):
                    doc = json.loads((tree / d / "did.json").read_text())
                    self.assertEqual(doc["id"], f"did:web:{host}:keyring-demo-state:{aid}")
            self.assertEqual((self.prod / d / "keri.cesr").read_bytes(), (self.test / d / "keri.cesr").read_bytes())
        roy = f"keyring-demo-state/{self.aids['roy']}/{office.ALIASES_FILE}"
        self.assertEqual((self.prod / roy).read_bytes(), (self.test / roy).read_bytes())
        self.assertTrue(any(p.startswith("publish-test/") for p in self.written))

    def test_every_card_is_the_same_bytes_in_both_trees_naming_its_own_host(self):
        for card, host in ((self.prod_card, PROD_HOST), (self.test_card, TEST_HOST)):
            pid = card["pickupId"]
            for ext in ("json", "status.json", "html"):
                with self.subTest(host=host, ext=ext):
                    a = (self.prod / "cards" / f"{pid}.{ext}").read_bytes()
                    self.assertEqual(a, (self.test / "cards" / f"{pid}.{ext}").read_bytes())
            bundle = json.loads((self.prod / "cards" / f"{pid}.json").read_text())
            self.assertEqual(bundle["pickupJsonUrl"], f"https://{host}/cards/{pid}.json")
            view = self.office.card_view(card)
            self.assertEqual((view["host"], view["hostDesignated"]), (host, True))
        self.assertEqual(self.office.card_view(self.prod_card)["hostKind"], "prod")  # PROD by default
        self.assertEqual(self.office.card_view(self.test_card)["hostKind"], "test")

    def test_the_host_is_prod_or_test_and_test_needs_a_test_host(self):
        for bad in ("bogus", "", None, PROD_HOST):
            with self.subTest(host=bad):
                with self.assertRaises(office.OfficeError) as e:
                    self.office.issue(AID_I, WARD_B, host=bad)
                self.assertEqual(e.exception.code, "badHost")
        saved, self.office.test_site = self.office.test_site, None
        try:
            with self.assertRaises(office.OfficeError) as e:
                self.office.issue(AID_I, WARD_B, host="test")
            self.assertEqual(e.exception.code, "badHost")
        finally:
            self.office.test_site = saved

    def test_a_revoke_writes_both_trees_before_the_upload_runs(self):
        card = self.office.issue(AID_I, WARD_B)
        self.office.write_publish_tree()
        seen = Path(self.tmp.name) / "seen"
        pid = card["pickupId"]
        cmd = (f"cat ../publish-test/cards/{pid}.status.json > {seen} && "
               f"cat ../publish-test/keyring-demo-state/{self.aids['sue']}/keri.cesr > {seen}.kel")
        srv, saved = serve_office(self.office, cmd)
        try:
            c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=30)
            c.request("POST", f"/api/cards/{card['said']}/revoke",
                      headers={"Host": f"127.0.0.1:{srv.server_address[1]}", "Authorization": f"Bearer {TOKEN}",
                               "Content-Length": "0"})
            r = c.getresponse()
            body = json.loads(r.read())
            c.close()
        finally:
            stop_office(srv, saved)
        self.assertEqual((r.status, body["status"], body["published"]), (200, "revoked", True))
        self.assertEqual(json.loads(seen.read_text())["status"], "revoked")  # TEST was current before the upload
        self.assertEqual(Path(f"{seen}.kel").read_bytes(), self.office.kel("sue"))

    def test_the_officer_api_says_both_hosts_and_takes_the_test_tree(self):
        srv, saved = serve_office(self.office, None)
        try:
            port = srv.server_address[1]
            health = api_get(port, "/api/health")
            self.assertEqual(health["hosts"], {"prod": {"host": PROD_HOST, "pathPrefix": ""},
                                               "test": {"host": TEST_HOST, "pathPrefix": ""}})
            files = api_get(port, "/api/files?tree=test")
            self.assertEqual(files["host"], TEST_HOST)
            self.assertTrue(files["files"] and all(f["publicUrl"].startswith(f"https://{TEST_HOST}/")
                                                   for f in files["files"]))
            self.assertEqual(api_get(port, "/api/files")["host"], PROD_HOST)  # control: PROD by default
            for bogus in ("/api/files?tree=keys", "/api/files?tree=..", "/api/files?tree=test&tree=prod",
                          f"/api/files/view?tree=x&path=cards/{self.prod_card['pickupId']}.json"):
                with self.subTest(target=bogus):
                    self.assertEqual(api_get(port, bogus, status=404), {"error": "notFound"})
            view = api_get(port, f"/api/files/view?tree=test&path=cards/{self.test_card['pickupId']}.json", raw=True)
            self.assertEqual(view, (self.test / "cards" / f"{self.test_card['pickupId']}.json").read_bytes())
            created = api_post(port, "/api/cards", {"holder": AID_I, "ward": WARD_B, "host": "test"})
            self.assertEqual(created["host"], TEST_HOST)
            self.assertEqual(api_post(port, "/api/cards", {"holder": AID_I, "ward": WARD_B, "host": "x"},
                                      status=400)["error"], "badHost")
        finally:
            stop_office(srv, saved)


@unittest.skipUnless((KERIPY / "tests" / "sedi" / "test_sedi.py").exists(), "pinned keripy clone not found")
class HostsChange(unittest.TestCase):
    """A card names one host for life; the designation drops a host that goes; an orphan stays current."""

    def test_a_card_keeps_its_host_and_an_orphan_stays_published_and_current(self):
        with tempfile.TemporaryDirectory() as d:
            o = throwaway_office(Path(d), PROD_HOST, TEST_HOST)
            o.init()
            card = o.issue(AID_I, WARD_B)
            o.write_publish_tree()
            first = o.current_aliases()
            o.close()
            o = throwaway_office(Path(d), "prod2.example.org", TEST_HOST)  # PROD moves
            try:
                o.write_publish_tree()
                ids = o.current_aliases()["ids"]
                self.assertFalse(any(PROD_HOST in i for i in ids))  # the old host is dropped, not kept
                self.assertTrue(any("prod2.example.org" in i for i in ids))  # control
                old = [x for x in o.data["aliases"] if x["said"] == first["said"]]
                self.assertEqual([x["state"] for x in old], ["revoked"])  # the old designation is withdrawn
                self.assertEqual(len(o.data["aliases"]), 2)
                card = o.data["cards"][card["said"]]
                view = o.card_view(card)
                self.assertEqual(view["pickupJsonUrl"], f"https://{PROD_HOST}/cards/{card['pickupId']}.json")
                self.assertEqual((view["hostKind"], view["hostDesignated"]), ("orphan", False))
                self.assertEqual([c["said"] for c in o.orphans()], [card["said"]])
                o.revoke(card["said"])
                o.write_publish_tree()
                for tree in (o.ks.publish, o.ks.publish_test):  # still published, and current, never deleted
                    status = json.loads((tree / "cards" / f"{card['pickupId']}.status.json").read_text())
                    self.assertEqual(status["status"], "revoked")
            finally:
                o.close()

    def test_no_test_host_writes_one_tree_as_before(self):
        with tempfile.TemporaryDirectory() as d:
            o = throwaway_office(Path(d), PROD_HOST, None)
            try:
                o.init()
                card = o.issue(AID_I, WARD_B)
                written = o.write_publish_tree()
                self.assertFalse(o.ks.publish_test.exists())
                self.assertFalse(any(p.startswith("publish-test/") for p in written))
                self.assertEqual(len(o.current_aliases()["ids"]), 3)
                self.assertNotIn("testHost", o.data["site"])
                self.assertEqual(card["site"], {"host": PROD_HOST, "pathPrefix": ""})
                with self.assertRaises(office.OfficeError):
                    o.issue(AID_I, WARD_B, host="test")
            finally:
                o.close()

    @unittest.skipUnless((BIFOLD / ".git").exists(), "no bifold clone for the K0 kit")
    def test_k0_is_in_both_trees_each_naming_its_host(self):
        with tempfile.TemporaryDirectory() as d:
            o = throwaway_office(Path(d), PROD_HOST, TEST_HOST, office.DEFAULT_K0_DIR)
            try:
                o.init()
                o.write_publish_tree()
                for tree, host in ((o.ks.publish, PROD_HOST), (o.ks.publish_test, TEST_HOST)):
                    doc = json.loads((tree / "keyring-demo-state" / office.K0_ROOT / "did.json").read_text())
                    self.assertEqual(doc["id"], f"did:web:{host}:keyring-demo-state:{office.K0_ROOT}")
                k0 = {p.name for p in (o.ks.publish / "keyring-demo-state").iterdir()} - set(o.data["aids"].values())
                self.assertEqual(len(k0), 3)
                self.assertEqual(k0, {p.name for p in (o.ks.publish_test / "keyring-demo-state").iterdir()}
                                 - set(o.data["aids"].values()))
            finally:
                o.close()


TOKEN = "t" * 32


def serve_office(o, publish_cmd):
    import threading as th
    saved = {k: getattr(office.Api, k, None) for k in ("office", "token", "port", "publish_cmd")}
    srv = office.HTTPServer(("127.0.0.1", 0), office.Api)
    office.Api.office, office.Api.token, office.Api.port, office.Api.publish_cmd = (o, TOKEN, srv.server_address[1],
                                                                                    publish_cmd)
    office.Api.log_message = lambda *a: None
    th.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, saved


def stop_office(srv, saved):
    srv.shutdown()
    srv.server_close()
    for k, v in saved.items():
        setattr(office.Api, k, v)
    del office.Api.log_message


def api_get(port, target, status=200, raw=False):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request("GET", target, headers={"Host": f"127.0.0.1:{port}", "Authorization": f"Bearer {TOKEN}"})
    r = c.getresponse()
    body = r.read()
    c.close()
    assert r.status == status, (target, r.status, body[:200])
    return body if raw else json.loads(body)


def api_post(port, target, payload, status=201):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    data = json.dumps(payload).encode()
    c.request("POST", target, body=data, headers={"Host": f"127.0.0.1:{port}", "Authorization": f"Bearer {TOKEN}",
                                                   "Content-Type": "application/json",
                                                   "Content-Length": str(len(data))})
    r = c.getresponse()
    body = json.loads(r.read())
    c.close()
    assert r.status == status, (target, r.status, body)
    return body


if __name__ == "__main__":
    unittest.main()
