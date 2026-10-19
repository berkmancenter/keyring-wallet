// The browser half of a VTC's member sign-in (auth/oob, VTI's member portal), for the gate's sign-in leg. A driver plays
// the portal: a fresh Ed25519 did:key (K_b) signs each Trust Task for `authentication` and POSTs it to the VTC's
// TrustTaskHTTPS base with the portal's Origin, as vtc-service/admin-ui/src/members/oob.ts does. Without the Origin
// header auth/oob/request answers 403 permissionDenied (docs/spikes/20261011-oob-sign-in-findings.md, M2). No admin
// credential: the person approves on the phone, and the redeem says what they approved.
import { fileURLToPath } from 'node:url';

const REF = new URL('../../tsp-reference/ref-20-local-vetting/', import.meta.url);
const SPEC = 'https://trusttasks.org/spec/';
export const SIGN_IN_FLOW = '/vti/flow/sign-in/0.1';

/** The VTC's DID with `&`, `=`, `#` and `%` percent-encoded, as the trigger link's `_from` carries it. */
export const encodeFrom = (did) => String(did).replace(/[%&=#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

/** The trigger link a phone claims: the portal's QR, in the VTI trigger-link form Keyring reads. */
export function triggerLink({ vtcDid, requestId, claimDeadline, linkHost = 'link.trustoverip.org', flow = SIGN_IN_FLOW }) {
  return `https://${linkHost}/t#_from=${encodeFrom(vtcDid)}&_id=${requestId}&_exp=${claimDeadline}&_type=${flow}`;
}

/**
 * One redeem answer, classified: `pending` (with the two digits the phone types, once it has claimed), `declined`
 * (the person cancelled), `expired`, `approved` (subject, displayName, notAfter, amr), or `error`.
 */
export function redeemState(body) {
  const b = body ?? {};
  if (typeof b.subject === 'string') return { state: 'approved', subject: b.subject, displayName: b.displayName, notAfter: b.notAfter, amr: b.amr ?? [] };
  const code = String(b.code ?? '');
  // The portal reads the local part of `auth/oob/redeem:<code>` (oob.ts); a bare code is its own local part.
  const local = code.slice(code.lastIndexOf(':') + 1);
  if (local === 'pending') return { state: 'pending', phase: b.details?.state, matchNumber: b.details?.matchNumber };
  if (local === 'requestExpired' || local === 'expired') return { state: 'expired', code };
  if (local === 'declined' || local === 'cancelled') return { state: 'declined', code, phase: b.details?.state };
  return { state: 'error', code, message: b.message };
}

/** The Origin a portal's requests carry: scheme and host of its SignInPortal URL, no path and no trailing slash. */
export const originOf = (signInPortal) => new URL(signInPortal).origin;

/** The decision window the VTC gives after a claim, on top of the claim deadline: the long poll's overall bound. */
export const DECISION_WINDOW_S = 120;

export async function createSigninPortal({ trustTaskBase, portalOrigin, vtcDid }) {
  const { generateDidKeyHolder } = await import(fileURLToPath(new URL('di-proof.mjs', REF)));
  const { signTask } = await import(fileURLToPath(new URL('vtc-admin.mjs', REF)));
  const holder = generateDidKeyHolder();
  const send = async (task, payload) => {
    const doc = signTask(`${SPEC}${task}`, payload, holder, vtcDid);
    const res = await fetch(`${trustTaskBase}/trust-tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: portalOrigin },
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`${task} answered ${res.status} with no JSON: ${text.slice(0, 120)}`); }
    return { status: res.status, body: body?.payload ?? body };
  };
  return {
    holderDid: holder.did,
    /** auth/oob/request/0.1 for a login by scan: `{requestId, claimDeadline}`. */
    async request() {
      const r = await send('auth/oob/request/0.1', { purpose: 'login', mode: 'scan' });
      if (!r.body?.requestId) throw new Error(`auth/oob/request refused (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
      return r.body;
    },
    /** auth/oob/redeem/0.1 once, classified (redeemState). The VTC holds a pending redeem open a while (long poll). */
    async redeem(requestId) {
      return { ...redeemState((await send('auth/oob/redeem/0.1', { requestId })).body) };
    },
    /**
     * Redeem until it is no longer pending, or until the request's claim deadline plus the decision window: a stuck
     * request cannot hold the leg. `onPending` sees each pending answer (the match number arrives in one).
     */
    async awaitRedeem({ requestId, claimDeadline }, { onPending } = {}) {
      const until = (Number(claimDeadline) + DECISION_WINDOW_S) * 1000;
      let last;
      while (Date.now() < until) {
        last = await this.redeem(requestId);
        if (last.state !== 'pending') return last;
        if (onPending) await onPending(last);
        await new Promise((r) => setTimeout(r, 2000));
      }
      return { state: 'expired', code: 'harness:deadline', last };
    },
  };
}

/** The member portal's own description of itself: `{vtcDid, linkHost, flow}` (GET <origin>/v1/member/sign-in/config). */
export async function signinConfig(portalOrigin) {
  const res = await fetch(`${portalOrigin}/v1/member/sign-in/config`, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`no member sign-in at ${portalOrigin} (config answered ${res.status}, not JSON): this VTC predates it`); }
}
