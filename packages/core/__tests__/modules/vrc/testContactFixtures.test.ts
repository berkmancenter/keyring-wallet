import { isPeerVrcCredential, isRCard } from '../../../src/modules/vrc/credentialTypes'
import {
  TEST_CONTACTS,
  createDTGCredential,
  createRCardCredential,
} from '../../../src/modules/vrc/fixtures/testContacts'
import { TEST_CONTACT_PHOTOS } from '../../../src/modules/vrc/fixtures/testContactPhotos'
import { RCARD_PHOTO_MAX_BASE64_BYTES, RCARD_PHOTO_MAX_DIMENSION } from '../../../src/modules/vrc/utils/rcardPhoto'
import { resolveContactDisplayInfo, toRawCredential } from '../../../src/modules/vrc/utils/rcardDisplayUtils'

const HOLDER_DID = 'did:peer:2.Ez6LSholder0000hol'

const allContacts = Object.values(TEST_CONTACTS)

describe('seeded test contact photos', () => {
  test('every preset contact carries one', () => {
    for (const contact of allContacts) {
      expect(contact.issuer.photo).toMatch(/^data:image\/jpeg;base64,/)
    }
  })

  test('each is distinct, so a list of seeded contacts does not read as one repeated face', () => {
    const photos = allContacts.map((contact) => contact.issuer.photo)
    expect(new Set(photos).size).toBe(photos.length)
  })

  test('each fits the budget an exchanged R-Card photo has to fit', () => {
    // The seeded photo must not be bigger than one the real pipeline could
    // produce (rcardPhoto.ts) — otherwise seeding hides the layout and memory
    // behaviour of a genuine exchange instead of standing in for it.
    for (const photo of TEST_CONTACT_PHOTOS) {
      const base64 = photo.slice(photo.indexOf(',') + 1)
      expect(base64.length).toBeLessThanOrEqual(RCARD_PHOTO_MAX_BASE64_BYTES)
    }
  })

  test('the exported set matches what the contacts carry', () => {
    expect(new Set(TEST_CONTACT_PHOTOS)).toEqual(new Set(allContacts.map((contact) => contact.issuer.photo)))
  })
})

describe('createRCardCredential', () => {
  const alice = TEST_CONTACTS.alice
  const params = { issuer: alice.issuer, credentialSubject: { id: HOLDER_DID } }

  test('is a received RelationshipCard, not a peer VRC', () => {
    // Both matter: isRCard is what makes resolveContactDisplayInfo prefer it,
    // and NOT being a peer VRC is what keeps it from adding a second row for
    // the same contact in the contacts list.
    const raw = toRawCredential(createRCardCredential(params))

    expect(isRCard(raw)).toBe(true)
    expect(isPeerVrcCredential(raw)).toBe(false)
  })

  test('is issued by the contact, to the holder', () => {
    const raw = toRawCredential(createRCardCredential(params))

    expect(raw?.issuer).toBe(alice.issuer.id)
    expect(raw?.credentialSubject?.id).toBe(HOLDER_DID)
  })
})

describe('a seeded contact, as the contacts screen resolves it', () => {
  const alice = TEST_CONTACTS.alice
  const params = { issuer: alice.issuer, credentialSubject: { id: HOLDER_DID } }

  test('resolves name, organisation and photo from the pair seedTestContacts writes', () => {
    const records = [createDTGCredential(params), createRCardCredential(params)]

    expect(resolveContactDisplayInfo(records, alice.issuer.id)).toEqual({
      name: alice.issuer.name,
      email: alice.issuer.email,
      organization: alice.issuer.organization,
      photo: alice.issuer.photo,
    })
  })

  test('resolves a single-word display name without inventing a surname', () => {
    const solo = {
      issuer: { id: 'did:peer:2.Ez6LSsolo0000solo', name: 'Prince' },
      credentialSubject: { id: HOLDER_DID },
    }
    const records = [createDTGCredential(solo), createRCardCredential(solo)]

    expect(resolveContactDisplayInfo(records, solo.issuer.id).name).toBe('Prince')
  })

  test('has no photo from the DTG credential alone', () => {
    // Why seedTestContacts writes both. The legacy issuer-object branch is
    // all a lone DTG credential can offer, and it carries no photo — which is
    // exactly the gap that left every seeded trading card on its placeholder.
    const info = resolveContactDisplayInfo([createDTGCredential(params)], alice.issuer.id)

    expect(info.name).toBe(alice.issuer.name)
    expect(info.photo).toBeUndefined()
  })
})

describe('the photo fixtures themselves', () => {
  test('are square, at the dimension the real pipeline resizes to', () => {
    // Decoded from the JPEG's SOF0 marker: [.., height(2), width(2), ..].
    for (const photo of TEST_CONTACT_PHOTOS) {
      const bytes = Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64')
      let offset = 2
      let dimensions: { width: number; height: number } | undefined
      while (offset < bytes.length - 9) {
        if (bytes[offset] !== 0xff) break
        const marker = bytes[offset + 1]
        const length = bytes.readUInt16BE(offset + 2)
        if (marker >= 0xc0 && marker <= 0xc3) {
          dimensions = { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
          break
        }
        offset += 2 + length
      }

      expect(dimensions).toEqual({ width: RCARD_PHOTO_MAX_DIMENSION, height: RCARD_PHOTO_MAX_DIMENSION })
    }
  })
})
