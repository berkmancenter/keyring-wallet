import { communityCardKeys } from "./testIdKeys.js";

// Which desk door to try, in order. A vetter of several communities has one door per community (AgentOpenDesk_<key>) and no
// plain AgentOpenDesk, so the first door on the page is whichever community is listed first: a seat or a ceremony for the second
// one opened the first one's desk (1031-1751, hvk-vetter-enrolled 3 → 3, "You vet for Keyring Lab Community"). With a community
// named, its door comes first. A door for another community is never a stand-in for it.
export const vetterDoors = (desks, communityDid) => {
  const seen = [...new Set(desks)];
  if (!communityDid) return ["AgentOpenDesk", ...seen, "AgentVetOthers", "AgentContinueVetting"];
  // Not filtered by what the page shows: Android's page source stops at the fold, and the caller scrolls to each door.
  const mine = communityCardKeys(communityDid).map((k) => `AgentOpenDesk_${k}`);
  return seen.length ? mine : [...mine, "AgentOpenDesk", "AgentVetOthers", "AgentContinueVetting"];
};
