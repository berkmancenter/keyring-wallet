// Demo State Office: picking the two codes out of whatever the phones sent (a message, a note, both codes at once),
// so the officer pastes once instead of typing. Shape only, the same shapes the form checks: a guardian's code is 44
// characters starting E or I; a ward's code is 44 starting B, or 48 starting 1AAI. The issuer checks them for real.
// A code that shows up twice counts once; two DIFFERENT codes of one kind are ambiguous, and that field is left alone.
// Loaded by the officer page before officer.js, and by node for its test (codes.test.js).
"use strict";
(() => {
  const isHolder = (t) => t.length === 44 && /^[EI]/.test(t);
  const isWard = (t) => (t.length === 44 && t.startsWith("B")) || (t.length === 48 && t.startsWith("1AAI"));

  /** { holder, ward } from free text: each is the one code of its kind found, or "" (none, or more than one). */
  const pickCodes = (text) => {
    const tokens = String(text ?? "").split(/[^A-Za-z0-9_-]+/);
    const holders = new Set(tokens.filter(isHolder));
    const wards = new Set(tokens.filter(isWard));
    return {
      holder: holders.size === 1 ? [...holders][0] : "",
      ward: wards.size === 1 ? [...wards][0] : "",
      holderCount: holders.size,
      wardCount: wards.size,
    };
  };

  const api = { pickCodes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.SediOfficeCodes = api;
})();
