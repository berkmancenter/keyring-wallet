export interface CredentialSummary {
  types: string[]
  issuer?: string
  subjectIds: string[]
}

export function buildCredentialSummaryFromCredential(credential: Record<string, unknown>): CredentialSummary {
  const typesValue = credential.type
  const types =
    Array.isArray(typesValue) && typesValue.every((value) => typeof value === 'string')
      ? (typesValue as string[])
      : typeof typesValue === 'string'
        ? [typesValue]
        : []

  let issuer: string | undefined
  const issuerValue = credential.issuer
  if (typeof issuerValue === 'string') {
    issuer = issuerValue
  } else if (issuerValue && typeof issuerValue === 'object' && 'id' in issuerValue && typeof issuerValue.id === 'string') {
    issuer = issuerValue.id
  }

  const subjectIds: string[] = []
  const collectSubjectIds = (subject: unknown) => {
    if (subject && typeof subject === 'object' && 'id' in subject && typeof subject.id === 'string') {
      subjectIds.push(subject.id)
    }
  }

  const subjectValue = credential.credentialSubject
  if (Array.isArray(subjectValue)) {
    subjectValue.forEach(collectSubjectIds)
  } else {
    collectSubjectIds(subjectValue)
  }

  return {
    types,
    issuer,
    subjectIds,
  }
}

