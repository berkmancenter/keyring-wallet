/**
 * @bifold/trust-tasks — the Trust Task plumbing BOTH the Keyring wallet
 * (React Native / Hermes) and the witness-server (Node) run: document proofs
 * and digests, the binding-0.2 DIDComm carriage message, and the §7.2
 * payload validator. One implementation, so wallet and witness agree on
 * every digest and proof by construction.
 *
 * CONTRACT — platform-neutral: nothing in this package may import Node-only
 * (fs, path, process, node:*) or React-Native-only modules. The tsconfig
 * compiles with no ambient Node types on purpose, so a stray Node import
 * fails the build. Server-only helpers belong in @bifold/vrc-shared.
 */
export * from './carriage'
export * from './documentProof'
export * from './TrustTaskMessage'
export * from './TspEnvelopeMessage'
export * from './validator'
export * as tsp from './tsp'
