/**
 * The layers of a relationship, newest first: each set of cards the contact
 * issued to this phone (with whether it carries hardware evidence, to be
 * verified before it is said), and each witness record, in person when the
 * witness confirmed it. Only what the records show: a card is "exchanged",
 * never "remotely", since a first exchange may well have been in person.
 */
import { relationshipLayers } from '../../../src/modules/vrc/utils/relationshipLayers'

const PEER = 'did:peer:0zPeerRel'
const vrc = (issuer: string, validFrom: string, evidence = false) =>
  ({
    encoded: {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer,
      validFrom,
      credentialSubject: { id: 'did:peer:0zMyRel' },
      ...(evidence ? { evidence: [{ type: ['HardwareKeyAttestation'] }] } : {}),
    },
  }) as never

describe('the layers of a relationship', () => {
  test('cards from this contact and witness records, newest first', () => {
    const layers = relationshipLayers(
      [
        vrc(PEER, '2026-10-01T00:00:00Z'),
        vrc(PEER, '2026-10-20T00:00:00Z', true),
        vrc('did:peer:0zOther', '2026-10-21T00:00:00Z'),
      ],
      PEER,
      [
        {
          witnessDid: 'did:web:w',
          witnessName: 'Lab witness',
          issuanceDate: '2026-10-21T00:00:00Z',
          credentialId: 'v1',
          locality: { outcome: 'confirmed' },
        } as never,
        { witnessDid: 'did:web:w', issuanceDate: '2026-10-05T00:00:00Z', credentialId: 'v2' } as never,
      ]
    )
    expect(layers.map((l) => [l.kind, l.at])).toEqual([
      ['witnessed', '2026-10-21T00:00:00Z'],
      ['card', '2026-10-20T00:00:00Z'],
      ['witnessed', '2026-10-05T00:00:00Z'],
      ['card', '2026-10-01T00:00:00Z'],
    ])
    expect(layers[0]).toEqual(expect.objectContaining({ witnessName: 'Lab witness', inPerson: true }))
    expect(layers[1]).toEqual(expect.objectContaining({ hardwareEvidence: true }))
    expect(layers[2]).toEqual(expect.objectContaining({ inPerson: false }))
    expect(layers[3]).toEqual(expect.objectContaining({ hardwareEvidence: false }))
  })

  test('nothing for a contact with no cards and no witness records', () => {
    expect(relationshipLayers([vrc('did:peer:0zOther', '2026-10-21T00:00:00Z')], PEER, [])).toEqual([])
  })
})
