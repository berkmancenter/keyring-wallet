// live-play-integrity-optional.mjs — the real Play Integrity round trip,
// parked until real access exists.
//
// This is NOT part of `npm start` / `npm run check`. Play Integrity tokens
// are encrypted; there is no offline verification path, with or without
// test data — decoding one is a live call to Google's own backend. Run
// this by hand, once the setup below exists, to actually exercise it.
//
// Setup needed (none of this exists in this repo today):
//
//   1. A registered Android app in Google Play Console, with the Play
//      Integrity API enabled for its Google Cloud project.
//   2. A service account (in that same Cloud project) granted the
//      "Service Account Token Creator" role, with a downloaded JSON key —
//      NOT checked into this repo. Point PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY
//      at its path.
//   3. A real Play Integrity token, obtained by calling
//      `IntegrityManager.requestIntegrityToken()` from a real Android app
//      built with that package name, running on a real (or Play-Protect-
//      certified emulator) device. Point PLAY_INTEGRITY_TOKEN at it —
//      tokens are short-lived, so this has to be fresh per run.
//   4. PLAY_INTEGRITY_PACKAGE_NAME set to that app's exact package name.
//
// Run:
//   PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY=/path/to/key.json \
//   PLAY_INTEGRITY_PACKAGE_NAME=com.example.app \
//   PLAY_INTEGRITY_TOKEN=eyJ... \
//     node live-play-integrity-optional.mjs

import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const KEY_PATH = process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY;
const PACKAGE_NAME = process.env.PLAY_INTEGRITY_PACKAGE_NAME;
const TOKEN = process.env.PLAY_INTEGRITY_TOKEN;

if (!KEY_PATH || !PACKAGE_NAME || !TOKEN) {
  console.log(`SKIPPED — not configured. This is expected until real Play Console / Google Cloud
access exists (see the comment block at the top of this file for the setup).

Missing: ${[
    !KEY_PATH && "PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY",
    !PACKAGE_NAME && "PLAY_INTEGRITY_PACKAGE_NAME",
    !TOKEN && "PLAY_INTEGRITY_TOKEN",
  ].filter(Boolean).join(", ")}`);
  process.exit(0);
}
if (!existsSync(KEY_PATH)) {
  console.error(`PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY points at a file that doesn't exist: ${KEY_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, "utf8"));

// Standard OAuth 2.0 service-account JWT-bearer flow
// (https://developers.google.com/identity/protocols/oauth2/service-account),
// hand-rolled rather than pulling in `google-auth-library` for one token
// exchange — the same "small, isolated surface" preference the rest of
// this corpus applies to crypto.
function base64url(input) {
  return Buffer.from(input).toString("base64url");
}
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/playintegrity",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(serviceAccount.private_key).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

const accessToken = await getAccessToken();
console.log("obtained an access token; decoding the integrity token...");

const decodeRes = await fetch(
  `https://playintegrity.googleapis.com/v1/${encodeURIComponent(PACKAGE_NAME)}:decodeIntegrityToken`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ integrityToken: TOKEN }),
  },
);
const decoded = await decodeRes.json();
if (!decodeRes.ok) {
  console.error(`decodeIntegrityToken failed: ${decodeRes.status}`, JSON.stringify(decoded, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(decoded, null, 2));

// The check this rung actually cares about, once a real token exists: is
// the requestHash Google reports the same value this run's transcript
// binding produced? (see run.mjs act 3's `clientDataHash` construction —
// Play Integrity's `requestDetails.requestHash` plays the same binding
// role App Attest's clientDataHash does.)
const requestHash = decoded?.tokenPayloadExternal?.requestDetails?.requestHash;
console.log(`\nrequestHash reported by Google: ${requestHash ?? "(none present)"}`);
console.log("Compare this by hand against the transcript binding you set as the request's nonce.");
