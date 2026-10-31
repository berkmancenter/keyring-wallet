import { communityCardKeys } from "./testIdKeys.js";

// Which desk door to try, in order. A vetter of several communities has one door per community (AgentOpenDesk_<key>) and no
// plain AgentOpenDesk, so the first door on the page is whichever community is listed first: a seat or a ceremony for the second
// one opened the first one's desk (1031-1751, hvk-vetter-enrolled 3 → 3, "You vet for Keyring Lab Community"). With a community
// named, only its door is tried. A door for another community is never a stand-in for it.
const PLAIN = ["AgentOpenDesk", "AgentVetOthers", "AgentContinueVetting"];

// The plain door belongs to the one community the phone can vet for, and the card above it says which. Right after a second
// grant the phone has not taken it yet, so it still shows the plain door, for the OTHER community: the heading is the only
// thing on the page that tells the two apart. An unnamed community's heading carries its DID's path.
const HEADING = /You can now vet people for ([^"<]+)/g;
export const plainDoorIsFor = (page, { did, names = [] }) => {
  const want = [did.split(":").pop(), ...names].filter(Boolean);
  return [...String(page).matchAll(HEADING)].some((m) => want.some((w) => m[1].includes(w)));
};

export const vetterDoors = (desks, community, page = "") => {
  const seen = [...new Set(desks)];
  if (!community) return [...PLAIN.slice(0, 1), ...seen, ...PLAIN.slice(1)];
  // Not filtered by what the page shows: Android's page source stops at the fold, and the caller scrolls to each door.
  const mine = communityCardKeys(community.did).map((k) => `AgentOpenDesk_${k}`);
  return !seen.length && plainDoorIsFor(page, community) ? [...mine, ...PLAIN] : mine;
};
