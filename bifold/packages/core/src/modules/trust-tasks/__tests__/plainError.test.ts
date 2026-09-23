/**
 * A tester on a shipped build was shown this, on the screen where they were
 * making an identity (report #17, 2026-09-22):
 *
 *   [TrustTasks:VtaClient] the VTA did not answer
 *   https://trusttasks.org/spec/vta/webvh/dids/create/1.0
 *
 * Every part of it is ours: a module prefix, a task URI, and a verb that only
 * means something if you know what was asked. The thing they needed — tap it
 * again, it usually works — was not there. These tests pin both halves: the
 * sentence a person reads, and the original text kept for whoever reads the
 * report.
 */
import { plainError } from '../screens/plainError'

const asShipped = '[TrustTasks:VtaClient] the VTA did not answer https://trusttasks.org/spec/vta/webvh/dids/create/1.0'

describe('what a person is told when something fails', () => {
  it('turns the reported failure into a sentence with an action', () => {
    const said = plainError(new Error(asShipped))
    expect(said.line).toBe('Errors.NoAnswer')
    expect(said.retry).toBe(true)
  })

  it('keeps the original text for Details and for the report', () => {
    expect(plainError(new Error(asShipped)).detail).toBe(asShipped)
  })

  it('tells a refusal from a silence — trying again cannot fix a refusal', () => {
    const refused = plainError(new Error('permission denied: forbidden: DID not in ACL: did:peer:2…'))
    expect(refused.line).toBe('Errors.NotAllowed')
    expect(refused.retry).toBe(false)
  })

  it('tells nothing-at-that-address from an agent that stayed silent', () => {
    expect(plainError(new Error('fetch failed: ENOTFOUND vtc.example')).line).toBe('Errors.Unreachable')
  })

  it('admits it does not know, rather than showing the raw text as an explanation', () => {
    const odd = plainError(new Error('Exception in HostFunction: std::bad_alloc'))
    expect(odd.line).toBe('Errors.Unknown')
    expect(odd.detail).toBe('Exception in HostFunction: std::bad_alloc')
  })

  it('is not fooled by our own jargon carrying the word it matches on', () => {
    // The task URI contains "dids/create" — the classification must come from
    // the words around it, not from the URI we are trying to hide.
    expect(plainError(new Error(asShipped)).line).not.toBe('Errors.Unknown')
  })

  it('takes a thrown non-Error too, since not everything thrown is one', () => {
    expect(plainError('the VTA did not answer').line).toBe('Errors.NoAnswer')
  })
})

describe('the sentences themselves', () => {
  const copy = jest.requireActual('../../../localization/en/en.json').Errors as Record<string, string>

  it('never show a module prefix, a task URI or a DID', () => {
    for (const key of ['NoAnswer', 'NotAllowed', 'Unreachable', 'Unknown']) {
      expect(copy[key]).not.toMatch(/\[[A-Za-z]+:[A-Za-z]+\]/)
      expect(copy[key]).not.toMatch(/trusttasks\.org|https?:\/\//)
      expect(copy[key]).not.toMatch(/did:[a-z]+:/)
    }
  })

  it('name an action wherever trying again is worth it', () => {
    expect(copy.NoAnswer).toMatch(/try again/i)
    expect(copy.Unreachable).toMatch(/try again/i)
    // …and do not, where it cannot help.
    expect(copy.NotAllowed).not.toMatch(/try again/i)
  })
})
