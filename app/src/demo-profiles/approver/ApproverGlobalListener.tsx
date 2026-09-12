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
 * Tapping the toast navigates straight to Contact Details for the sender —
 * where `ApproverContactSection` actually renders the pending card — rather
 * than Chat: `getContactCredentialDetailsForConnection` (added to
 * `@bifold/core` alongside this) re-derives the `ContactCredentialDetails`
 * route param Contact Details needs from the connection's W3C credential
 * records, the same resolution `ListContacts.tsx` does per row, just for
 * this one connection. Falls back to Chat only if that resolution comes back
 * empty (no established VRC relationship on file for this connection — the
 * ceremony itself requires one, so this should not normally happen).
 */

import {
  PendingTrustTaskPrompt,
  Screens,
  Stacks,
  getContactCredentialDetailsForConnection,
  trustTaskPromptStore,
  useAppAgent,
} from '@bifold/core'
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
          void (async () => {
            const w3cCredentialRecords = await agent.w3cCredentials.getAll()
            const contact = await getContactCredentialDetailsForConnection(
              agent,
              prompt.connectionId,
              w3cCredentialRecords
            )
            if (contact) {
              navigation.navigate(Stacks.ContactStack, {
                screen: Screens.ContactDetails,
                params: { contact },
              })
            } else {
              navigation.navigate(Stacks.ContactStack, {
                screen: Screens.Chat,
                params: { connectionId: prompt.connectionId },
              })
            }
          })()
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
