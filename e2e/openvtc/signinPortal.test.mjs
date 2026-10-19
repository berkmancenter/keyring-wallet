import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFrom, originOf, redeemState, triggerLink } from './signinPortal.js';

const VTC = 'did:webvh:QmWuySqDabSg7g3CpK2jWR6j6UmWkU5DcT8X7aHBY7iHEc:dids-keyring-hv-lab1.ic3.dev:keyring-hv-lab1-vtc';

test('the trigger link carries the VTC, the request and its deadline in the form Keyring reads', () => {
  const link = triggerLink({ vtcDid: VTC, requestId: 'AbCdEfGhIjKlMnOpQrStUv', claimDeadline: 1792360000 });
  assert.equal(link, `https://link.trustoverip.org/t#_from=${VTC}&_id=AbCdEfGhIjKlMnOpQrStUv&_exp=1792360000&_type=/vti/flow/sign-in/0.1`);
});

test('_from percent-encodes only & = # %', () => {
  assert.equal(encodeFrom('did:web:a.example%3A8443:x&y=z#k'), 'did:web:a.example%253A8443:x%26y%3Dz%23k');
});

test('redeem: pending before and after the claim, with the two digits once claimed', () => {
  assert.deepEqual(redeemState({ code: 'auth/oob/redeem:pending', details: { state: 'issued' } }), { state: 'pending', phase: 'issued', matchNumber: undefined });
  assert.deepEqual(redeemState({ code: 'auth/oob/redeem:pending', details: { state: 'claimed', matchNumber: '47' } }), { state: 'pending', phase: 'claimed', matchNumber: '47' });
});

test('redeem: approved, declined, expired, anything else', () => {
  const ok = redeemState({ subject: 'did:webvh:Qm:x', displayName: 'x', notAfter: 1792400000, amr: ['did', 'oob', 'uv'] });
  assert.equal(ok.state, 'approved');
  assert.deepEqual(ok.amr, ['did', 'oob', 'uv']);
  assert.equal(redeemState({ code: 'auth/oob/redeem:declined', details: { state: 'cancelled' } }).state, 'declined');
  assert.equal(redeemState({ code: 'auth/oob/redeem:requestExpired' }).state, 'expired');
  assert.equal(redeemState({ code: 'auth/oob/redeem:pending', details: { state: 'cancelled' } }).state, 'declined');
  assert.equal(redeemState({ code: 'requestExpired' }).state, 'expired');
  assert.equal(redeemState({ code: 'permissionDenied', message: 'accepted only from the portal' }).state, 'error');
  assert.equal(redeemState(undefined).state, 'error');
});

test('the Origin is the SignInPortal URL\'s scheme and host, nothing else', () => {
  assert.equal(originOf('https://vtc-keyring-hv-lab1.ic3.dev/members/'), 'https://vtc-keyring-hv-lab1.ic3.dev');
  assert.equal(originOf('https://portal.example:8443/m/sign-in?x=1'), 'https://portal.example:8443');
});
