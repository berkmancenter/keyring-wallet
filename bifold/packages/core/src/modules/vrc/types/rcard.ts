import uuid from 'react-native-uuid'

export type RCardFormInput = {
  firstName: string
  lastName: string
  email: string
  organization: string
}

export type RCardValidationErrors = Partial<Record<keyof RCardFormInput, string>>

/**
 * jCard property format: [propertyName, parameters, valueType, value]
 * Based on RFC 7095 (jCard) and RFC 6350 (vCard)
 */
export type JCardProperty = [string, Record<string, unknown>, string, string | string[]]

/**
 * jCard format: ["vcard", [properties...]]
 * Based on RFC 7095 Section 2
 */
export type JCard = ['vcard', JCardProperty[]]

/**
 * R-Card Template structure following the Relationship Card Credential draft spec
 * Inspired by: https://github.com/trustoverip/dtgwg-cred-tf/blob/1-provide-draft-vrc-rcard-and-witnessed-exchange-flow/rcard.md
 *
 * This is a template that will later be converted to a full VerifiableCredential
 * with relationshipCredential references and proofs during VRC exchange.
 */
export interface RCardTemplate {
  id: string
  '@context': string[]
  type: string[]
  templateId: string
  label: string
  jcard: JCard
  // Optional fields for future VRC integration
  issuer?: string
  issuanceDate?: string
}

export interface RCardCredentialBuilderOptions {
  issuer?: string
  issuanceDate?: string
  id?: string
  context?: string[]
  type?: string[]
  templateId?: string
  label?: string
}

const DEFAULT_CONTEXTS = ['https://www.w3.org/2018/credentials/v1', 'https://example.org/rcard/jcard/v1']
// W3cCredential requires "VerifiableCredential" in the type array
// We include both "VerifiableCredential" (required) and "RCardTemplate" (our specific type)
const DEFAULT_TYPES = ['VerifiableCredential', 'RCardTemplate']
const DEFAULT_TEMPLATE_ID = 'rcard-basic-1'
const DEFAULT_LABEL = 'Default business card'
const DEFAULT_ISSUER = 'urn:aries:bifold:r-card'
const EMAIL_REGEX =
  // eslint-disable-next-line no-control-regex
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/i

export const validateRCardForm = (input: RCardFormInput): { isValid: boolean; errors: RCardValidationErrors } => {
  const errors: RCardValidationErrors = {}

  if (!input.firstName.trim()) {
    errors.firstName = 'RCardOnboarding.Errors.FirstNameRequired'
  }

  if (!input.lastName.trim()) {
    errors.lastName = 'RCardOnboarding.Errors.LastNameRequired'
  }

  // Email is optional, but if provided, must be valid
  if (input.email.trim() && !EMAIL_REGEX.test(input.email.trim())) {
    errors.email = 'RCardOnboarding.Errors.EmailInvalid'
  }

  // Organization is optional - no validation needed

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * Builds a jCard array from form input
 * Follows RFC 7095 (jCard) and RFC 6350 (vCard) specifications
 */
export const buildJCardFromFormInput = (input: RCardFormInput): JCard => {
  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  const fullName = `${firstName} ${lastName}`.trim()
  const email = input.email.trim().toLowerCase()
  const organization = input.organization.trim()

  // jCard format: ["vcard", [properties...]]
  // Each property: [propertyName, parameters, valueType, value]
  // Based on RFC 7095 Section 2
  const properties: JCardProperty[] = [
    ['version', {}, 'text', '4.0'],
    ['fn', {}, 'text', fullName || `${firstName} ${lastName}`.trim()],
    ['n', {}, 'text', [lastName, firstName, '', '', '']], // [family, given, additional, honorific-prefix, honorific-suffix]
  ]

  // Only include email and organization if provided
  if (email) {
    properties.push(['email', { type: ['work'] }, 'text', email])
  }

  if (organization) {
    properties.push(['org', {}, 'text', organization])
  }

  return ['vcard', properties]
}

/**
 * Extracts form input from a jCard array
 * Used for backward compatibility and form population
 */
export const extractFormInputFromJCard = (jcard: JCard): Partial<RCardFormInput> => {
  if (!Array.isArray(jcard) || jcard[0] !== 'vcard' || !Array.isArray(jcard[1])) {
    return {}
  }

  const properties = jcard[1]
  const result: Partial<RCardFormInput> = {}

  for (const property of properties) {
    if (!Array.isArray(property) || property.length < 4) {
      continue
    }

    const [propName, , , value] = property

    switch (propName) {
      case 'fn':
        // Full name - try to split if no 'n' property exists
        if (typeof value === 'string' && !result.firstName && !result.lastName) {
          const parts = value.trim().split(/\s+/)
          if (parts.length >= 2) {
            result.firstName = parts[0]
            result.lastName = parts.slice(1).join(' ')
          } else if (parts.length === 1) {
            result.firstName = parts[0]
          }
        }
        break
      case 'n':
        // Structured name: [family, given, additional, honorific-prefix, honorific-suffix]
        if (Array.isArray(value) && value.length >= 2) {
          result.lastName = value[0] || ''
          result.firstName = value[1] || ''
        }
        break
      case 'email':
        if (typeof value === 'string') {
          result.email = value
        }
        break
      case 'org':
        if (typeof value === 'string') {
          result.organization = value
        }
        break
    }
  }

  return result
}

/**
 * Builds an R-Card Template with jCard format
 * Follows the Relationship Card Credential draft specification
 *
 * NOTE: W3cCredential requires "VerifiableCredential" in the type array.
 * This function ensures it's always included, even if custom types are provided.
 */
export const buildRCardTemplate = (input: RCardFormInput, options?: RCardCredentialBuilderOptions): RCardTemplate => {
  const randomId = (uuid.v4() as string) ?? ''
  const id = options?.id ?? `urn:uuid:${randomId}`
  const jcard = buildJCardFromFormInput(input)

  // Ensure "VerifiableCredential" is always in the type array (required by W3cCredential)
  const customTypes = options?.type ?? DEFAULT_TYPES
  const types = customTypes.includes('VerifiableCredential') ? customTypes : ['VerifiableCredential', ...customTypes]

  return {
    id,
    '@context': options?.context ?? DEFAULT_CONTEXTS,
    type: types,
    templateId: options?.templateId ?? DEFAULT_TEMPLATE_ID,
    label: options?.label ?? DEFAULT_LABEL,
    jcard,
    issuer: options?.issuer ?? DEFAULT_ISSUER,
    issuanceDate: options?.issuanceDate ?? new Date().toISOString(),
  }
}
