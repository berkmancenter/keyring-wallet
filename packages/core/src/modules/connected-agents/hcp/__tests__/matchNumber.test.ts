/**
 * The match number against the brief's vectors (`vectors/match-number.json`, computed independently in Python and
 * Node), and the four-ASCII-digit rule for what the person types.
 */
import { hcpMatchNumber, hcpNumberMatches } from '../matchNumber'
import vectors from './vectors/match-number.json'

const [first] = vectors.cases

describe('hcpMatchNumber', () => {
  it('holds five vectors', () => {
    expect(vectors.version).toBe(1)
    expect(vectors.cases).toHaveLength(5)
  })

  it.each(vectors.cases)('gives $number for $threadId and $clientVid', ({ threadId, clientVid, number }) => {
    expect(hcpMatchNumber(threadId, clientVid)).toBe(number)
    expect(hcpNumberMatches(number, threadId, clientVid)).toBe(true)
  })

  it('control: one byte of threadId changed gives another number', () => {
    const changed = first.threadId.slice(0, -1) + (first.threadId.endsWith('1') ? '2' : '1')
    expect(hcpMatchNumber(changed, first.clientVid)).not.toBe(first.number)
    expect(hcpMatchNumber(changed, first.clientVid)).not.toBe(hcpMatchNumber(first.threadId, first.clientVid))
    expect(hcpNumberMatches(first.number, changed, first.clientVid)).toBe(false)
  })
})

describe('hcpNumberMatches', () => {
  it.each(['264', '26444', '26 4', '٢٦٤٤', ' 2644', '2644 ', '', '+644'])('refuses %j', (typed) => {
    expect(hcpNumberMatches(typed, first.threadId, first.clientVid)).toBe(false)
  })

  it('control: accepts exactly the four digits', () => {
    expect(hcpNumberMatches('2644', first.threadId, first.clientVid)).toBe(true)
  })
})
