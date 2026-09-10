/**
 * `credential-exchange/query` → consent prompt → `credential-exchange/present`,
 * end to end against a live (if minimal) verifier — subtask §9 step 4's
 * happy path, wired into the actual app for the first time (previously only
 * proven by tsp-reference/ref-08-credential-exchange's standalone Node
 * scripts against a real vta-service).
 *
 * Two Android wallets first complete an ordinary VRC exchange (Alice ends up
 * holding a real, stored RelationshipCredential — nothing else in a fresh
 * wallet is queryable). A minimal verifier agent (e2e/lib/verifier.js — NOT
 * vta-service; see that file's header) then connects to Alice the same way
 * any peer would (paste an OOB invitation), sends credential-exchange/query
 * asking for a RelationshipCredential, and Alice's app should show the
 * "Credential request" consent prompt (CredentialExchangeQueryModal). This
 * script taps Share and asserts the verifier receives a valid
 * credential-exchange/present in reply.
 *
 * Passes clean on a Pixel 8 API 33 emulator + a physical device — see
 * docs/spikes/credential-exchange-query-e2e-findings.md for the six real
 * bugs (one a genuine upstream @credo-ts/core bug) found and fixed getting
 * there.
 *
 * Usage:
 *   ANDROID_AVD2=<second-avd> node run-credential-exchange-query.js
 *   ANDROID_UDID2=<second-device-udid> node run-credential-exchange-query.js
 *
 * Requires: hosted mediator reachable (baked into the app via app/.env),
 * appium with uiautomator2, built .apk (see lib/config.js), a cloudflared
 * tunnel for the verifier (same requirement e2e/lib/witness.js already has).
 */
import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
  tapTestId,
  existsTestId,
} from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertVrcReceived,
  completeOnboarding,
  dismissVrcConfirmationOverlayIfPresent,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { startVerifier } from "./lib/verifier.js";
import { androidCaps, androidDeviceCaps, ANDROID_AVD2, ANDROID_UDID2 } from "./lib/config.js";
import { printSuccess, printFailure } from "./lib/banner.js";

if (!ANDROID_AVD2 && !ANDROID_UDID2) {
  console.error(
    "run-credential-exchange-query needs a second device — set ANDROID_AVD2 " +
      "(second emulator) or ANDROID_UDID2 (a physical device's udid, see `adb devices`) " +
      "(Alice needs a real peer to get a queryable credential from first; see e2e/README.md)"
  );
  process.exit(1);
}
const walletBCaps = ANDROID_UDID2 ? androidDeviceCaps(ANDROID_UDID2) : androidCaps(ANDROID_AVD2);

// `claims` is OPTIONAL in DCQL (omit it to mean "no specific claim
// disclosure constraint") but MUST NOT be an empty array when present —
// Credo's own DCQL validation (a ValiError, not an app bug) rejects
// `claims: []` outright: "Array must be non-empty and have length of at
// least 1." Omitted here since this query only needs to confirm the
// credential type, not select individual disclosed claims.
// `type_values` for `ldp_vc` MUST be fully JSON-LD-expanded IRIs, not the
// credential's short compact type names — DCQL's own schema description says
// so ("the fully expanded types (IRIs) after the @context was applied"), and
// Credo's DcqlService builds its match candidates from a stored
// W3cCredentialRecord's `expandedTypes` tag, never its raw `type` array.
// Confirmed against a real stored VRC's actual tag (not guessed): "https://
// www.w3.org/2018/credentials#VerifiableCredential" is VCDM 1.1's IRI even
// though the credential's own @context is VCDM 2.0 — some context in the
// chain (dtg/v1 or relationship/v1) aliases the term back to it.
const DCQL_QUERY = {
  credentials: [
    {
      id: "vrc1",
      format: "ldp_vc",
      meta: {
        type_values: [
          [
            "https://www.w3.org/2018/credentials#VerifiableCredential",
            "https://www.firstperson.network/relationship#DTGCredential",
            "https://www.firstperson.network/relationship#RelationshipCredential",
          ],
        ],
      },
    },
  ],
};

let a, b, verifier;
try {
  await ensureAppium();

  console.log("[e2e] wallet A = android (holder), wallet B = android (VRC peer), verifier = local Node agent");
  a = await createSession("android");
  b = await createSession("android", walletBCaps);
  verifier = await startVerifier();

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  // Give Alice a real, stored credential to be queried for.
  const invitationUrl = await showRelationshipInvitation(a);
  await acceptInvitationViaPaste(b, invitationUrl);
  await acceptRelationshipProposalOnEitherSide(a, b);
  await assertVrcReceived(a, "Bob Baker");
  // The app auto-pushes Bob's chat screen with a "Relationship confirmed"
  // overlay right as the VRC lands — dismiss it before driving Alice's UI
  // any further (see the helper's own doc comment for why this is needed).
  await dismissVrcConfirmationOverlayIfPresent(a);

  // The verifier connects to Alice the same way Bob did — a plain OOB paste.
  const { url: verifierInvitationUrl, invitationId } = await verifier.createInvitation();
  await acceptInvitationViaPaste(a, verifierInvitationUrl);
  const verifierConnection = await verifier.waitForConnection(invitationId);

  const queryId = await verifier.sendCredentialExchangeQuery(verifierConnection, {
    dcqlQuery: DCQL_QUERY,
    nonce: `e2e-nonce-${Date.now()}`,
    purpose: "Prove your membership in this test",
  });
  console.log(`[e2e] credential-exchange/query sent (${queryId})`);

  const promptShown = await existsTestId(a, "CredentialExchangeQueryShare", 30000);
  if (!promptShown) throw new Error("CredentialExchangeQueryModal never appeared on Alice's device");
  await tapTestId(a, "CredentialExchangeQueryShare");

  const present = await verifier.waitForPresent(30000);
  if (present.threadId !== queryId) {
    throw new Error(`present.threadId (${present.threadId}) does not match the query id (${queryId})`);
  }
  if (!present.payload?.vp_token || typeof present.payload.vp_token !== "object") {
    throw new Error("credential-exchange/present carried no object vp_token");
  }
  console.log("[e2e] verifier received credential-exchange/present on the query thread");

  printSuccess("credential-exchange-query");
  process.exitCode = 0;
} catch (err) {
  printFailure("credential-exchange-query", err);
  for (const d of [a, b].filter(Boolean)) {
    try {
      await screenshot(d, "failure");
      await dumpSource(d, "failure");
    } catch {
      /* session may be dead */
    }
  }
  process.exitCode = 1;
} finally {
  for (const d of [a, b].filter(Boolean)) {
    try {
      await d.deleteSession();
    } catch {
      /* ignore */
    }
  }
  if (verifier) {
    try {
      await verifier.stop();
    } catch {
      /* ignore */
    }
  }
  stopAppium();
}
