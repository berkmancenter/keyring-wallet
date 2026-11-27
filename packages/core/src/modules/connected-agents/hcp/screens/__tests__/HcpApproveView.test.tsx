/**
 * Agent connect, the HCP approve flow as views (backlog Section C, U1; canvas frame 50): HcpApproveView with its face
 * or fingerprint check, HcpConnectFlowView's one view per state, the HCP copy's language, and the catalogue's HCP word
 * source. Views only: nothing here runs the flow.
 */
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import path from 'path'
import React from 'react'
import type * as reactI18next from 'react-i18next'

import { BasicAppContext } from '../../../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../../../utils/testable'
import { buildHcpWordSource, HCP_WORD_SOURCE } from '../../../__tests__/fixtures/hcpWordSource'
import { HCP_APPROVAL_VIEW } from '../../../__tests__/fixtures/screenStatesHcpApprove'
import type { HcpApproveState } from '../../approveFlow'
import { HCP_COPY, hcpText } from '../../copy'
import HcpApproveView, { HcpApproveViewProps } from '../HcpApproveView'
import HcpConnectFlowView, { HcpConnectFlowViewProps } from '../HcpConnectFlowView'
import { hcpLanguageOf, useHcpCopy } from '../useHcpCopy'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const en = (key: Parameters<typeof hcpText>[0], params?: Record<string, string>) => hcpText(key, 'en', params)

/** Every string drawn under `node`, in order (a rendered JSON tree, or a test instance). */
const textsOf = (node: unknown, out: string[] = []): string[] => {
  if (node == null) return out
  if (typeof node === 'string') {
    // An icon draws as one private-use glyph: not text.
    if (!/^\p{Co}+$/u.test(node)) out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => textsOf(child, out))
    return out
  }
  const children = (node as { children?: unknown }).children
  if (children) textsOf(children, out)
  return out
}

