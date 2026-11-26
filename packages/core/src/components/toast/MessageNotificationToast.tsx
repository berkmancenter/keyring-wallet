import React from 'react'
import { View, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import Toast from 'react-native-toast-message'

import { useTheme } from '../../contexts/theme'
import { ThemedText } from '../texts/ThemedText'

interface MessageNotificationToastProps {
  text1?: string
  text2?: string
  onPress?: () => void
  props?: {
    senderInitial?: string
  }
}

const MessageNotificationToast: React.FC<MessageNotificationToastProps> = ({
  text1,
  text2,
  onPress,
  props,
}) => {
  const { width } = useWindowDimensions()
  const { ColorPalette } = useTheme()
  const initial = props?.senderInitial ?? text1?.replace('New message from ', '').charAt(0).toUpperCase() ?? '?'

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={() => {
        onPress?.()
      }}
      style={[styles.container, { width: width - 32 }]}
    >
      <View style={[styles.avatarCircle, { backgroundColor: ColorPalette.brand.primary }]}>
        <ThemedText style={styles.avatarText}>{initial}</ThemedText>
      </View>
      <View style={styles.content}>
        {text1 && (
          <ThemedText style={styles.senderName} numberOfLines={1}>
            {text1}
          </ThemedText>
        )}
        {text2 && (
          <ThemedText style={styles.messagePreview} numberOfLines={2}>
            {text2}
          </ThemedText>
        )}
      </View>
      <TouchableOpacity
        onPress={() => Toast.hide()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.dismissButton}
      >
        <Icon name="close" size={18} color="#999" />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginTop: 50,
    marginHorizontal: 16,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  senderName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  messagePreview: {
    fontSize: 13,
    fontWeight: '400',
    color: '#666666',
    lineHeight: 18,
  },
  dismissButton: {
    padding: 4,
    alignSelf: 'flex-start',
  },
})

export default MessageNotificationToast
