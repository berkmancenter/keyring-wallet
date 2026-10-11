# ref-23: the member's agent vouches for them

The second step of trigger-link sign-in. After the claim (ref-22) the browser shows a two-digit number. The member's **VTA** signs `auth/oob/identify/0.1` as the member's persona DID, saying "this is member X, and the number is NN". The wallet forwards it in `auth/oob/prove/0.1`, and the community checks the membership, the proof and the number, then answers step 2.

```sh
node run.mjs --portal https://keyring-signin-vtc.ngrok.app \
  --persona <persona did> --entry <vault entry id> \
  --pnm ~/vti-stack/build-main-03a3562f/signed/pnm --pnm-home ~/vti-stack/signin/pnm-home --vta signin-tsp-alberto
```

## Needs

- **A VTA on VTI main** (#1997).
- **A persona that is a member of the community**, joined from Keyring here.
- **A `did-self-issued` vault entry** for that persona, targeting the community's DID. The VTA creates none at join, so the wallet must create it.
  - The secret `{"kind":"did-self-issued","did":<persona>,"signingKeyId":<persona>#key-0}` is sealed to the VTA.
  - With pnm: `pnm vault upsert --entry-file e.json --secret-file s.json --transport didcomm`.
- **The calling DID registered as a device** (`pnm device register --display-name …`). The VTA refuses identify otherwise.

## Result

**10/10** against the sign-in test bed (`~/vti-stack/signin`), 2026-10-11 04:46Z.

**What was checked:**
- The VTA signs identify as the persona, for `authentication`, and returns the document it was given (JCS-equal).
- The VTC accepts prove and answers step 2 for `assertionMethod`: the browser session key, the identified persona, and the requester details.
- The request can still be cancelled after step 2.
- A wrong number is refused with `numberMismatch`.

**Rate limit:** back-to-back runs from one address hit the VTC's limit of five open codes per address (HTTP 429). Wait for codes to expire (120 s) between runs.
