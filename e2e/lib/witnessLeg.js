/**
 * The DIDComm version of the wallet-to-WITNESS leg, from WITNESS_LEG: "v1"
 * (the default) starts the witness on v1 only and connects the wallets to its
 * v1 invitation; "v2" starts it on v1+v2 and uses its out-of-band/2.0
 * invitation. The witness stays on v1 for now (product decision, 2026-11-25:
 * the wallet-to-wallet leg is what the mailbox changed, and the first
 * witnessed run with the mailbox on keeps the witness leg as production has
 * it); the move of the witness to v2 is owed soon, and is this one value.
 * Pure and dependency-free, so node --test can hold it without webdriverio.
 */
export function witnessLegFrom(value) {
  const leg = (value ?? "v1").toString().trim().toLowerCase() || "v1";
  if (leg !== "v1" && leg !== "v2") throw new Error(`WITNESS_LEG must be "v1" or "v2", got "${value}"`);
  return leg;
}

export function witnessLegFromEnv() {
  return witnessLegFrom(process.env.WITNESS_LEG);
}
