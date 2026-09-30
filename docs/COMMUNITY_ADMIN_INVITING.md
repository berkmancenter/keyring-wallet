# Inviting a Keyring user to your community

For admins of a community (a VTC) who use its admin console. This covers
issuing an invitation to someone who uses Keyring and where the community's
join rules are set. Screen names below are the console's own (VTC admin UI,
read at VTI `ed672fff`).

## 1. Get the identity to invite

An invitation names exactly one DID, and Keyring presents a different identity
to each community. So the invitee sends you the identity first:

1. In Keyring: **My Agent** → **I was invited** → scan or paste your
   community's link → **Continue**.
2. Keyring makes the identity for your community and shows it under **Send
   this to the community's admin**. It starts with `did:webvh:`.
3. They send it to you any way they like, then tap **I've sent it** and
   wait on that screen.

An invitation issued to any other DID, such as their agent's own DID or an
identity from another community, is refused by Keyring when they join.

## 2. Issue the invitation

Console → **Invitations**:

- **Invitee DID**: the identity from step 1.
- **Validity (days, optional)**: 1 to 90. The console's default is 7.
- **Role on join**: usually `member`.

Then **Issue invitation**. It appears under **Issued invitations**.

## 3. Get it to their phone

In **Issued invitations**, on the invitation's row:

- **Send** pushes it to the invitee's identity. Keyring picks it up on the
  waiting screen from step 1.
- **QR offer** shows a QR code. The invitee scans it with Keyring.

The waiting screen then shows **Join**. Keyring 224 and earlier accept
neither: they take only a `keyring://vti/invitation` link, which the console
does not produce.

**Revoke** withdraws an invitation that has not been used.

## 4. Where the join rules live

Console → **Vetting** → **Requirements** (**Admission criteria**). Each
criterion is one way into the community. **Add a criterion**, **Edit** and
**Remove** are on that page.

One behaviour to know before inviting (measured on VTC 0.11.58,
[VTI-Q25](VTI_UPSTREAM_FINDINGS.md)): if any criterion requires vetting,
everyone who joins is asked for vetting, invited or not. The invitee then
sees that the community "also needs vetting" and has to meet a vetter. To let
an invitation admit on its own, the community must publish no vetting
criterion.

## 5. Making a member a vetter

Console → **Vetting** → **Vetters** grants the vetter role to a member, for a
period you choose (up to two years). Keyring shows the new vetter a vetting
desk once the grant arrives.

## Known gaps

- The console shows the QR offer in the standard OpenID credential-offer
  format, with the community's DID as the issuer. Other wallets that open
  that format will fail on it. The question to upstream is recorded as
  [VTI-Q32](VTI_UPSTREAM_FINDINGS.md).
- A community delivers the membership credential once. If a phone misses it,
  no admin action sends it again ([VTI-Q27](VTI_UPSTREAM_FINDINGS.md)).
