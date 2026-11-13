# SEDI demo State office (K1)

A local issuer for the Keyring SEDI demo: a demo state (root, org unit, issuing agent) whose keys are KEPT on this
Mac, a Guardian card issued to a guardian's phone-made AID naming a ward's phone-made AID, live revoke, and the
files a public host serves so phones can resolve the state (did:webs) and pick up a card.

Test issuer only: not a government service. Its cards are labelled Demo in the app.

Work in progress; usage is filled in as the commands land.

## Where things live

- Keystore (default `~/.keyring-sedi-k1/`, mode 700, `--keystore` to change): `keys/` (keripy stores, encrypted with
  the passcode), `office.json` (local labels and card index), `officer.token` (mode 600), and `publish/` (the tree
  to upload as-is). Nothing in the keystore is ever committed.
- Passcode: prompted, or `KEYRING_SEDI_K1_PASSCODE`. Never stored in this repo.
- `publish/` mirrors the host: `<path-prefix>/<AID>/{did.json,keri.cesr}` for the three state AIDs, and
  `cards/<pickupId>.{json,html,status.json}`.
