// Where a clone stands against its pin, by commit and not by spelling. setup-external.mjs compared
// `git rev-parse --short HEAD` string-equal to PINS.json's sha, so a pin naming the right commit with
// fewer characters than git abbreviates to (49f5f1be for 49f5f1beb, 439a0333 for 439a03335) never read
// as pinned: every run said "~ at X, pin is Y" and checked it out again, quietly (wallet #901, #902).
//
//   pinned    HEAD is the pin's commit, named as git abbreviates it or longer (a full sha can never go
//             ambiguous; check-keyring-card.sh takes any prefix of HEAD this long the same way)
//   misnamed  HEAD is the pin's commit, named shorter than git abbreviates it: an abbreviation that has
//             already outgrown the repo, said with what to write
//   rewind    HEAD is past the pin: checking it out would move the clone backwards (setup run from a tree
//             whose PINS.json is older than the clone, as a stale checkout's is), so it isn't, unasked
//   off       HEAD is another commit, or the pin's name resolves to none here

/**
 * @param {{ head: string, headCommit: string, pinSha: string, pinCommit?: string, pinBehindHead?: boolean }} at
 *   head: `git rev-parse --short HEAD`; headCommit: `git rev-parse HEAD`; pinSha: PINS.json's value;
 *   pinCommit: `git rev-parse --verify <pinSha>^{commit}`, if it resolved; pinBehindHead: the pin's commit
 *   is an ancestor of HEAD (`git merge-base --is-ancestor`)
 */
export function pinState({ head, headCommit, pinSha, pinCommit, pinBehindHead = false }) {
  if (pinCommit && pinCommit === headCommit)
    return headCommit.startsWith(pinSha) && pinSha.length >= head.length ? 'pinned' : 'misnamed';
  if (pinCommit && pinBehindHead) return 'rewind';
  return 'off';
}
