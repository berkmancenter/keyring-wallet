# ref-21: trigger-link reader

A standalone reader for trigger links (the QR code / link that starts a
`sign-in` or `vta-claim` exchange), in plain Node ESM with no dependencies,
checked against Keyring's conformance vectors.

## What it proves

- The reading order in the VTI trigger-link chapter (VTI-LNK-020, steps 1 to 11)
  can be written down as code that is short and readable. The rules covered are
  the WHATWG form parsing, the host rules, `_from` / `_id` / `_exp` / `_type`
  grammar, path-form resolution, `wrong-host`, version acceptance, flow contact
  rules and expiry skew. That code then returns the expected result for all 161
  trigger vectors.
- The transport-selection rule (VTI-LNK-053, Keyring section 5 rule 5) passes
  17 of 18 selection vectors. The one failure is a place where Keyring's spec is
  stricter than #58 (see Discrepancies).

The reader was written from the spec text first. The vectors were run after
that. All 161 trigger vectors passed on the first run, with no changes to the
reader.

`reader.mjs` exports `readTrigger(text, { channel, config })`,
`selectService(didDoc, selectionConfig)`, `hostMeetsRules(host)` and
`isDid(value)`. It makes no network calls and never logs the input. A rejection
carries only `outcome`, `reason` and `ui`.

## Run

```sh
node run.mjs      # or: npm start
```

It prints one FAIL block for each failing vector, then a total for each set. It
exits 0 only if every vector passes. Right now it exits 1 because of
`sel-userinfo-endpoint`, on purpose.

## Sources

| Source | Where | Commit |
|---|---|---|
| Vectors (copied unmodified to `fixtures/vectors.json`) | keyring-wallet `origin/docs/vta-pool-claim-evaluation`, `docs/specs/keyring-qr-and-links.vectors.json` | `f49f68383a3974aa1f5da00dc0259c44d4d179dd` |
| Keyring spec | same branch, `docs/specs/keyring-qr-and-links.md` (and `.annex.md`) | `f49f68383a3974aa1f5da00dc0259c44d4d179dd` |
| Normative upstream text | `trustoverip/dtgwg-vti-spec` PR #58, `spec/07a-links.md` | head `b158f77f221fe4b9a04c29df0c5dae6dc3f52e62` |

All were read on 2026-10-11.

## Discrepancies

### 1. `sel-userinfo-endpoint`: fails on purpose, because Keyring's rule is stricter than #58

- **Vector.** It expects an `https://u@api.example.com/tt` endpoint to be no
  candidate, giving `no-common-transport`.
- **#58** (`spec/07a-links.md` lines 303 to 306, VTI-LNK-053): "Candidates are
  the services of the document whose `type` maps to a binding the reader
  implements, matched on `type` and never on `id`, whose endpoint is an `https`
  URL or a DID, and whose endpoint host, where it has one, meets the host rules."
  This rule says nothing about userinfo. The host `api.example.com` meets the
  host rules, so under #58 the service is a candidate and is selected.
- **Keyring** (`keyring-qr-and-links.md` line 151, section 5 rule 5): "their
  endpoint is an `https` URL with no userinfo, or a DID". This is not flagged as
  a difference from #58.
- **What the reader does.** It follows #58 and selects the service.
- **Suggested fix.** Add "with no userinfo" to VTI-LNK-053 upstream, or have
  Keyring's spec mark this as a difference from #58.

### 2. No vector is affected: #58 contradicts itself on percent-encoding in a path form

- **#58's parsing rule** (lines 97 to 100) says the fragment is
  "percent-decode[d] once". VTI-LNK-040 (lines 223 to 225) forbids
  percent-encoding in the decoded `_type`.
- **#58's example table** (line 575) says `_type=/vti/flow/sign%2Din/0.1` gives
  `bad-type`. But decoding once turns that value into `/vti/flow/sign-in/0.1`,
  which is valid, so the reader accepts it.
- **The vectors** test only the double-encoded case (`bad-type-percent-in-path`,
  `vta%252Dclaim`). That case agrees with decoding once.
- **Suggested fix.** Change the example to `sign%252Din`.

### 3. No vector is affected: places where the two specs disagree but nothing at reading time depends on it

- **First request.**
  - #58's VTI-LNK-054 (lines 312 to 315) says: "The first request MUST be a
    Trust Task document …". That applies to every trigger link.
  - Keyring's section 5 rule 7 leaves the first request to each flow, and keeps
    the Trust Task request only for VTI's flows (section 8.1).
  - Keyring names this difference itself.
- **Fresh key.** Keyring's section 5 rule 4 makes the fresh-key rule general.
  #58 states it only inside VTI-LNK-054. Keyring names this difference too.
- **Keyring additions with no counterpart in #58.** None of these contradicts
  #58:
  - the `ignored` list (`fragment.<name>` for each unknown `_`-prefixed name);
  - the `via` and `flow` fields of the result;
  - the detailed `_from` rules: the `/@` check comes first, a malformed `did:` is
    `bad-from`, and any other non-empty value is `unsupported-vid`.

  The reader follows them because #58 leaves these points open.
