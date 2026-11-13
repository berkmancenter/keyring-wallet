# Pickup page template

`pickup.html` is rendered by the issuer into `publish/cards/<pickupId>.html` on every issue and revoke.
Placeholders: `{{stateName}} {{pickupJsonUrl}} {{offerUrl}} {{issuedAt}} {{expiresAt}} {{statusJsonUrl}} {{qrSvg}} {{host}}`.
The page carries no JavaScript; the QR is an inline SVG. On revoke it is rendered with `{{qrSvg}}` empty and a revoked
notice. Owned by the UI/UX lane.
