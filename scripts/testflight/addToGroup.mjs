// Adds a build to one TestFlight beta group, waiting while App Store Connect answers 404.
//
// App Store Connect can report a build VALID and then answer 404 for that same build id here
// for a while (build 282 did, with no other change). The groups are resolved by name before
// this, so a 404 here means "the build is not visible yet", never "no such group".
// The wait depends on `api` putting the HTTP status on the error it throws (distribute.mjs does);
// an error without one is thrown at once.

export const ADD_TRIES = 10
export const ADD_WAIT_MS = 30_000

/**
 * @param {(method: string, path: string, body?: unknown) => Promise<unknown>} api
 * @param {{ groupId: string, groupName: string, buildId: string,
 *           tries?: number, waitMs?: number, sleep: (ms: number) => Promise<void>, log?: (line: string) => void }} opts
 */
export const addToGroup = async (api, { groupId, groupName, buildId, tries = ADD_TRIES, waitMs = ADD_WAIT_MS, sleep, log = console.log }) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api('POST', `/v1/betaGroups/${groupId}/relationships/builds`, {
        data: [{ type: 'builds', id: buildId }],
      })
    } catch (error) {
      if (error?.status !== 404 || attempt >= tries) throw error
      log(`"${groupName}" does not see the build yet (attempt ${attempt}); trying again in ${waitMs / 1000} s`)
      await sleep(waitMs)
    }
  }
}
