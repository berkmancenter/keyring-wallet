# Officer page

The local officer page (Issue / list / Revoke), served by `office.py serve` at `/` on 127.0.0.1, same origin as the
API it calls (see `../README.md`). Plain HTML, CSS and JS: no framework, no build step, nothing loaded from outside.

- **Token:** pasted once into the page and kept in `sessionStorage` for this tab only, sent as
  `Authorization: Bearer …`. Never in a URL or `localStorage`.
- **Issue:** the guardian's code (44 characters, starting E or I) and the ward's code (44 starting B, or 48
  starting 1AAI), checked here only to say what is wrong early; the issuer's own check decides. The note is local
  only, never published.
- **One paste for both codes** (optional, above the two fields): paste whatever the phones sent, a message with
  either code or both, and `codes.js` fills each field it finds exactly one code for, by the same shapes. Two
  different codes of one kind fill nothing and say so. Tested by `node --test ../codes.test.js` (kept outside this
  folder, which the page serves).
- **The QR** is the issuer's `qrSvg`, shown through an `<img>` with a `data:` URL, so nothing in it can run.
- **Revoke** asks first, in the page. After a revoke the list shows "Revoked" with its time.
- **Published files** (testing only, read only): every entry of the publish tree the public server hands to
  phones, grouped by DID and by card. One the viewer won't open is listed all the same, with why. View opens a
  file as text (JSON pretty-printed, a KEL one event at a time, a pick-up page as
  source); "Copy public link" copies its URL at the current `--host`. It never lists or opens the keys or the
  office's own records; the API refuses them (see `../README.md`).
- Every screen carries the Demo banner.

Owned by the UI/UX lane.
