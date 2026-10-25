import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Button } from 'react-native'
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
      <GiftedChat
        messages={[]}
        user={{ _id: 1 }}
        onSend={() => undefined}
        text={composer.text}
        textInputProps={{ ...composer.textInputProps, placeholder: 'Type here' }}
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
