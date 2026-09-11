/**
 * App-wide listener for the Approver demo: shows a toast when a pending
 * access request arrives, regardless of which screen is currently on
 * screen. Now that the demo's own UI lives per-contact
 * (`ApproverContactSection`, on that contact's Contact Details screen), a
 * person anywhere else in the app would otherwise have no way to learn a
 * request arrived — this component is that notification, registered on
 * `TOKENS.COMPONENT_APP_GLOBAL_LISTENER` and mounted once in `TabStack`
 * alongside `InAppMessageNotifier`, whose own toast pattern
 * (`react-native-toast-message`, tap-to-navigate) this mirrors.
 *
 * Tapping the toast opens Chat for that connection — the same reachable
 * target `InAppMessageNotifier` itself navigates to — rather than Contact
 * Details directly: building the `ContactCredentialDetails` route param
 * Contact Details needs means re-deriving it from the connection's W3C
 * credential records (see `ListContacts.tsx`'s own extraction logic), which
 * this toast has no need to duplicate. From Chat, the contact's own header
 * menu ("View Contact") reaches Contact Details, where the actual
 * `TrustTaskApprovalCard` renders.
 */

import { PendingTrustTaskPrompt, Screens, Stacks, trustTaskPromptStore, useAppAgent } from '@bifold/core'
import { useNavigation } from '@react-navigation/native'
import React, { useEffect } from 'react'
import Toast from 'react-native-toast-message'

import { TYPE_URI } from './ceremony'

const ApproverGlobalListener: React.FC = () => {
  const { agent } = useAppAgent()
  const navigation = useNavigation<any>()

  useEffect(() => {
    if (!agent) return
    const onPrompt = (prompt: PendingTrustTaskPrompt) => {
      if (prompt.typeUri !== TYPE_URI) return
      const senderName = prompt.counterpartyLabel || 'Contact'
      Toast.show({
        type: 'message',
        text1: senderName,
        text2: prompt.summary,
        visibilityTime: 5000,
        topOffset: 0,
        props: {
          senderInitial: senderName.charAt(0).toUpperCase(),
        },
        onPress: () => {
          Toast.hide()
          navigation.navigate(Stacks.ContactStack, {
            screen: Screens.Chat,
            params: { connectionId: prompt.connectionId },
          })
        },
      })
    }
    trustTaskPromptStore.on('prompt', onPrompt)
    return () => {
      trustTaskPromptStore.off('prompt', onPrompt)
    }
  }, [agent, navigation])

  return null
}

export default ApproverGlobalListener
