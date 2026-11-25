import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Button, TextInput } from 'react-native'
import { GiftedChat } from 'react-native-gifted-chat'

import { insertAtSelection, useComposerText } from '../../../src/components/chat/useComposerText'

describe('insertAtSelection', () => {
  it('inserts at the caret and replaces a selection', () => {
    expect(insertAtSelection('Hello world', { start: 5, end: 5 }, '👍')).toEqual({ text: 'Hello👍 world', caret: 7 })
    expect(insertAtSelection('Hello world', { start: 6, end: 11 }, '🌍')).toEqual({ text: 'Hello 🌍', caret: 8 })
  })

  it('clamps a selection outside the text', () => {
    expect(insertAtSelection('Hi', { start: 9, end: 12 }, '!')).toEqual({ text: 'Hi!', caret: 3 })
  })
})

// The real gifted-chat composer, driven the way the chat screen drives it.
const Host: React.FC<{ onDraft: (draft: boolean) => void }> = ({ onDraft }) => {
  const composer = useComposerText()
  onDraft(composer.hasDraft)
  return (
    <>
      <Button title="insert" onPress={() => composer.insert('👍')} />
      <Button title="focus" onPress={composer.focusAtCaret} />
      <GiftedChat
        messages={[]}
        user={{ _id: 1 }}
        onSend={() => undefined}
        text={composer.text}
        textInputProps={{ ...composer.textInputProps, placeholder: 'Type here' }}
        textInputRef={composer.inputRef}
      />
    </>
  )
}

const renderHost = () => {
  const drafts: boolean[] = []
  const tree = render(<Host onDraft={(draft) => drafts.push(draft)} />)
  fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
  })
  return { tree, drafts, input: () => tree.getByPlaceholderText('Type here') }
}

describe('useComposerText with the real composer', () => {
  it('inserts at the caret, then leaves the composer uncontrolled again', () => {
    const { tree, input, drafts } = renderHost()
    fireEvent.changeText(input(), 'Hello world')
    fireEvent(input(), 'selectionChange', { nativeEvent: { selection: { start: 5, end: 5 } } })

    act(() => {
      fireEvent.press(tree.getByText('insert'))
    })
    expect(input().props.value).toBe('Hello👍 world')

    // Typing still reaches the field: the composer is not held to the inserted text.
    fireEvent.changeText(input(), 'Hello👍 world!')
    expect(input().props.value).toBe('Hello👍 world!')
    expect(drafts[drafts.length - 1]).toBe(true)
  })

  it('inserts into an empty composer and reports a draft', () => {
    const { tree, input, drafts } = renderHost()
    act(() => {
      fireEvent.press(tree.getByText('insert'))
    })
    expect(input().props.value).toBe('👍')
    expect(drafts[drafts.length - 1]).toBe(true)
  })
})

describe('focusAtCaret', () => {
  // The mocked TextInput has focus but no setSelection; the real one has both.
  const field = (tree: ReturnType<typeof render>) => {
    const instance = tree.UNSAFE_getByType(TextInput).instance as { focus: jest.Mock; setSelection?: jest.Mock }
    instance.setSelection = jest.fn()
    return instance as { focus: jest.Mock; setSelection: jest.Mock }
  }

  it('puts the caret after emoji inserted into a field never focused, not before them (272)', () => {
    const { tree, input } = renderHost()
    act(() => {
      fireEvent.press(tree.getByText('insert'))
    })
    act(() => {
      fireEvent.press(tree.getByText('insert'))
    })
    const input0 = field(tree)
    input0.focus.mockClear()

    act(() => {
      fireEvent.press(tree.getByText('focus'))
    })

    expect(input().props.value).toBe('👍👍')
    expect(input0.focus).toHaveBeenCalledTimes(1)
    expect(input0.setSelection).toHaveBeenCalledWith(4, 4)
  })

  it('puts the caret after an emoji inserted mid-text', () => {
    const { tree, input } = renderHost()
    fireEvent.changeText(input(), 'Hello world')
    fireEvent(input(), 'selectionChange', { nativeEvent: { selection: { start: 5, end: 5 } } })
    act(() => {
      fireEvent.press(tree.getByText('insert'))
    })
    const input0 = field(tree)

    act(() => {
      fireEvent.press(tree.getByText('focus'))
    })

    expect(input().props.value).toBe('Hello👍 world')
    expect(input0.setSelection).toHaveBeenCalledWith(7, 7)
  })
})

// A Send that lands while a hand-over is still on: gifted-chat's reset sets its text to the `text` prop, here the
// words being sent. `handOver` stands for that render (a kept draft just restored), dropped as the send is handled.
const SendingHost: React.FC<{ clearsOnSend: boolean }> = ({ clearsOnSend }) => {
  const composer = useComposerText()
  const [handOver, setHandOver] = React.useState<string | undefined>('half a thought')
  return (
    <GiftedChat
      messages={[]}
      user={{ _id: 1 }}
      onSend={() => {
        setHandOver(undefined)
        if (clearsOnSend) composer.sent()
      }}
      text={handOver ?? composer.text}
      textInputProps={{ ...composer.textInputProps, placeholder: 'Type here' }}
      textInputRef={composer.inputRef}
    />
  )
}

describe('sent', () => {
  const sendDuringHandOver = (clearsOnSend: boolean) => {
    const tree = render(<SendingHost clearsOnSend={clearsOnSend} />)
    fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    })
    const input = () => tree.getByPlaceholderText('Type here')
    expect(input().props.value).toBe('half a thought')
    act(() => {
      fireEvent.press(tree.getByTestId('GC_SEND_TOUCHABLE'))
    })
    return input().props.value
  }

  it('empties the composer after a send that lands while a hand-over is still on', () => {
    expect(sendDuringHandOver(true)).toBe('')
  })

  // The control: without it, gifted-chat's reset puts the sent words back in the field.
  it('without it, the sent words stay in the field', () => {
    expect(sendDuringHandOver(false)).toBe('half a thought')
  })
})
