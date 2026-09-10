# R-Card Profile Picture — Plan

*Plan for adding a per-holder profile picture to the R-Card (Relationship Card) and
displaying it in the VRC contact list and detail views. No subtask plans yet; no
companions yet — this is the initial draft.*

---

## 1. Executive summary

R-Cards carry no image today. `RCardFormInput` (jCard-backed) has only
`firstName`/`lastName`/`email`/`organization`, and both VRC contact screens
(`ListContacts.tsx`, `ContactDetails.tsx`) render a hardcoded generic account icon.

The plan: add a `photo` field to the R-Card's jCard payload, using vCard's own
`PHOTO` property (RFC 6350 §6.2.4) holding a base64 JPEG data URI, capped at
256×256px / ~12KB post-base64. This rides inside `credentialSubject.card`
unchanged — that field is declared a JSON-LD "JSON literal" (`@type: '@json'`,
`vrc-contexts/credentialsV2Context.ts`), so its internal shape is opaque to the
JSON-LD/RDF layer and adding a property to it requires no context change. No new
DIDComm attachment, no OCA involvement — OCA brands credential *types*, not
individual holders, and VRC does not use it today.

Photo capture happens in `RCardOnboarding.tsx` (template edit time, pre-issuance);
rendering happens in `ListContacts.tsx`/`ContactDetails.tsx`, reusing the same
"opaque image string → RN `<Image>`, else letter/icon fallback" pattern bifold
already uses for `connection.imageUrl` (`ContactListItem.tsx`) and OCA's `logo`
(`LogoOrLetter.tsx`) — not a new rendering mechanism.

