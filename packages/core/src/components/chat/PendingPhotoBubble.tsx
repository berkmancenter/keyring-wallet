/**
 * A photo on its way (the photo-sending mock): in the chat from the moment it is picked, dimmed, with a turning ring
 * and what is happening under it. While it is made ready it can be stopped; once it is being sent it can't (the
 * message can't be called back), so the ring has no stop. A send that failed says so on the bubble, with a red mark;
 * a tap offers Try again, Delete from this chat, or Not now. There is no percentage: the send reports none.
 *
 * @module components/chat/PendingPhotoBubble
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../contexts/theme'
import type { PendingStage } from '../../modules/chat/media/pending'
import { testIdWithKey } from '../../utils/testable'
import Button, { ButtonType } from '../buttons/Button'
import { ThemedText } from '../texts/ThemedText'

import { ChatIds } from './Chat.ids'

export interface PhotoSending {
  stage: PendingStage
  onStop?: () => void
  onRetry?: () => void
  onDelete?: () => void
}

export const PendingPhotoBubble: React.FC<{
  uri: string
  size: { width: number; height: number }
  sending: PhotoSending
}> = ({ uri, size, sending }) => {
  const { t } = useTranslation()
  const { ColorPalette, ChatTheme } = useTheme()
  const [asking, setAsking] = useState(false)
  const failed = sending.stage === 'failed'
  const status = failed
    ? t('Chat.PhotoNotSentTap')
    : sending.stage === 'preparing'
      ? t('Chat.PhotoPreparing')
      : t('Chat.PhotoSending')
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
    frame: { ...ChatTheme.rightBubble, padding: 4, borderRadius: 16, minHeight: 0, marginRight: 0 },
    photo: { ...size, borderRadius: 12, opacity: failed ? 0.85 : 0.6 },
    ring: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disc: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    status: { textAlign: 'right', marginTop: 4 },
    // At most most of the screen, its words scrolling with the buttons last: at the largest text the sheet reached
    // under the status bar.
    sheet: {
      maxHeight: '92%',
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    sheetContent: { padding: 20, gap: 12 },
  })

  const bubble = (
    <View style={styles.frame}>
      <Image
        source={{ uri }}
        style={styles.photo}
        accessibilityIgnoresInvertColors
        testID={testIdWithKey(ChatIds.pendingPhoto)}
      />
      {failed ? null : (
        <View style={styles.ring} pointerEvents="box-none">
          {sending.onStop ? (
            <Pressable
              style={styles.disc}
              onPress={sending.onStop}
              accessibilityRole="button"
              accessibilityLabel={t('Chat.PhotoStop')}
              testID={testIdWithKey(ChatIds.pendingPhotoStop)}
            >
              <ActivityIndicator color={ColorPalette.grayscale.white} style={{ position: 'absolute' }} size="large" />
              <Icon name="close" size={20} color={ColorPalette.grayscale.white} />
            </Pressable>
          ) : (
            <View style={styles.disc} accessibilityElementsHidden importantForAccessibility="no">
              <ActivityIndicator color={ColorPalette.grayscale.white} size="large" />
            </View>
          )}
        </View>
      )}
    </View>
  )

  return (
    <View style={{ paddingHorizontal: 8, marginVertical: 4 }}>
      {failed ? (
        <Pressable
          style={styles.row}
          onPress={() => setAsking(true)}
          accessibilityRole="button"
          accessibilityLabel={`${t('Chat.Photo')}, ${status}`}
          testID={testIdWithKey(ChatIds.pendingPhotoFailed)}
        >
          <Icon name="alert-circle" size={26} color={ColorPalette.semantic.error} />
          {bubble}
        </Pressable>
      ) : (
        <View style={styles.row} accessible accessibilityLabel={`${t('Chat.Photo')}, ${status}`}>
          {bubble}
        </View>
      )}
      <ThemedText
        variant="labelSubtitle"
        style={[styles.status, { color: failed ? ColorPalette.semantic.error : ColorPalette.grayscale.mediumGrey }]}
        accessibilityLiveRegion="polite"
        testID={testIdWithKey(ChatIds.pendingPhotoStatus)}
      >
        {status}
      </ThemedText>
      <Modal visible={asking} transparent animationType="slide" onRequestClose={() => setAsking(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.35)' }}
          onPress={() => setAsking(false)}
          accessibilityRole="button"
          accessibilityLabel={t('Global.NotNow')}
          testID={testIdWithKey(ChatIds.pendingPhotoBackdrop)}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testIdWithKey(ChatIds.pendingPhotoSheet)}>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            testID={testIdWithKey(ChatIds.pendingPhotoSheetScroll)}
          >
            <ThemedText variant="headingFour" accessibilityRole="header">
              {t('Chat.PhotoFailedTitle')}
            </ThemedText>
            <ThemedText>{t('Chat.PhotoFailedBody')}</ThemedText>
            <Button
              title={t('Chat.PhotoTryAgain')}
              buttonType={ButtonType.Primary}
              onPress={() => {
                setAsking(false)
                sending.onRetry?.()
              }}
              testID={testIdWithKey(ChatIds.pendingPhotoRetry)}
            />
            <Button
              title={t('Chat.PhotoDelete')}
              buttonType={ButtonType.Secondary}
              onPress={() => {
                setAsking(false)
                sending.onDelete?.()
              }}
              testID={testIdWithKey(ChatIds.pendingPhotoDelete)}
            />
            <Button
              title={t('Global.NotNow')}
              buttonType={ButtonType.Tertiary}
              onPress={() => setAsking(false)}
              testID={testIdWithKey(ChatIds.pendingPhotoNotNow)}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  )
}

export default PendingPhotoBubble
