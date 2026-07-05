import { buildRCardTemplate, validateRCardForm, extractFormInputFromJCard } from '../../src/modules/vrc/types/rcard'

describe('R-card template helpers', () => {
  test('validateRCardForm returns errors for missing required fields', () => {
    const result = validateRCardForm({
      firstName: '',
      lastName: '',
      email: 'invalid-email',
      organization: '',
    })

    expect(result.isValid).toBeFalsy()
    expect(result.errors.firstName).toEqual('RCardOnboarding.Errors.FirstNameRequired')
    expect(result.errors.lastName).toEqual('RCardOnboarding.Errors.LastNameRequired')
    expect(result.errors.email).toEqual('RCardOnboarding.Errors.EmailInvalid')
    // organization is optional, so no error expected
    expect(result.errors.organization).toBeUndefined()
  })

  test('buildRCardTemplate creates template with jCard format', () => {
    const template = buildRCardTemplate(
      {
        firstName: ' Alice ',
        lastName: ' Example ',
        email: 'USER@Example.org',
        organization: 'Example Org',
      },
      { issuer: 'did:web:issuer.example' }
    )

    expect(template['@context']).toContain('https://www.w3.org/2018/credentials/v1')
    expect(template.type).toEqual(expect.arrayContaining(['VerifiableCredential', 'RCardTemplate']))
    expect(template.issuer).toEqual('did:web:issuer.example')
    expect(template.templateId).toBeDefined()
    expect(template.label).toBeDefined()
    expect(template.jcard).toBeDefined()
    expect(template.jcard[0]).toBe('vcard')
    expect(Array.isArray(template.jcard[1])).toBe(true)

    // Verify jCard contains the normalized data
    const formInput = extractFormInputFromJCard(template.jcard)
    expect(formInput.email).toEqual('user@example.org')
    expect(formInput.firstName).toEqual('Alice')
    expect(formInput.lastName).toEqual('Example')
    expect(template.id).toBeDefined()
    expect(template.id).toMatch(/^urn:uuid:/)
  })
})