describe('HcpApproveView', () => {
  const approve = (over: Partial<HcpApproveViewProps> = {}) => {
    const props: HcpApproveViewProps = {
      name: 'Notes helper',
      view: HCP_APPROVAL_VIEW,
      until: '14:30',
      confirm: jest.fn(async () => true),
      onApprove: jest.fn(),
      ...over,
    }
    return { props, tree: show(<HcpApproveView {...props} />) }
  }
  const press = (tree: ReturnType<typeof show>) => fireEvent.press(tree.getByTestId(id('HcpApproveButton')))
  const disabled = (tree: ReturnType<typeof show>) =>
    tree.getByTestId(id('HcpApproveButton')).props.accessibilityState.disabled

  it('draws the title, the rows verbatim and in order, the warning box, then Approve', () => {
    const { tree } = approve()
    expect(tree.getAllByTestId(id('HcpApproveRow'))).toHaveLength(5)
    expect(textsOf(tree.toJSON())).toEqual([
      en('ApproveTitle', { name: 'Notes helper' }),
      ...HCP_APPROVAL_VIEW.rows,
      en('ApproveOwnTerminal'),
      en('Approve'),
    ])
    expect(tree.getByTestId(id('ConnectNotice')).props.accessibilityLabel).toBe(en('ApproveOwnTerminal'))
    expect(tree.getByTestId(id('HcpApproveButton')).props.accessibilityLabel).toBe(en('Approve'))
  })

  it('draws one row per summary it is given, each in its own row', () => {
    const view = { ...HCP_APPROVAL_VIEW, rows: ['First.', 'Second.'] }
    const { tree } = approve({ view })
    const rows = tree.getAllByTestId(id('HcpApproveRow'))
    expect(rows.map((row) => textsOf(row))).toEqual([['First.'], ['Second.']])
  })

  it('draws a row as plain text, never interpreted', () => {
    const view = { ...HCP_APPROVAL_VIEW, rows: ['<b>Run by</b> {{name}} & co.', ...HCP_APPROVAL_VIEW.rows.slice(1)] }
    const { tree } = approve({ view })
    expect(tree.getByText('<b>Run by</b> {{name}} & co.')).toBeTruthy()
  })

  it('approves only after the face or fingerprint check passes', async () => {
    const { props, tree } = approve()
    press(tree)
    await waitFor(() => expect(props.onApprove).toHaveBeenCalledTimes(1))
    expect(props.confirm).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the check is declined', async () => false],
    ['the check fails with an error', async () => Promise.reject(new Error('no biometrics'))],
    ['the check answers something other than true', async () => 'confirmed' as unknown as boolean],
    ['the check answers a truthy number', async () => 1 as unknown as boolean],
  ])('never approves when %s', async (_, confirm) => {
    const { props, tree } = approve({ confirm: jest.fn(confirm) })
    press(tree)
    await waitFor(() => expect(props.confirm).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(props.onApprove).not.toHaveBeenCalled()
    // And the person can try the check again.
    expect(disabled(tree)).toBe(false)
  })

  it('approves once: after a passed check, Approve is spent', async () => {
    const { props, tree } = approve()
    press(tree)
    await waitFor(() => expect(props.onApprove).toHaveBeenCalledTimes(1))
    expect(disabled(tree)).toBe(true)
    press(tree)
    await act(async () => undefined)
    expect(props.confirm).toHaveBeenCalledTimes(1)
    expect(props.onApprove).toHaveBeenCalledTimes(1)
  })

  it('asks once while a check is open', async () => {
    let answer: (value: boolean) => void = () => undefined
    const confirm = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const { props, tree } = approve({ confirm })
    press(tree)
    press(tree)
    expect(confirm).toHaveBeenCalledTimes(1)
    await act(async () => answer(true))
    expect(props.onApprove).toHaveBeenCalledTimes(1)
  })

  it('busy: Approve is disabled and asks nothing', async () => {
    const { props, tree } = approve({ busy: true })
    expect(disabled(tree)).toBe(true)
    press(tree)
    await act(async () => undefined)
    expect(props.confirm).not.toHaveBeenCalled()
    expect(props.onApprove).not.toHaveBeenCalled()
  })

  // control: the same press with a check that passes does approve, so the "never" cases above are not vacuous.
  it('control: a passing check after a declined one approves', async () => {
    const confirm = jest.fn<Promise<boolean>, []>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { props, tree } = approve({ confirm })
    press(tree)
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(props.onApprove).not.toHaveBeenCalled()
    press(tree)
    await waitFor(() => expect(props.onApprove).toHaveBeenCalledTimes(1))
  })
})

describe('HcpConnectFlowView', () => {
  const flow = (state: HcpApproveState) => {
    const props: HcpConnectFlowViewProps = {
      state,
      name: 'Notes helper',
      until: '14:30',
      confirm: jest.fn(async () => true),
      onApprove: jest.fn(),
      onSubmitNumber: jest.fn(),
      onCancel: jest.fn(),
      onClose: jest.fn(),
      onSeeDetails: jest.fn(),
    }
    return { props, tree: show(<HcpConnectFlowView {...props} />) }
  }

  it.each([[{ state: 'idle' } as const], [{ state: 'waiting' } as const]])(
    '%o draws a busy spinner with no words and nothing to press',
    (state) => {
      const { tree } = flow(state)
      const view = tree.getByTestId(id('HcpConnectWaiting'))
      expect(view.props.accessibilityState).toEqual({ busy: true })
      expect(tree.queryAllByRole('button')).toHaveLength(0)
      expect(tree.queryAllByText(/./)).toHaveLength(0)
    }
  )

  it('numberEntry draws the base number step with four cells, and sends the digits once', async () => {
    const { props, tree } = flow({ state: 'numberEntry' })
    expect(tree.getByText('ConnectedAgents.NumberBodyFourDigits')).toBeTruthy()
    expect(tree.getAllByTestId(id('ConnectNumberCell'), { includeHiddenElements: true })).toHaveLength(4)
    fireEvent.changeText(tree.getByTestId(id('ConnectNumberField')), '2644')
    fireEvent.press(tree.getByTestId(id('ConnectNumberContinue')))
    fireEvent.press(tree.getByTestId(id('ConnectNumberContinue')))
    expect(props.onSubmitNumber).toHaveBeenCalledTimes(1)
    expect(props.onSubmitNumber).toHaveBeenCalledWith('2644')
    fireEvent.press(tree.getByTestId(id('ConnectNumberCancel')))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('approve draws HcpApproveView, and Approve goes through the check', async () => {
    const { props, tree } = flow({ state: 'approve', view: HCP_APPROVAL_VIEW })
    expect(tree.getByTestId(id('HcpApprove'))).toBeTruthy()
    expect(tree.getByTestId(id('HcpApproveButton')).props.accessibilityState.disabled).toBe(false)
    fireEvent.press(tree.getByTestId(id('HcpApproveButton')))
    await waitFor(() => expect(props.onApprove).toHaveBeenCalledTimes(1))
    expect(props.confirm).toHaveBeenCalledTimes(1)
  })

  it('approving draws HcpApproveView busy, its button disabled', async () => {
    const { props, tree } = flow({ state: 'approving', view: HCP_APPROVAL_VIEW })
    expect(tree.getByTestId(id('HcpApprove'))).toBeTruthy()
    expect(tree.getByTestId(id('HcpApproveButton')).props.accessibilityState.disabled).toBe(true)
    fireEvent.press(tree.getByTestId(id('HcpApproveButton')))
    await act(async () => undefined)
    expect(props.confirm).not.toHaveBeenCalled()
  })

  it('approved draws Done with "See details", and no chat or "Keep it connected"', () => {
    const { props, tree } = flow({ state: 'approved', view: HCP_APPROVAL_VIEW })
    expect(tree.getByTestId(id('ConnectConnected'))).toBeTruthy()
    expect(tree.queryByTestId(id('ConnectOpenChat'))).toBeNull()
    expect(tree.queryByTestId(id('ConnectKeepConnected'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('ConnectSeeDetails')))
    expect(props.onSeeDetails).toHaveBeenCalledTimes(1)
  })

  it.each<[string, HcpApproveState, string]>([
    ['expired', { state: 'expired', message: { key: 'CodeExpired' } }, en('CodeExpired')],
    ['wrongNumber', { state: 'wrongNumber', message: { key: 'WrongNumber' } }, en('WrongNumber')],
    ['locked', { state: 'locked', minutes: 7, message: { key: 'Locked', params: { n: '7' } } }, en('Locked', { n: '7' })],
    [
      'failed, not approved',
      { state: 'failed', error: 'x', message: { key: 'ApproveNotApproved' } },
      en('ApproveNotApproved'),
    ],
    [
      'failed, not recorded',
      { state: 'failed', error: 'x', message: { key: 'ApproveNotRecorded', params: { name: 'Notes helper' } } },
      en('ApproveNotRecorded', { name: 'Notes helper' }),
    ],
    ['failed, declined', { state: 'failed', error: 'x', message: { key: 'ApproveDeclined' } }, en('ApproveDeclined')],
    [
      'failed, answered elsewhere',
      { state: 'failed', error: 'x', message: { key: 'ApproveAnsweredElsewhere' } },
      en('ApproveAnsweredElsewhere'),
    ],
  ])('%s draws one notice with its own words, and Close', (_, state, words) => {
    const { props, tree } = flow(state)
    expect(tree.getByTestId(id('HcpConnectEnd'))).toBeTruthy()
    expect(tree.getByTestId(id('ConnectNotice')).props.accessibilityLabel).toBe(words)
    expect(tree.getAllByRole('button')).toHaveLength(1)
    fireEvent.press(tree.getByTestId(id('HcpConnectEndClose')))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('failed never shows the error text', () => {
    const { tree } = flow({ state: 'failed', error: 'vta said 503', message: { key: 'ApproveDeclined' } })
    expect(tree.queryByText(/503/)).toBeNull()
  })

  it('cancelled draws nothing: the caller has closed', () => {
    const { tree } = flow({ state: 'cancelled', message: { key: 'ApproveCancelled' } })
    expect(tree.toJSON()).toBeNull()
  })

  it('draws in the language the app shows', () => {
    // The module object the views read (the test's react-i18next mock), not a namespace copy of it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const i18nModule = require('react-i18next') as typeof reactI18next
    const spy = jest.spyOn(i18nModule, 'useTranslation').mockReturnValue({
      t: (key: string) => key,
      i18n: { language: 'fr-FR' },
    } as unknown as ReturnType<typeof reactI18next.useTranslation>)
    try {
      const { tree } = flow({ state: 'expired', message: { key: 'CodeExpired' } })
      expect(tree.getByTestId(id('ConnectNotice')).props.accessibilityLabel).toBe(hcpText('CodeExpired', 'fr'))
    } finally {
      spy.mockRestore()
    }
  })

  it('imports no logic action: types only from the flow', () => {
    for (const file of ['HcpApproveView.tsx', 'HcpConnectFlowView.tsx', 'useHcpCopy.ts']) {
      const source = readFileSync(path.join(__dirname, '..', file), 'utf8')
      // A value import from track C's hcp/ logic (a sibling of screens/, other than the copy) or the module's own logic
      // (a file directly under connected-agents/, not its screens/ or components/).
      const logic = [
        ...source.matchAll(/^import (?!type )[^\n]*from '(\.\.\/(?!copy')[\w]+|\.\.\/\.\.\/(?!screens\/|components\/)[\w]+)'/gm),
      ].map((m) => m[0])
      expect({ file, logic }).toEqual({ file, logic: [] })
    }
  })
})

describe('hcpLanguageOf and useHcpCopy', () => {
  it.each([
    ['fr-FR', 'fr'],
    ['fr', 'fr'],
    ['pt-BR', 'ptBr'],
    ['pt', 'ptBr'],
    ['de', 'en'],
    ['en-GB', 'en'],
    ['', 'en'],
  ])('maps %s to %s', (language, lang) => {
    expect(hcpLanguageOf(language)).toBe(lang)
  })

  it("fills a string's parameters in the app's language", () => {
    const { result } = renderHook(() => useHcpCopy())
    expect(result.current('Locked', { n: '3' })).toBe('Too many wrong numbers. Try again in 3 minutes.')
  })
})

describe('the HCP word source', () => {
  it('maps an Hcp.Locked text with a number back to Hcp.Locked', () => {
    expect(HCP_WORD_SOURCE.wordOf(en('Locked', { n: '12' }))).toBe('Hcp.Locked')
    expect(HCP_WORD_SOURCE.wordOf(en('ApproveTitle', { name: 'Notes helper' }))).toBe('Hcp.ApproveTitle')
    expect(HCP_WORD_SOURCE.wordOf('Approve')).toBe('Hcp.Approve')
  })

  // control: a name, and a row that is the VTA's data, map to nothing.
  it('control: "Some name" and an effect summary map to nothing', () => {
    expect(HCP_WORD_SOURCE.wordOf('Some name')).toBeUndefined()
    for (const row of HCP_APPROVAL_VIEW.rows) expect(HCP_WORD_SOURCE.wordOf(row)).toBeUndefined()
    // A text that only starts like a word is not that word.
    expect(HCP_WORD_SOURCE.wordOf('Approve now')).toBeUndefined()
  })

  it('says which ids exist', () => {
    expect(HCP_WORD_SOURCE.prefix).toBe('Hcp.')
    expect(HCP_WORD_SOURCE.exists('Hcp.Locked')).toBe(true)
    expect(HCP_WORD_SOURCE.exists('Hcp.NotAKey')).toBe(false)
    expect(HCP_WORD_SOURCE.exists('Hcp.toString')).toBe(false)
  })

  it('builds on HCP_COPY without throwing', () => {
    expect(() => buildHcpWordSource(HCP_COPY)).not.toThrow()
  })

  it('throws, naming both keys, on two keys with the same English text', () => {
    expect(() => buildHcpWordSource({ First: { en: 'Try again.' }, Second: { en: 'Try again.' } })).toThrow(
      /Hcp\.First.*Hcp\.Second/
    )
  })

  it('throws, naming both keys, when one template matches the other', () => {
    expect(() => buildHcpWordSource({ Plain: { en: 'Revoke "Notes"?' }, Template: { en: 'Revoke "{{name}}"?' } })).toThrow(
      /Hcp\.Plain.*Hcp\.Template/
    )
    expect(() => buildHcpWordSource({ A: { en: 'Hello {{who}}.' }, B: { en: 'Hello {{who}} and {{other}}.' } })).toThrow(
      /Hcp\.A.*Hcp\.B/
    )
    // Control: texts that only share a start do not count.
    expect(() => buildHcpWordSource({ A: { en: 'Revoke' }, B: { en: 'Revoke "{{name}}"?' } })).not.toThrow()
  })

  it('treats regular-expression characters in a text literally', () => {
    const source = buildHcpWordSource({ Odd: { en: 'Cost (1+1) is $2?' } })
    expect(source.wordOf('Cost (1+1) is $2?')).toBe('Hcp.Odd')
    expect(source.wordOf('Cost 11 is $2?')).toBeUndefined()
  })
})
