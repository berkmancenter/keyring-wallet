import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { NativeSyntheticEvent, TextInput, TextInputSelectionChangeEventData } from 'react-native'

/** `insert` placed into `text` over the selection, and where the caret ends up. */
export function insertAtSelection(
  text: string,
  selection: { start: number; end: number },
  insert: string
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selection.start, text.length))
  const end = Math.max(start, Math.min(selection.end, text.length))
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length }
}

/**
 * The composer's text, watched without controlling it.
 *
 * gifted-chat keeps the text in its own state, and a controlled composer is
 * what broke typing on 2026-08-26. So this only watches it (onChangeText,
 * onSelectionChange) and, to insert something, hands gifted-chat a `text` for
 * one render: gifted-chat copies a defined `text` prop into its own state,
 * then the prop is dropped again and the composer is uncontrolled as before.
 * gifted-chat reports '' after a send.
 *
 * `inputRef` goes to gifted-chat as `textInputRef`, so `focusAtCaret` can put
 * the person back in the field after the emoji picker: an insert into a field
 * never focused leaves its own caret at the start, where typing would land
 * before the emoji (272).
 *
 * `onTextChange` hears every change, typed or inserted, so the chat can keep
 * its draft (chat/useChatDraft.ts); `restore` puts a kept draft back, through
 * the same hand-over, into a composer that is still empty.
 *
 * `sent` empties the composer after a send. gifted-chat's own reset sets its
 * text to the `text` prop when one is given, so a Send landing while a
 * hand-over is still on (a kept draft or an insert just put back) left the sent
 * words in the field, with Send still showing. Handing over '' wins either way.
 */
export function useComposerText(options: { onTextChange?: (text: string) => void } = {}) {
  const onTextChangeRef = useRef(options.onTextChange)
  onTextChangeRef.current = options.onTextChange
  // gifted-chat's textInputRef is typed RefObject<TextInput>, without React 19's `| null`.
  const inputRef = useRef<TextInput>(null) as RefObject<TextInput>
  const textRef = useRef('')
  const selectionRef = useRef({ start: 0, end: 0 })
  const [hasDraft, setHasDraft] = useState(false)
  const [text, setText] = useState<string | undefined>(undefined)

  const onChangeText = useCallback((value: string) => {
    textRef.current = value
    selectionRef.current = { start: value.length, end: value.length }
    setHasDraft(value.trim().length > 0)
    onTextChangeRef.current?.(value)
  }, [])

  const onSelectionChange = useCallback((event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selectionRef.current = event.nativeEvent.selection
  }, [])

  const textInputProps = useMemo(() => ({ onChangeText, onSelectionChange }), [onChangeText, onSelectionChange])

  /** Put `value` into the composer at the caret, replacing any selection. */
  const insert = useCallback(
    (value: string) => {
      const next = insertAtSelection(textRef.current, selectionRef.current, value)
      onChangeText(next.text)
      selectionRef.current = { start: next.caret, end: next.caret }
      setText(next.text)
    },
    [onChangeText]
  )

  /** Put a kept draft into the composer, caret at its end; does nothing once anything has been typed. */
  const restore = useCallback((value: string) => {
    if (textRef.current.length > 0) return
    textRef.current = value
    selectionRef.current = { start: value.length, end: value.length }
    setHasDraft(value.trim().length > 0)
    setText(value)
  }, [])

  /** After a send: an empty composer, whatever gifted-chat's reset found in the `text` prop. */
  const sent = useCallback(() => {
    textRef.current = ''
    selectionRef.current = { start: 0, end: 0 }
    setHasDraft(false)
    setText('')
  }, [])

  /** Focus the field with its caret where the last insert left it. */
  const focusAtCaret = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const caret = Math.min(selectionRef.current.end, textRef.current.length)
    input.focus()
    input.setSelection(caret, caret)
  }, [])

  // Hand the text over for one render only.
  useEffect(() => {
    if (text !== undefined) setText(undefined)
  }, [text])

  return { text, textInputProps, inputRef, insert, restore, sent, focusAtCaret, hasDraft }
}
