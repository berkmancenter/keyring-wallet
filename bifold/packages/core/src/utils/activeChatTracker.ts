/**
 * Module-level tracker for the currently active (open) chat connectionId.
 * Used by InAppMessageNotifier to suppress toasts for the visible conversation.
 */
let activeChatConnectionId: string | undefined = undefined

export const setActiveChatConnectionId = (id: string | undefined): void => {
  activeChatConnectionId = id
}

export const getActiveChatConnectionId = (): string | undefined => {
  return activeChatConnectionId
}
