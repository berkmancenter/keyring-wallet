/**
 * The "Answers on" directive: the `directives/set` payload for both effects, in each language, validates against the
 * vendored schema; `operators` is the grant's operator only; no `categories` and no `accessToken`; and each outcome of
 * the call.
 */
import { HcpOffError, type HcpVtaPort } from '../../vtaPort'
import { answersText } from '../copy'
import { HCP_ANSWERS_OTHERS_ACTION, HCP_DIRECTIVES_SET, hcpAnswersPayload, setHcpAnswers } from '../directive'
import { directiveAnswer, directiveSetSchemas, expectValid } from './fixtures/directiveSchema'

const S = directiveSetSchemas()
const OPERATOR = 'did:web:labs.example'
const DIRECTIVE = 'urn:uuid:d5f7b9c1-3e2a-4d6f-8b0e-2c4a6e8f0b19'

const refusal = (code?: string) => Object.assign(new Error('refused'), { name: 'VtiRefusal', code })

function fakePort(answer: (payload: Record<string, unknown>) => unknown) {
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const port: HcpVtaPort = {
    task: jest.fn(async (type: string, payload: Record<string, unknown>) => {
      sent.push({ type, payload })
      return answer(payload)
    }),
  }
  return { port, sent }
}

describe('hcpAnswersPayload', () => {
  it.each([
    [true, 'permit', 'AnswersOnDirectiveText'],
    [false, 'deny', 'AnswersOffDirectiveText'],
  ] as const)('on=%s sets a %s directive in the person’s words, valid for the schema', (on, effect, key) => {
    for (const language of ['en', 'fr', 'ptBr'] as const) {
      const payload = hcpAnswersPayload({ operatorId: OPERATOR, on, language })
      expect(payload).toEqual({
        action: HCP_ANSWERS_OTHERS_ACTION,
        effect,
        text: answersText(key, language),
        operators: [OPERATOR],
      })
      expectValid(S.request, payload)
    }
  })

  it('names only the grant’s operator, and carries no categories and no access token', () => {
    const payload = hcpAnswersPayload({ operatorId: OPERATOR, on: true, language: 'en' })
    expect(payload.operators).toEqual([OPERATOR])
    expect(payload).not.toHaveProperty('categories')
    expect(payload).not.toHaveProperty('accessToken')
  })

  it('the action is an absolute URI the schema accepts', () => {
    expect(HCP_ANSWERS_OTHERS_ACTION).toMatch(/^https:\/\//)
    expect(HCP_DIRECTIVES_SET).toBe('https://trusttasks.org/spec/hcp/directives/set/0.1')
  })

  // control: the schema check bites: a wrong effect, a bare action or an empty operator list each fail it.
  it('control: the schema refuses a payload with an effect HCP does not have, or a bare word as the action', () => {
    const payload = hcpAnswersPayload({ operatorId: OPERATOR, on: true, language: 'en' })
    expect(S.request({ ...payload, effect: 'allow' })).toBe(false)
    expect(S.request({ ...payload, action: 'answerOthers' })).toBe(false)
    expect(S.request({ ...payload, operators: [] })).toBe(false)
  })
})

describe('setHcpAnswers', () => {
  it('sends one directives/set and reads the directiveId from a valid answer', async () => {
    const { port, sent } = fakePort((payload) => {
      const answer = directiveAnswer(payload, DIRECTIVE)
      expectValid(S.response, answer)
      return answer
    })
    await expect(setHcpAnswers(port, { operatorId: OPERATOR, on: false, language: 'fr' })).resolves.toEqual({
      ok: true,
      directiveId: DIRECTIVE,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe(HCP_DIRECTIVES_SET)
    expect(sent[0].payload.effect).toBe('deny')
  })

  it('a success with no directiveId is still a success, with directiveId null', async () => {
    const { port } = fakePort(() => ({}))
    await expect(setHcpAnswers(port, { operatorId: OPERATOR, on: true, language: 'en' })).resolves.toEqual({
      ok: true,
      directiveId: null,
    })
  })

  it('a refusal gives its code, an unreachable VTA unreachable, the flags off off; each sent once', async () => {
    const cases: [unknown, unknown][] = [
      [refusal('permissionDenied'), { ok: false, refused: 'permissionDenied' }],
      [refusal(), { ok: false, refused: 'unknown' }],
      [new Error('timeout'), { ok: false, unreachable: true }],
      [new HcpOffError(), { ok: false, off: true }],
    ]
    for (const [error, expected] of cases) {
      const task = jest.fn(async () => {
        throw error
      })
      await expect(setHcpAnswers({ task }, { operatorId: OPERATOR, on: true, language: 'en' })).resolves.toEqual(
        expected
      )
      expect(task).toHaveBeenCalledTimes(1)
    }
  })
})
