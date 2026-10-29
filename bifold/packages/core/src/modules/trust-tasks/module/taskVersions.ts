/**
 * Speaking a task's newer version ahead of time, the way join does (`joinWire`):
 * ask in the newest version this wallet speaks, and step down only when the
 * agent says it does not serve that version.
 *
 * An agent answers a version it does not serve with a refusal coded
 * `unsupportedVersion` (some version of the family is served) or
 * `unsupportedType` (none is), carrying `details.servedVersions` as full type
 * URIs (vta-service `trust_tasks/helpers.rs` `method_not_found`, at
 * vta-service-v0.52.0). Any other refusal is the agent's answer to the request
 * itself and is never retried in another version: a task that was refused for
 * what it asked must not be asked again in a different version.
 *
 * `servedVersions` is a hint, not the whole truth. vta-service builds it from
 * its dispatch table alone, but v0.60.0 to v0.66.0 also answer older versions
 * the table doesn't list, rewriting them at the edge (`wire_v0_2`): device/*
 * at 0.2 and vault/* at 0.2 and 0.3. A refusal of device/list/0.3 there names
 * only 0.1, while 0.2 is answered. So the step down walks this wallet's own
 * list, older one by one, and the named versions only move it up (an agent
 * upgraded since it was last asked).
 *
 * What an agent was found to serve is remembered per family for the life of
 * the client, so the step down is paid once, not on every call.
 *
 * @module trust-tasks/module/taskVersions
 */
import { VtiRefusal } from './vtiAgent'

/** Is this refusal an agent saying it does not serve the version asked? */
export const isUnsupportedVersionRefusal = (refusal: unknown): refusal is VtiRefusal =>
  refusal instanceof VtiRefusal && ['unsupportedVersion', 'unsupportedType'].includes(refusal.code)

/** The type URIs a version refusal says the agent serves (empty when it names none). */
export const servedVersionsOf = (refusal: VtiRefusal): string[] => {
  const served = (refusal.details as { servedVersions?: unknown } | undefined)?.servedVersions
  return Array.isArray(served) ? served.filter((uri): uri is string => typeof uri === 'string') : []
}

/**
 * Which version to try after `tried` was refused: a newer one of `uris` (newest
 * first) that the refusal names, else the next older one not yet tried, named
 * or not. Undefined when none is left.
 */
export function versionAfterRefusal(
  uris: readonly string[],
  tried: string,
  refusal: VtiRefusal,
  alreadyTried: ReadonlySet<string> = new Set([tried])
): string | undefined {
  const served = servedVersionsOf(refusal)
  const at = uris.indexOf(tried)
  // An agent upgraded since it was last asked may now serve only a newer one, and says so.
  const newer = uris.slice(0, at).find((uri) => served.includes(uri) && !alreadyTried.has(uri))
  if (newer) return newer
  // Never skipped for being unnamed: the agent may answer it at its edge (see the module comment).
  return uris.slice(at + 1).find((uri) => !alreadyTried.has(uri))
}

/** A report (a log line) never decides a call: one that throws is dropped, the answer or step-down kept. */
const report = (fn: () => void) => {
  try {
    fn()
  } catch {
    // Reporting only.
  }
}

export class TaskVersions {
  /** Family → the URI this agent was found to serve. */
  private readonly served = new Map<string, string>()

  constructor(
    private readonly onStepDown?: (family: string, from: string, to: string) => void,
    /** Told the version a family was answered in, once when it is learned and again whenever it changes. */
    private readonly onServed?: (family: string, uri: string) => void
  ) {}

  /** The URI to ask first: the one this agent served before, else the newest. */
  first(family: string, uris: readonly string[]): string {
    const known = this.served.get(family)
    return known && uris.includes(known) ? known : uris[0]
  }

  /**
   * Send in the newest version the agent serves. `send` is called with a type
   * URI and builds that version's payload itself. Answers the URI that was
   * answered, beside the answer.
   */
  async ask<T>(
    family: string,
    uris: readonly string[],
    send: (uri: string) => Promise<T>
  ): Promise<{ uri: string; answer: T }> {
    let uri: string = this.first(family, uris)
    const tried = new Set<string>()
    for (;;) {
      tried.add(uri)
      try {
        const answer = await send(uri)
        if (this.served.get(family) !== uri) report(() => this.onServed?.(family, uri))
        this.served.set(family, uri)
        return { uri, answer }
      } catch (error) {
        if (!isUnsupportedVersionRefusal(error)) throw error
        this.served.delete(family)
        const next = versionAfterRefusal(uris, uri, error, tried)
        if (!next) throw error
        report(() => this.onStepDown?.(family, uri, next))
        uri = next
      }
    }
  }

  /** Forget what an agent served (a new agent, or a relink). */
  reset(): void {
    this.served.clear()
  }
}

const versionsByObject = new WeakMap<object, TaskVersions>()
const versionsByKey = new Map<string, TaskVersions>()

/**
 * The version memory of one agent, for callers that hold only a task port.
 * Keyed by a stable string when there is one (this phone's DID on that agent:
 * ports are often made afresh per call), else by the port object itself.
 */
export function versionsFor(owner: object | string): TaskVersions {
  if (typeof owner === 'string') {
    let versions = versionsByKey.get(owner)
    if (!versions) versionsByKey.set(owner, (versions = new TaskVersions()))
    return versions
  }
  let versions = versionsByObject.get(owner)
  if (!versions) versionsByObject.set(owner, (versions = new TaskVersions()))
  return versions
}

/** Forget every agent's versions (unlink; and between tests). */
export function forgetAllVersions(): void {
  versionsByKey.clear()
}
