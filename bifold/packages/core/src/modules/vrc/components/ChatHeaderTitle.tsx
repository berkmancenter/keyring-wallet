/**
 * The chat's title: the contact's photo beside their name, so the person can see whose chat this is as in the chat
 * list. The name keeps the header's own title style; the photo is from their contact card (useConnectionFacts).
 *
 * @module vrc/components/ChatHeaderTitle
 */
import { HeaderTitle } from '@react-navigation/elements'
import React from 'react'
import { StyleSheet, View } from 'react-native'

import { testIdWithKey } from '../../../utils/testable'
import { useConnectionFacts } from '../contacts/useContactFacts'

import ContactPhoto from './ContactPhoto'

export interface ChatHeaderTitleProps {
  connectionId: string
  /** The name the chat shows for them. */
  label?: string
  /** The connection's own image, used when their card has no photo. */
  fallbackUrl?: string
  /** What the navigator hands a custom title, so the name keeps the header's style. */
  tintColor?: string
  style?: React.ComponentProps<typeof HeaderTitle>['style']
}

export const CHAT_HEADER_PHOTO = 28

export const ChatHeaderTitle: React.FC<ChatHeaderTitleProps> = ({
  connectionId,
  label,
  fallbackUrl,
  tintColor,
  style,
}) => {
  const facts = useConnectionFacts(connectionId)
  return (
    <View style={styles.row} testID={testIdWithKey('ChatHeaderTitle')}>
      <ContactPhoto photo={facts.photo} name={label} fallbackUrl={fallbackUrl} size={CHAT_HEADER_PHOTO} />
      <HeaderTitle tintColor={tintColor} style={[styles.name, style]} numberOfLines={1}>
        {label ?? ''}
      </HeaderTitle>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  name: { flexShrink: 1 },
})

export default ChatHeaderTitle
