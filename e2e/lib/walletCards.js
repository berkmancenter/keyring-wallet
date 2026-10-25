/**
 * A community's cards in the Wallet, on either side of the pass redesign (bifold #524). A build with passes names
 * each card by the pass's title (CommunityPassTitle: the community's name) and says the whole face in the pass's
 * description; an older build names it by the card it replaced (CredentialName, "Member of <community>", under
 * CredentialIssuer). Both are matched, so a flow runs against either build. Android (UiAutomator).
 */

/** The ids that name a community card in the Wallet, old and new. */
export const CARD_NAME_IDS = "(CommunityPassTitle|CredentialName)";

/** A UiAutomator selector for a Wallet card naming `name`. */
export function walletCardSelector(name) {
  return `android=new UiSelector().resourceIdMatches("com\\.ariesbifold:id/${CARD_NAME_IDS}").textContains(${JSON.stringify(name)})`;
}

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescape(m[1]) : undefined;
};

/**
 * The distinct cards from `issuer` on one page source: an older build's "issuer|card name" pairs, and a pass build's
 * pass descriptions ("<community>, <kind>, <date>…", one per card) that name the issuer.
 */
export function walletCardKeys(src, issuer) {
  const keys = new Set();
  const tags = src.match(/<[^>]+>/g) ?? [];
  const named = tags
    .map((tag) => ({ id: attr(tag, "resource-id"), text: attr(tag, "text"), desc: attr(tag, "content-desc") }))
    .filter((n) => n.id?.startsWith("com.ariesbifold:id/"));
  for (let i = 0; i < named.length; i++) {
    const { id, text, desc } = named[i];
    if (id === "com.ariesbifold:id/CommunityPass" && desc?.includes(issuer)) keys.add(`pass|${desc}`);
    const next = named[i + 1];
    if (id === "com.ariesbifold:id/CredentialIssuer" && next?.id === "com.ariesbifold:id/CredentialName" && text?.includes(issuer))
      keys.add(`card|${text}|${next.text}`);
  }
  return [...keys];
}
