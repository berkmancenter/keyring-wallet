# Pickup page templates

Rendered by the issuer into `publish/cards/<pickupId>.html`:

- `pickup.html` on issue. Placeholders: `{{stateName}} {{host}} {{offerUrl}} {{pickupJsonUrl}} {{statusJsonUrl}}
{{issuedAt}} {{expiresAt}} {{qrSvg}} {{notIssuedBy}}`.
- `pickup-revoked.html` on revoke, replacing it: no QR and no Open in Keyring link. Placeholders: `{{stateName}} {{host}}
{{statusJsonUrl}} {{issuedAt}} {{revokedAt}} {{notIssuedBy}}`.

Rules for the renderer:

- `{{qrSvg}}` is the only value inserted as markup (the issuer's own SVG). HTML-escape every other value.
- `{{stateName}}` is the display name without "(Demo)"; the templates add the Demo label themselves.
- `{{notIssuedBy}}` is the whole sentence, with its full stop, as the app's DemoNote says it ("Not issued by the State
  of Utah."). It sits in the banner, so the publisher no longer inserts it anywhere else.
- The pages carry no JavaScript, load nothing from outside (a meta CSP says so), and are `noindex, nofollow,
noarchive` with `no-referrer`. No names and no local labels ever go into them.

Owned by the UI/UX lane.
