/**
 * The connectionId of the chat someone is looking at: its screen focused and the app in the foreground
 * (useChatAttended). Not which chat screen is mounted: a chat under a screen pushed over it, or with the app in the
 * background, is not here. Used by InAppMessageNotifier so the visible conversation raises no toast.
 */
let activeChatConnectionId: string | undefined = undefined

export const setActiveChatConnectionId = (id: string | undefined): void => {
  activeChatConnectionId = id
}

export const getActiveChatConnectionId = (): string | undefined => {
  return activeChatConnectionId
}
