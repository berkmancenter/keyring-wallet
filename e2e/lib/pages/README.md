# Page objects (`e2e/lib/pages/`)

One screen each, one function per step, the model of [`lib/keyringRoles.js`](../../KEYRING_ROLES.md): a step
asserts the screen it ends on, returns a record (also one JSON line in `E2E_STEP_LOG`), fails by name with a
`StepError` that carries a screenshot and the page source, and never waits without a deadline. On the deadline
the message is where the screen is and for how long, "stuck at `JoinMakeIdentity` for 120 s", not "timeout".

| Module | Screen | Steps | Readers (no step) |
|---|---|---|---|
| `agents.js` | Your agent, its chips and switcher, an added agent's link (scan, address path, manual), the Keep card, Agent settings' unlink, the community cards on the home | `agents.open`, `openSwitcher`, `add`, `linkTo`, `enterAddress`, `connect`, `switchToExisting`, `keepFirst`, `switchTo`, `unlinkOther`, `unlinkLast`, `openCommunityCard` | `readHomeName`, `readSwitcherRows`, `splitRows`, `readCommunityCard`, `readOwnerCode`, `readScanKey`, `awaitSwitched`, `answerOwnerCheck` |
| `join.js` | Join (its ways in, the ask, the waiting and lost-request screens, a member's Done) and the community's own screen | `join.openCommunity`, `ask`, `startWay`, `awaitSent`, `awaitLost`, `sendAgain`, `done`, `scanOtherCommunity`; `community.chooseHowToJoin`, `readHolding`, `useHolderAgent` | `readStanding`, `readEntry`, `readWays`, `readMemberState`, `communityLink` |
| `step.js` | the shared machinery | `runStep`, `awaitScreen`, `whichShowing`, `failWith` | `idsWithPrefix`, `rowText`, `said`, `shot`, `elog` |

Every step is `(d, args, opts)`. `opts.clock` (`{ now, wait }`) is what the step waits by, so a unit test runs the
deadlines without the time; `opts.log` is the shared step log; `opts.say` the driver's `[e2e] …` logger.
`args.owner` is the caller's answer to Android's device-credential prompt, `async (tag) => boolean`
(`answerOwnerCheck`); `args.grant(tempDid, slug)` is how the caller puts a phone's key on an agent.

The steps do what the drivers did before them, flow for flow and log line for log line (`run-several-agents.mjs`,
`run-join-waiting.mjs`, `run-join-lost.mjs`, 239 gate). A driver's rows are `lib/rows.js` rows: a failing row
never stops the rest, and a row that `needs` an earlier one skips instead of failing after it.

## Tests

`node --test e2e/lib/pages/*.test.mjs` (also `npm run test:lib` in `e2e/`). `testing/fakeDriver.mjs` is a
WebdriverIO stand-in: a screen scripted as testID → words, answered through the same selectors `lib/driver.js`
builds, taps that run `d.onTap[id]`, and a clock that moves only when a step waits. `lib/driver.js` sleeps for
real after each swipe, so a test fakes `setTimeout` and lets the fake driver's swipes tick it.

The tests prove the steps' logic over a scripted screen, not the app: a new or changed step still runs against
the shipped build first (`gate.sh dry --golden`, `e2e/gate/README.md`).

Every testID a page object names is checked by `node e2e/scripts/check-testids.mjs` against the app's manifest,
like a driver's.
