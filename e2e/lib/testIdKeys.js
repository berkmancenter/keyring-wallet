/**
 * The app's testID handles for a device row and a community card, computed
 * here as the app computes them (keyring-bifold screens/testIdKey.ts), and
 * which of a card's buttons leads into Vetting.
 *
 * Since keyring-bifold#160 a handle is a hash of the whole DID: the last 8
 * characters it used before are the same for two did:peer:2 keys on one
 * mediator. A runner may meet either build, so it looks for both handles
 * (`deviceKeys`, `communityCardKeys`), the current one first.
 *
 * Pure: no driver.
 */

/** FNV-1a (32-bit) of the DID, base 36, padded to 7 — the app's didHashKey. */
export function didHashKey(did) {
  let h = 0x811c9dc5;
  for (let i = 0; i < did.length; i++) {
    h ^= did.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

/** The DID's last ':' segment made testID-safe, for reading only — the app's didLabelKey. */
export const didLabelKey = (did) =>
  (did.split(":").pop() ?? "").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 16).replace(/^-+|-+$/g, "");

/** A device row's handle: AgentDevice_<key>, AgentDeviceRemove_<key>. */
export const deviceKey = (did) => didHashKey(did);

/** A community card's handle: AgentCommunityCard_<key>, AgentCommunityPrimary_<key>. */
export const communityCardKey = (did) => {
  const label = didLabelKey(did);
  const hash = didHashKey(did);
  return label ? `${label}-${hash}` : hash;
};

/** The handles a device row may carry: this build's, then an older build's. */
export const deviceKeys = (did) => [deviceKey(did), did.slice(-8)];

/** The handles a community card may carry: this build's, then an older build's. */
export const communityCardKeys = (did) => [communityCardKey(did), did.slice(-8)];

/**
 * What a community card's one button says when it leads into Vetting: "Open
 * the vetting desk" for a vetter (the vetter card's own "Vet others" is gone
 * since keyring-bifold#162) or "Continue your vetting" for an applicant. An
 * invitation's "Accept" leads elsewhere.
 */
export const VETTING_DOOR_WORDS = /vetting desk|continue your vetting/i;

/**
 * The card buttons on a page, by handle, from its source: the testIDs
 * `AgentCommunityPrimary_<key>`, in page order, each once.
 */
export function cardPrimaryIds(source) {
  const ids = [];
  for (const m of source.matchAll(/(?:com\.ariesbifold:id\/)?(AgentCommunityPrimary_[A-Za-z0-9_-]+)"/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  // Android's page source leaves out what is below the fold, so a card whose
  // button has not scrolled into view shows only its header: name the button
  // from the card's handle, for the caller to scroll to.
  for (const m of source.matchAll(/(?:com\.ariesbifold:id\/)?AgentCommunityCard_([A-Za-z0-9_-]+)"/g)) {
    const id = `AgentCommunityPrimary_${m[1]}`;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
