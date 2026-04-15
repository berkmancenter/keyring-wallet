import React from 'react'
import { View } from 'react-native'

import { useTheme } from '../../contexts/theme'
import { Role } from '../../types/chat'
import { ThemedText } from '../texts/ThemedText'

interface ChatEventProps {
  userLabel?: string
  actionLabel?: string
  role: Role
  /** Bold title on first line, optional subtitle on second line */
  title?: string
  subtitle?: string
  /** Prefix text before the bold title (e.g. "You connected with ") */
  prefix?: string
}

export const ChatEvent: React.FC<ChatEventProps> = ({ userLabel, actionLabel, role, title, subtitle, prefix }) => {
  const { ChatTheme } = useTheme()
  const textStyle = role === Role.me ? ChatTheme.rightText : ChatTheme.leftText

  // Connection-style format: "prefix" + bold title + subtitle inline
  if (prefix !== undefined && title) {
    return (
      <View>
        <ThemedText style={textStyle}>
          {prefix}
          <ThemedText style={[textStyle, { fontWeight: 'bold' }]}>{title}</ThemedText>
          {subtitle || ''}
        </ThemedText>
      </View>
    )
  }

  // Title/subtitle format: bold title on first line, subtitle on second
  if (title) {
    return (
      <View>
        <ThemedText style={[textStyle, { fontWeight: 'bold' }]}>
          {title}
        </ThemedText>
        {subtitle && (
          <ThemedText style={textStyle}>
            {subtitle}
          </ThemedText>
        )}
      </View>
    )
  }

  // Legacy format: userLabel + actionLabel in a row
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {userLabel && (
        <ThemedText style={[textStyle, { marginRight: 4 }]}>
          {userLabel}
        </ThemedText>
      )}
      {actionLabel && (
        <ThemedText style={role === Role.me ? ChatTheme.rightTextHighlighted : ChatTheme.leftTextHighlighted}>
          {actionLabel}
        </ThemedText>
      )}
    </View>
  )
}