**Open, unresolved before this ships**: no DIDComm/mediator message-size limit is
documented anywhere in this repo. The 12KB budget is a reasoned estimate (RFC
0017's "small" tier), not a verified ceiling — it needs an empirical check
against a real mediator/relay (§6) before being treated as final.

---

## 2. Current state (verified 2026-09-04)

- **Schema**: `RCardFormInput` / `RCardValidationErrors` —
  `bifold/packages/core/src/modules/vrc/types/rcard.ts:3-10`. Four fields only.
  `buildJCardFromFormInput` (`rcard.ts:92-118`) emits an RFC 7095 jCard:
  `['vcard', [ [propName, params, type, value], ... ]]` with `version`, `fn`,
  `n`, optional `email` (`type: ['work']`), `org`. `extractFormInputFromJCard`
  (`rcard.ts:124-173`) is the inverse, `switch`-ing over property names.
- **Credential construction**: `buildRCardCredential`
  (`services/rCardCredential.ts:23-66`) sets
  `credentialSubject = { id: counterpartyRelationshipDid, card: template.jcard }`
  — the whole jCard blob, verbatim, becomes the issued VC's `card` value.
  `buildRCardTemplateW3cCredentialRecord` (`rCardCredential.ts:77-115`) persists
  the *unsigned* template locally (Askar `W3cCredentialRecord`, tagged
  `RCardTemplate`) before issuance — this is the mutable stage a photo would be
  added/edited/removed from; `extractRCardTemplateFromW3cRecord`
  (`rCardCredential.ts:161-214`) is the reverse.
- **Context**: `RCARD_CONTEXT_DOCUMENT`
  (`bifold/packages/vrc-contexts/src/credentialsV2Context.ts:44-69`) declares
  `card: { '@id': '...#card', '@type': '@json' }` — a JSON-LD 1.1 JSON literal,
  canonicalized via JCS (RFC 8785), not expanded property-by-property. Adding a
  `photo` entry inside the jCard needs no context edit.
- **Display resolution**: `ContactDisplayInfo`
  (`utils/rcardDisplayUtils.ts:16-20`) = `{ name?, email?, organization? }`;
  `resolveContactDisplayInfo` (`rcardDisplayUtils.ts:122-158`) resolves it,
  RCard-first with a legacy-issuer-object fallback. A parallel display-handler
  registry (`display/handlers/RelationshipCredentialHandler.ts`,
  `display/types.ts` — `CredentialDisplaySubject`) drives the credential-offer
  screen (`screens/CredentialOffer.tsx`) via the same fields, independently of
  the two contact screens.
- **Rendering — both screens bypass OCA and hardcode an icon**:
  - `ListContacts.tsx:358-360` — `renderContactItem` draws a fixed
    `avatarCircle` View with a generic `account-outline` `Icon`, not sourced
    from any per-contact data.
  - `ContactDetails.tsx:338-341` — same pattern, `AVATAR_SIZE = 50`.
  - Both derive their contact data from `groupedContacts` /
    `resolveContactDisplayInfo` over `w3cCredentialRecords` filtered by
    `isPeerVrcCredential`, not from `DidCommConnectionRecord`.
- **OCA (`bifold/packages/oca`) is keyed by credential type, not instance**:
  `OCABundleResolverType.resolve({identifiers: {schemaId, credentialDefinitionId,
  templateId}, ...})` (`legacy/resolver/oca.ts:78-101`) — one bundle per
  schema/credDef, shared by every holder. `IBrandingOverlayData.logo`
  (`interfaces/data/branding/BrandingOverlayData.interface.ts:3-13`) is a plain
  string (URL or data URI), rendered by `LogoOrLetter.tsx:41-54` via
  `toImageSource` (`utils/credential.ts:34-39`) straight into RN `<Image
  source={{uri}}>` — no resize/cache logic in this layer. VRC/R-Card does not
  construct or consume an OCA bundle anywhere (confirmed by grep).
- **Existing precedent for the render pattern this plan reuses**:
  `useConnectionImageUrl` (`utils/helpers.ts:320-325`) reads the standard Aries
  connection-invitation `imageUrl` field (RFC 0067/0160), rendered by
  `ContactListItem.tsx:106-109` — `contact.imageUrl ? <Image
  source={{uri: contact.imageUrl}}/> : <letter avatar>`. Same "opaque
  string → `<Image>`, else fallback" shape as OCA's `logo`. Note:
  `createRelationshipInvitation` (`vrc-manager.ts`, ~line 2482) never sets
  `imageUrl` on VRC's own OOB invitations, and the VRC contact screens don't
  read `connection.imageUrl` at all — this precedent exists in the codebase but
  isn't wired to VRC today.
- **Exchange transport**: `issueRCardCredential` (`vrc-manager.ts:747-802`) —
  standard Credo-TS `agent.modules.didcomm.credentials.offerCredential({
  protocolVersion: 'v2', credentialFormats: { jsonld: { credential,
  options: proofOptions } } })`. Credo packages the DIDComm attachment
  internally; the app never touches attachment byte sizes directly, and no
  DIDComm/mediator size-limit config or constant exists anywhere in
  `bifold/packages/core/src` (grepped: `maxMessageSize`, `messageSizeLimit`,
  `payload limit`, `mediator.*max`, `websocket.*limit` — zero hits). The one
  4KB figure that does appear (`slimCredentialForLog`, `vrc-manager.ts:44-70,
  96-97`) is an Android logcat line-truncation artifact, unrelated to wire
  transport.

---

## 3. Design

### 3.1 Format: JPEG

JPEG, not WebP or PNG. mDL (ISO/IEC 18013-5), the closest real-world precedent
for "a photo baked into a verifiable identity credential," mandates JPEG or
JPEG2000 specifically for universal cross-verifier decoder compatibility, not
compression efficiency. Given the VRC/OpenVTC ecosystem's stated posture toward
independent verifiers (`verifier`/`vrc-reference` packages;
`docs/plans/openvtc-integration-plan.md`), interop safety outweighs WebP's
~25-35% size advantage at equivalent visual quality. PNG is lossless/oversized
for a photographic image and has no offsetting benefit here.

### 3.2 Embedding: inline jCard `PHOTO` property, base64 data URI

RFC 6350 §6.2.4 defines vCard's `PHOTO` property as either a URI or inline
base64 data. RFC 0017 (Aries DIDComm attachments) tiers embedding by size:
small payloads go inline as an attribute value; a separate `~attach`
decorator with a hashlink is reserved for payloads that don't fit inline.
W3C VC precedent (`vc-data-model`) shows `credentialSubject.image` as a plain
`data:image/jpeg;base64,...` string — the de facto convention for embedded VC
portraits. At a ~12KB target this sits squarely in RFC 0017's "small" tier, so
this plan adds `photo` as a jCard property (`['photo', {}, 'uri',
'data:image/jpeg;base64,...']`) inside `credentialSubject.card`, not a separate
DIDComm attachment. **Rejected**: a `~attach`/hashlink attachment — adds a
second wire mechanism and a resolution step for a payload that fits
comfortably inline; reserve this route only if a future requirement (e.g.
higher-resolution photos) outgrows the small-file budget.

### 3.3 Size budget: ≤256×256px, ≤12KB post-base64 (~9KB raw)

256×256px covers the detail view (~200-300px) without upscaling and gives the
list view (~40-96px) headroom to downscale in memory — one well-compressed
source, not two separately-encoded copies (avoids compounding recompression
artifacts). ~9KB raw / ~12KB base64 keeps the whole credential message
comfortably inside RFC 0017's informal "email/MMS-sized" guidance for DIDComm
messages. **This number is not yet empirically verified against a real
mediator** — see §6.

### 3.4 Client-side pipeline

Resize, strip EXIF/GPS/ICC metadata, and JPEG-encode exactly once, at
issuance/template-save time, from the original capture — never resize then
recompress then resize again, which stacks generation loss. EXIF orientation
must be baked into pixels (not left as metadata) before the tag is stripped,
or the photo renders sideways for any consumer that doesn't honor EXIF
orientation. Use `expo-image-manipulator` if Expo is already a dependency in
`app/`/`bifold/packages/core` (needs confirming at implementation time); it
covers resize/rotate/crop with broader adoption than
`react-native-image-resizer`.

### 3.5 Not OCA

**Rejected**: routing the photo through OCA's branding-overlay system. OCA
resolves bundles by `schemaId`/`credentialDefinitionId`/`templateId`
(`legacy/resolver/oca.ts:78-90`) — one bundle shared by every holder of a
credential type. A profile picture is per-holder, not per-credential-type;
forcing it through OCA would mean either minting a distinct pseudo-schema per
contact (defeats the purpose of type-keyed bundles) or abusing the one
existing per-render override hook (`meta.logo` in `resolveAllBundles`,
`oca.ts:355-376`), which is unused elsewhere in the codebase and not designed
for this. The photo instead rides in the jCard as ordinary R-Card data,
resolved the same way `name`/`email`/`organization` already are.

### 3.6 Immutability

R-Cards separate a mutable local *template* (pre-issuance,
`RCardTemplate`-tagged `W3cCredentialRecord`) from the issued, immutable
`RelationshipCard` VC. Photo edits are unrestricted before issuance, same as
any other field; changing the photo after exchange requires re-issuing the
card, same existing semantics as editing name/email/organization post-exchange
— this plan introduces no new constraint here, only a new field subject to the
constraint that already exists.

---

## 4. Implementation steps

All work is in `bifold/packages/core/src/modules/vrc/` (a submodule); `app/`
consumes these as a library and needs no changes.

1. **Schema** — add `photo?: string` (a `data:image/jpeg;base64,...` URI) to
   `RCardFormInput` (`types/rcard.ts:3-8`); encode it as a jCard `PHOTO`
   property in `buildJCardFromFormInput` (`rcard.ts:92-118`); parse it back in
   `extractFormInputFromJCard`'s property switch (`rcard.ts:124-173`).
   **Done when**: a form input with a photo round-trips through
   `buildJCardFromFormInput` → `extractFormInputFromJCard` byte-identical, and
   existing round-trip tests for the four current fields still pass unchanged.
2. **Capture pipeline** — add an image picker + crop + resize/compress step to
   `RCardOnboarding.tsx`, enforcing the §3.3/§3.4 budget client-side with a
   clear, actionable error if a chosen photo can't be brought under budget.
   **Done when**: selecting an oversized or arbitrarily-oriented photo
   produces a ≤256×256px, ≤12KB, correctly-oriented, metadata-stripped JPEG
   data URI, verified by a unit test asserting output byte size and pixel
   dimensions.
3. **Display resolution** — add `photo?: string` to `ContactDisplayInfo`
   (`utils/rcardDisplayUtils.ts:16-20`) and extract it in
   `resolveContactDisplayInfo` (`rcardDisplayUtils.ts:122-158`), following the
   existing RCard-first/legacy-fallback priority order used for the other
   three fields.
   **Done when**: a resolved contact's `photo` reflects the most recent RCard
   template/credential exactly as `name`/`email`/`organization` already do,
   including the legacy-issuer-object fallback path (which has no photo and
   must resolve to `undefined`, not throw).
4. **Display-handler registry** — add the same field to `CredentialDisplaySubject`
   (`display/types.ts:31-36`) and `RelationshipCredentialHandler.extractSubject`
   (`display/handlers/RelationshipCredentialHandler.ts:62-74`), so the
   credential-offer screen (`screens/CredentialOffer.tsx`) gets the photo too.
   **Done when**: an incoming RCard offer's preview screen shows the sender's
   photo under the same resolution path as the contact screens, with no
   duplicate resolution logic.
5. **Rendering** — replace the hardcoded `avatarCircle`/`Icon` in
   `ListContacts.tsx:358-360` and `ContactDetails.tsx:338-341` with the same
   "string → RN `<Image>`, else letter/icon fallback" pattern already used by
   `ContactListItem.tsx:106-109` and `LogoOrLetter.tsx:41-54` — no new
   rendering utility.
   **Done when**: a contact with a photo shows it in both list and detail
   views at the correct size; a contact without one still shows today's
   fallback icon, unchanged.

---

## 5. Testing

- Extend the VRC module's existing jest suite (`bifold/packages/core` — the
  contract for this module per root `CLAUDE.md`) with the round-trip and
  render tests named in each step's acceptance criteria above.
