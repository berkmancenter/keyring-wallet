# Member badges in Keyring

**Status:** building. The community section, member cards and the Wallet are built in parallel and ship together, ON, with a release kill. That is Alberto's decision, 2026-11-17, relayed by the coordinator.

**Reasoning:** [member-badges-plan/2026-11-17-al.md](member-badges-plan/2026-11-17-al.md).

**Research:** `docs/spikes/20261117-member-badges-research.local-al.md` (private).

## Goal

A member sees the badges their community gave them, accepts or declines the ones they are offered, and sees the badges of the people they meet in that community. The surfaces are the community screen, a member's card, the Wallet and room posts.

Keyring is the holder only. Administrators and badge owners create, offer and take back badges in the community's own console (VTC admin UI). None of that moves into the app.

## Background

Upstream added member badges to the VTC (the community's service) in `vtc-service` v0.27.0. Every later tag serves the same 30 Trust Tasks, `https://trusttasks.org/spec/vtc/badges/<task>/0.1`, all marked draft.

There are two kinds:

- **Community badge:**
  - It is defined by an administrator and given by its owners.
  - When the member accepts it, the community issues a W3C VC 2.0 + Open Badges 3.0 `OpenBadgeCredential`, with the **community's DID as issuer** and the member's membership DID as subject.
  - The credential reaches the member's agent on the ordinary `credential-exchange/issue/0.1` delivery.
- **Kudos badge:** a picture and a count that one member gives another. It is never a credential.

The member's agent (VTA) needs nothing new. Badges are switched off in each community until an administrator turns them on (`settings/update`, with step-up).

## What we build

These four parts are built at the same time, by different lanes, against the interfaces in [Interfaces](#interfaces).

1. **Badges client (`bifold/packages/core/src/modules/badges/`).** It mirrors `modules/polls`:
   - `wire.ts`: task URIs and parsers for the holder tasks `list`, `show`, `images/get`, `mine/list`, `mine/accept`, `mine/decline`, `wall/show` and `kudos/list`.
   - `badgeService.ts`: the service.
   - `agentBadgesBackend.ts`: the tasks go to the community as the member's identity, over the same session path as directory and polls.
   - `useBadges.ts`: the hooks.
   - `badgesSwitch.ts`: the kill.
   - A community that does not serve badges, or has them off, answers `unsupportedType` or the equivalent refusal. Keyring shows nothing for it, as polls do.
   - **Done when:**
     - every parser accepts each of TT's `payload.examples.json` and refuses each `payload.invalid-examples.json`, for the eight tasks;
     - a row shows `mine` turning a refusal into `'notServed'`;
     - the kill rows pass: `remoteOff` and anything that isn't a plain `on` both read as off, and no task is sent;
     - one mutant per guard is killed.
2. **Screens.**
   - "Badges" on the community screen (`VtiCommunity`), beside Polls and Rooms:
     - the offers waiting, each with Accept and Decline;
     - then the member's own badges;
     - then their received kudos.
   - A badge detail screen.
   - A badges row on another member's card (`CommunityMemberCard`), from `wall/show`.
   - **Done when:**
     - render rows cover offers + held + kudos, an empty community, a `'notServed'` community (no section at all), and a `'hidden'` wall (no row);
     - Accept and Decline each call the service once and refresh;
     - the testids are added and resynced.
3. **Wallet.**
   - The inbox recognises an `OpenBadgeCredential` from a community the phone belongs to, keeps it, and shows it in the Wallet as a badge card. The card is visibly distinct from membership and role cards, and from the state card.
   - The OB 3.0.3 JSON-LD context is bundled in `@bifold/vrc-contexts`, so storing a badge makes no network fetch.
   - **Done when:**
     - a fixture `OpenBadgeCredential` built to upstream's shape (`vtc-service/src/badges/credential.rs:155-202`) is classified, kept and shown;
     - a credential from a community the phone isn't in is refused (`credentialRefusal`);
     - a re-issue replaces the earlier copy and never adds a second card;
     - the document loader serves the OB context offline, with a row that fails if it fetches.
4. **Room posts: not in this release.** A post's author line shows no badge.
   - A phone cannot map a post's author DID to the directory entry `wall/show` takes. Directory `query/0.1` answers only `{subject, fields}`, and `entries/show` by DID is administrator-only, because "a lookup by DID is exactly the membership oracle the directory is designed not to be" (trust-tasks-tf `vtc/directory/entries/show` 0.1, consumer rules).
   - A chip would need the post to carry its author's entry, with a check that the entry's projected DID is the author's. That is a rooms post-format change, and the check works only for members who show their DID.
   - Searching the member list for the author is ruled out by upstream's rule above and by our own rule (no member lists).

Not built: sharing a badge outside the community (`awards/share`), giving kudos, making badges, claim codes, arranging, hiding or pinning a wall. Those are portal actions, or later work.

## Rules

- **The holder's side only.** The app sends only holder tasks, signed as the member's identity. It never sends an owner or administrator task.
- **Nothing leaves the community.** The app never calls `awards/share`, and never shows a badge outside the community that gave it, except in the holder's own Wallet. A badge credential names the member's identity in that community, and showing it elsewhere would link that identity to new people.
- **Badges never reflect vetting.**
  - No badge is shown on the vetting desk or any vetting screen.
  - A badge whose name, criteria or rule mentions vetting is shown as an ordinary badge and never as a check or a verification.
  - Hidden-vetting outcomes are never displayed as, or derived into, a badge (zero-knowledge plan, `plan/zero-knowledge`, :196, :366).
- **No member lists.** Bubble lookups are made per author on screen. The app never builds a list of a community's members from badge or holder answers, as for directory names (`modules/directory/names.ts`).
- **Notes stay private.** The note a giver attached travels in the credential's evidence. The holder sees it on their own badge and nowhere else.
- **Visibility is the community's.** A member's card shows only what `wall/show` returns for this viewer, and the app never works around a refusal.
- **Words.** A badge is a badge. It is never called verified, checked or proven. The community's name is said as the giver.

## Interfaces

These are fixed first, so the lanes do not collide in one module. `modules/badges/types.ts` is the contract, and it lands first.

```ts
// modules/badges/types.ts — owned by the client lane
export interface BadgeSummary {
  badgeId: string;
  communityDid: string;
  kind: "community" | "kudos";
  name: string;
  description?: string;
  image?: { sha256: string; mediaType: string }; // fetched with images/get, never by URL
}
export interface HeldBadge extends BadgeSummary {
  awardIds: string[];
  earnedAt: string[];
  hidden: boolean;
  count?: number;
}
export interface BadgeOffer extends BadgeSummary {
  awardId: string;
  offeredAt: string;
  expiresAt?: string;
  note?: string;
  givenBy?: string;
}
export interface MyBadges {
  held: HeldBadge[];
  offers: BadgeOffer[];
  kudosTotal?: number;
}
export interface WallBadge extends BadgeSummary {
  earnedAt?: string;
  count?: number;
  pinned?: boolean;
}

export interface BadgeService {
  mine(communityDid: string): Promise<MyBadges | "notServed">;
  accept(communityDid: string, awardId: string): Promise<void>;
  decline(communityDid: string, awardId: string): Promise<void>;
  wall(
    communityDid: string,
    entryId: string,
  ): Promise<WallBadge[] | "notServed" | "hidden">;
  show(communityDid: string, badgeId: string): Promise<BadgeSummary>;
  image(
    communityDid: string,
    badgeId: string,
    sha256: string,
  ): Promise<string /* data URI, cached */>;
}
// hooks the screens use
export declare function useMyBadges(communityDid: string): {
  badges?: MyBadges;
  served: boolean;
  refresh(): void;
};
export declare function useMemberWall(
  communityDid: string,
  entryId: string,
): { wall?: WallBadge[]; state: "loading" | "shown" | "hidden" | "notServed" };
export declare function useAuthorBadges(): (
  communityDid: string,
  authorDid: string,
) => WallBadge[] | undefined; // bubbles: per author on screen
```

```ts
// trust-tasks/module/badgeCredentials.ts — owned by the credential lane
export function isBadgeCredential(vc: Record<string, unknown>): boolean;
export interface BadgeCardView {
  name: string;
  description?: string;
  communityDid: string;
  communityName?: string;
  imageDataUri?: string;
  issuedAt?: string;
  validUntil?: string;
  evidence: { note?: string; acceptedAt?: string }[];
}
export function badgeCardView(vc: Record<string, unknown>): BadgeCardView;
```

- **Images.** These come only through `images/get`, never from the Achievement's public URL, so a Wallet card never contacts anything but the member's own community.

## The kill

`badgesSwitch.ts` is `{ on: true, remoteOff: false }`, in the same pattern as `sessionsPerIdentitySwitch.ts`:

- it fails closed;
- nothing is saved on the phone;
- it is read at every use.

**What the kill turns off:** `remoteOff: true`, shipped by OTA, hides every badge surface and stops every badge task at the next start.

**What it leaves:** a badge credential already kept stays in the Wallet as an ordinary credential.

## Release

- **Tier:** per piece, with `scripts/release/tier.mjs`. Expected readings:
  - the client and the screens are **ota**;
  - the inbox and Wallet-card part is **ota-strict** (`trust-tasks/module/vti*`);
  - the bundled context is **ota**.
  - Any added storage delete must carry a `tier-exempt` reason, or the change becomes **store**.
- **Publish:** Alberto's own word.
- **Proof:**
  - targeted jest per piece, run through `tools/jest72dw.sh` one at a time;
  - the parsers checked against TT's own schema examples (`dtgwg-trust-tasks-tf`, `specs/vtc/badges/**/payload.*examples.json`);
  - one lab community with badges switched on and one test badge offered. Switching them on and making the offer are Alberto's admin gestures.
