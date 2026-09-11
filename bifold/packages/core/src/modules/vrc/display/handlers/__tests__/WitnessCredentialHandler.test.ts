/**
 * WitnessCredentialHandler — the locality field's three visibly different
 * states (locality-plan.md §7.1 rule 5, §10.3 item 11). Never a boolean.
 */
import { witnessCredentialHandler } from '../WitnessCredentialHandler'
import { W3cCredentialJson } from '../../types'

function vwc(witnessContext: Record<string, unknown>): W3cCredentialJson {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
    issuer: { id: 'did:example:witness', name: 'Test Witness' },
    validFrom: '2026-08-21T00:00:00Z',
    credentialSubject: { id: 'did:example:subject', witnessContext },
  }
}

function localityField(credential: W3cCredentialJson) {
  return witnessCredentialHandler.extractFields(credential).find((f) => (f as { name?: string }).name === 'locality') as
    | { value: string }
    | undefined
}

describe('WitnessCredentialHandler locality field', () => {
  it('renders confirmed when localityConfirmed is true', () => {
    const field = localityField(vwc({ localityConfirmed: true, localityMethod: 'ble-challenge-response/0.1' }))
    expect(field?.value).toBe('Witness.VWC.LocalityConfirmed')
  })

  it('renders a declined-by-holder reason distinctly from an interrupted one', () => {
    const declined = localityField(vwc({ localityConfirmed: false, localityMethod: 'none', localityReason: 'declinedByHolder' }))
    const interrupted = localityField(vwc({ localityConfirmed: false, localityMethod: 'none', localityReason: 'windowLost' }))
    expect(declined?.value).toBe('Witness.VWC.LocalityDeclined')
    expect(interrupted?.value).toBe('Witness.VWC.LocalityInterrupted')
    expect(declined?.value).not.toBe(interrupted?.value)
  })

  it('renders nothing at all when the witness does not offer locality — never a false-shaped field', () => {
    const field = localityField(vwc({ event: 'EthDenver 2024', method: 'ble' }))
    expect(field).toBeUndefined()
  })

  it('the three states are pairwise distinct, including absence', () => {
    const values = [
      localityField(vwc({ localityConfirmed: true, localityMethod: 'ble-challenge-response/0.1' }))?.value,
      localityField(vwc({ localityConfirmed: false, localityMethod: 'none', localityReason: 'windowLost' }))?.value,
      localityField(vwc({ event: 'no locality here' }))?.value, // undefined — no field at all
    ]
    expect(new Set(values).size).toBe(3)
  })

  it('falls back to the legacy nested shape only when no flat locality* members exist', () => {
    const field = localityField(vwc({ localityVerification: { confirmed: true } }))
    expect(field?.value).toBe('Witness.VWC.LocalityConfirmed')
  })
})