- Run the full existing VRC suite (`cd bifold/packages/core && yarn test`) to
  confirm no regression to the four existing fields or to
  `resolveContactDisplayInfo`'s fallback behavior.
- Root `yarn typecheck` after the schema/type changes (§4.1, §4.3, §4.4).
- Manual/e2e verification: `yarn e2e:vrc` (or `:devices` if hardware
  attestation paths are touched, which they are not by this feature) with a
  photo attached on at least one side of the exchange, confirming the photo
  round-trips through issuance and renders in both views on-device.

---

## 6. Open questions / blocked

- **Message-size validation — blocked on an empirical run, not a decision.**
  No mediator/DIDComm size ceiling is documented anywhere in this repo (§2).
  Before treating the ~12KB budget (§3.3) as final, run `yarn e2e:vrc` or
  `yarn e2e:vrc:tsp` with a maximum-size photo through a real mediator/relay
  and confirm no truncation, rejection, or unexpected latency. If this surfaces
  a lower real ceiling, §3.3's numbers need revising before implementation.
- **Crop/aspect-ratio UX** for the onboarding capture flow (§4.2) is not
  designed yet — needs a design pass, not just an engineering one.
- **Format is decided** (JPEG, §3.1) but not yet stress-tested against actual
  photographic input at the 256×256/12KB budget — worth confirming the budget
  holds up visually before locking `RCardOnboarding.tsx`'s compression
  parameters.
