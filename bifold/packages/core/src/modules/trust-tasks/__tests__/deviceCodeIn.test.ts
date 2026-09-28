/**
 * The device code in whatever a person pasted (IN-52): the other phone's Share
 * sends a sentence with the code on its own line, and a paste can carry
 * whitespace around it. Only one code is taken; anything else is left for the
 * "That isn't a device code" answer.
 */
import { deviceCodeIn } from '../module/vtaOwner'

const CODE =
  'did:peer:2.Vz6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'

describe('the device code in pasted text', () => {
  it('is the text itself when that is a bare code, trimmed', () => {
    expect(deviceCodeIn(`  ${CODE}\n`)).toBe(CODE)
    expect(deviceCodeIn('did:key:z6MkBackup')).toBe('did:key:z6MkBackup')
  })

  it('is found inside the message the other phone shares', () => {
    expect(deviceCodeIn(`Add this code to agents.example so my phone can use it:\n\n${CODE}\n`)).toBe(CODE)
  })

  it('is not guessed when there is none, or two different ones', () => {
    expect(deviceCodeIn('hello there')).toBeUndefined()
    expect(deviceCodeIn('')).toBeUndefined()
    expect(deviceCodeIn(`did:key:z6MkOne and did:key:z6MkTwo`)).toBeUndefined()
  })

  it('takes the same code written twice as one', () => {
    expect(deviceCodeIn(`${CODE}\n${CODE}`)).toBe(CODE)
  })
})
