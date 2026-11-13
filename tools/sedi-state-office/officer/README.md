# Officer page

The local officer page (Issue / list / Revoke), served by `office.py serve` at `/` on 127.0.0.1, same origin as the
API it calls (see `../README.md`). Plain HTML, CSS and JS: no framework, no build step, nothing loaded from outside.

- **Token:** pasted once into the page and kept in `sessionStorage` for this tab only, sent as
  `Authorization: Bearer …`. Never in a URL or `localStorage`.
- **Issue:** the guardian's code (44 characters, starting E or I) and the ward's code (44 starting B, or 48
  starting 1AAI), checked here only to say what is wrong early; the issuer's own check decides. The note is local
  only, never published.
- **The QR** is the issuer's `qrSvg`, shown through an `<img>` with a `data:` URL, so nothing in it can run.
- **Revoke** asks first, in the page. After a revoke the list shows "Revoked" with its time.
- Every screen carries the Demo banner.

Owned by the UI/UX lane.
