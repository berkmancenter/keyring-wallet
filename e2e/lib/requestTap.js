// Did a tap on "Use this link" send the request? A card that appears, or a card whose status moved. A refusal can also land
// inside the tap's settle time (under 4 s on 277, 1031-1405): the screen is back at "Ask a vetter" with the refused card
// below the fold, where Android's page source does not reach, so the card reads as absent and a retap would ask again
// (that run: four requests, four refusals). The ended line appearing says the request went. A dead tap changes none of
// these, and an ended line left by an earlier request does not count. A status that could not be read is null, no evidence
// either way: it never reads as a moved status.
export const requestTookEffect = ({ cardBefore, statusBefore, endedBefore }, { card, status, ended }) => {
  if (cardBefore) return status !== null && status !== statusBefore;
  return card || (ended && !endedBefore);
};
