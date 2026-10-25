import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native'

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
 */
export function useComposerText() {
  const textRef = useRef('')
  const selectionRef = useRef({ start: 0, end: 0 })
  const [hasDraft, setHasDraft] = useState(false)
  const [text, setText] = useState<string | undefined>(undefined)

  const onChangeText = useCallback((value: string) => {
    textRef.current = value
    selectionRef.current = { start: value.length, end: value.length }
    setHasDraft(value.trim().length > 0)
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

  // Hand the text over for one render only.
  useEffect(() => {
    if (text !== undefined) setText(undefined)
  }, [text])

  return { text, textInputProps, insert, hasDraft }
}
