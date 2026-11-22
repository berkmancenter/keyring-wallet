/**
 * When this run of the app began, as near as the JS can tell: the moment the framework's entry module is evaluated
 * (index.ts imports this first, for its effect, so Metro's inline requires never defer it). The log's own
 * `Running "KeyRing"` line comes within milliseconds of it. A line that says how long after launch something came
 * counts from here (useRoomRows' first rows, 11-17), so a cold start's sign-ins and session waits are in the number.
 *
 * @module utils/runStart
 */
export const RUN_STARTED_AT = Date.now()
