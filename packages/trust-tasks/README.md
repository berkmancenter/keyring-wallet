# @bifold/trust-tasks

Trust Task plumbing shared by the **Keyring wallet** (React Native) and the
**witness-server** (Node):

- `documentProof` — eddsa-jcs-2022 document proofs, `digestMultibase`,
  `taskDigestMultibase` (framework 0.3 task digest: JCS excluding the
  top-level `proof`), `digestBytesEqual` (decoded-bytes comparison).
- `TrustTaskMessage` — the binding-0.2 DIDComm carriage (`~attach` id
  `trust-task`).
- `trustTaskPayloadValidator` — the §7.2 payload validator (Ajv 2020-12).

**Contract: platform-neutral.** Nothing here may import Node-only (`fs`,
`path`, `process`, `node:*`) or React-Native-only modules; the tsconfig has no
ambient Node types so a stray import fails the build. Server-only helpers
(wallet paths, Askar wallet utilities, document loaders) live in
`@bifold/vrc-shared`, which is **not** for the mobile app — see its README.

Consumed in development straight from `src/` by the app's Metro config and by
`@bifold/core`'s jest mapper; production bundles and the witness use `build/`.
