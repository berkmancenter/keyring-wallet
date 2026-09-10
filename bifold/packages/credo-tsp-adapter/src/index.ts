/**
 * @bifold/credo-tsp-adapter — Askar-backed implementations of
 * `@bifold/trust-tasks`'s tsp-core ports (`SigningKey`, `KeyAgreement`,
 * `VidResolver`). Together with `@bifold/trust-tasks`'s `tsp` module
 * (the port types and the port-based `pack`/`unpack` orchestration), this is
 * `credo-tsp-adapter` from the OpenVTC integration plan's Phase D (§5.2).
 */
export * from './identity'
export * from './vidResolver'
