import { useEffect, useState } from 'react'

import { continuityPromptStore, type ContinuityPrompt } from './continuity'

/** The continuity prompt waiting on one connection, kept current as prompts arrive and are answered. */
export function useContinuityPrompt(connectionId: string | undefined): ContinuityPrompt | undefined {
  const read = () => (connectionId ? continuityPromptStore.get(connectionId) : undefined)
  const [prompt, setPrompt] = useState<ContinuityPrompt | undefined>(read)

  useEffect(() => {
    const refresh = () => setPrompt(connectionId ? continuityPromptStore.get(connectionId) : undefined)
    refresh()
    continuityPromptStore.on('prompt', refresh)
    continuityPromptStore.on('promptCleared', refresh)
    return () => {
      continuityPromptStore.off('prompt', refresh)
      continuityPromptStore.off('promptCleared', refresh)
    }
  }, [connectionId])

  return prompt
}

/** The connections with a continuity prompt waiting, newest first; each counts as unread until it is answered. */
export function usePendingContinuityConnections(): string[] {
  const read = () => continuityPromptStore.all().map((prompt) => prompt.connectionId)
  const [connections, setConnections] = useState<string[]>(read)

  useEffect(() => {
    const refresh = () => setConnections(continuityPromptStore.all().map((prompt) => prompt.connectionId))
    refresh()
    continuityPromptStore.on('prompt', refresh)
    continuityPromptStore.on('promptCleared', refresh)
    return () => {
      continuityPromptStore.off('prompt', refresh)
      continuityPromptStore.off('promptCleared', refresh)
    }
  }, [])

  return connections
}
