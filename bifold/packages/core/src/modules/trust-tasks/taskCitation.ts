/**
 * Where a credential cites the task that produced it — `taskContext` (the
 * initiating document's `id`) and `taskDigestMultibase` (its task digest).
 *
 * DTG Credentials v1 (VTI 0.47.0 / #1859; the witnessed/1 VWC of tf
 * witness/session/submit as recast by #691) puts both at the credential's top
 * level. Keyring's witness credentials before it carry them in
 * `credentialSubject`. Both are read: top level first, then the subject.
 */
export interface TaskCitation {
  taskContext?: string
  taskDigestMultibase?: string
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** The task citation of `credential`, in either place; members absent when it names none. */
export function taskCitationOf(credential: Record<string, unknown> | undefined): TaskCitation {
  if (!credential) return {}
  const subjects = credential.credentialSubject
  const subject = (Array.isArray(subjects) ? subjects[0] : subjects) as Record<string, unknown> | undefined
  return {
    taskContext: str(credential.taskContext) ?? str(subject?.taskContext),
    taskDigestMultibase: str(credential.taskDigestMultibase) ?? str(subject?.taskDigestMultibase),
  }
}
