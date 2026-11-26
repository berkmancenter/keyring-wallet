/**
 * The log lines of the path that names a community, one per event, so a problem report can say why a community
 * read as "(no name published yet)": its name was not saved on this phone, or its public profile was read and gave
 * none, or the read did not get that far. Before these lines the whole path was silent: a tester's chips all read
 * as unnamed and nothing in the report said which of the three it was (IN-814).
 *
 * A community is named by a short form of its DID, never the whole of it, and never by a name: a line says whether
 * a name was found, not what it is.
 *
 * @module trust-tasks/module/communityNamesLog
 */

/** Why a read of a community's public profile gave no name. Words for a log line, not for a person. */
export type ProfileNameMiss =
  | 'its DID document was not resolved'
  | 'its DID document names no VTCRest service'
  | 'the request failed'
  | `HTTP ${number}`
  | 'the answer is not JSON'
  | "the profile is another community's"
  | 'the profile has no name'

/** A community in a log line: enough to tell it apart, never the whole DID (as the screens' `shortDid`). */
export const communityLogRef = (did: string): string =>
  did.length <= 28 ? did : `${did.slice(0, 16)}…${did.slice(-8)}`

const TAG = '[Community:names]'

/** The names saved on this phone were put where the screens read them. */
export const namesLoadedLine = (count: number): string => `${TAG} saved on this phone: ${count}, loaded`

/** The saved names could not be read. */
export const namesNotLoadedLine = (kind: string): string => `${TAG} saved on this phone: not read (${kind})`

/** A screen is showing communities, and some have no name on this phone. */
export const namesShownLine = (screen: string, shown: readonly string[], unnamed: readonly string[]): string =>
  unnamed.length === 0
    ? `${TAG} ${screen}: ${shown.length} shown, each with a name`
    : `${TAG} ${screen}: ${shown.length} shown, ${unnamed.length} with no name on this phone (${unnamed
        .map(communityLogRef)
        .join(', ')})`

/** A read of a community's public profile ended: with a name, or without and why. */
export const nameReadLine = (communityDid: string, missed: ProfileNameMiss | undefined, ms: number): string =>
  missed
    ? `${TAG} ${communityLogRef(communityDid)}: no name from its public profile, ${missed} (${ms} ms)`
    : `${TAG} ${communityLogRef(communityDid)}: named by its public profile (${ms} ms)`
