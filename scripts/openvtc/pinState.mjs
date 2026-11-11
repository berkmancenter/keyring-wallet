// Where a clone stands against its pin, by commit and not by spelling. setup-external.mjs compared
// `git rev-parse --short HEAD` string-equal to PINS.json's sha, so a pin naming the right commit with
// fewer characters than git abbreviates to (49f5f1be for 49f5f1beb, 439a0333 for 439a03335) never read
// as pinned: every run said "~ at X, pin is Y" and checked it out again, quietly (wallet #901, #902).
//
//   pinned    HEAD is the pin's commit, and PINS.json names it as git abbreviates it
//   misnamed  HEAD is the pin's commit, but PINS.json spells it otherwise: said, with what to write
//   off       HEAD is another commit, or the pin's name resolves to none here

/**
 * @param {{ head: string, headCommit: string, pinSha: string, pinCommit?: string }} at
 *   head: `git rev-parse --short HEAD`; headCommit: `git rev-parse HEAD`;
 *   pinSha: PINS.json's value; pinCommit: `git rev-parse --verify <pinSha>^{commit}`, if it resolved
 */
export function pinState({ head, headCommit, pinSha, pinCommit }) {
  if (!pinCommit || pinCommit !== headCommit) return 'off';
  return head === pinSha ? 'pinned' : 'misnamed';
}
