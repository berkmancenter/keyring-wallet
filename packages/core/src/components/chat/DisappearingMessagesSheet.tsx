import type { Agent } from '@credo-ts/core'
import { useAgent } from '@bifold/react-hooks'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView, TouchableOpacity } from 'react-native-gesture-handler'
import Toast from 'react-native-toast-message'

import { counterpartySpeaksChat } from '../../modules/chat/capability'
import { useChatEvents } from '../../modules/chat/chatEventsStore'
import { setChatTimer } from '../../modules/chat/send'
import { TIMER_CHOICES, timerOf } from '../../modules/chat/timer'
import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'
import { ToastType } from '../toast/BaseToast'
import { ChatIds } from './Chat.ids'
import { formatExpiresIn } from './disappearing'

// A contact's name is shown as they wrote it.
const asWritten = { interpolation: { escapeValue: false } }

export interface DisappearingMessagesSheetProps {
  visible: boolean
  connectionId: string
  /** The contact's name, as the chat shows it. */
  name: string
  onClose: () => void
}

/**
 * The chat's disappearing-messages setting (rich-messaging-plan.md §4.6): Off or one of the timer choices, for
 * messages sent from now on, on both phones. What the choice means is shown before it is saved, in the words the
 * setting promises. A contact whose Keyring does not speak keyring/chat/1.0 cannot honour a timer, so none is
 * offered.
 */
const DisappearingMessagesSheet: React.FC<DisappearingMessagesSheetProps> = ({ visible, onClose, ...rest }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    {/*
     * On Android a Modal is its own window, outside every gesture root above it: without this one, the
     * gesture-handler touchables here (the choices, Cancel and Save) never get a tap.
     */}
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Mounted afresh at each opening, so what it holds starts from the current setting. */}
      {visible && <SheetBody onClose={onClose} {...rest} />}
    </GestureHandlerRootView>
  </Modal>
)

const SheetBody: React.FC<Omit<DisappearingMessagesSheetProps, 'visible'>> = ({ connectionId, name, onClose }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const events = useChatEvents(connectionId)
  const current = useMemo(() => (events ? timerOf(events) : null), [events])
  const currentExpiresIn = current?.expiresIn ?? 0
  // Unknown until asked: nothing is offered before the answer.
  const [speaksChat, setSpeaksChat] = useState<boolean>()
  // What the person picked, or else the current setting: checked as it stands until they pick.
  const [picked, setPicked] = useState<number>()
  const selected = picked ?? currentExpiresIn
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!agent) return
    let live = true
    setSpeaksChat(undefined)
    counterpartySpeaksChat(agent as unknown as Agent, connectionId)
      .then((speaks) => live && setSpeaksChat(speaks))
      .catch(() => live && setSpeaksChat(false))
    return () => {
      live = false
    }
  }, [agent, connectionId])

  // A timer the other phone set to a length no choice offers (any from 1 hour to 4 weeks is valid) is shown as it
  // is, checked, above the choices.
  const offMenu = currentExpiresIn > 0 && !TIMER_CHOICES.includes(currentExpiresIn)
  const period = formatExpiresIn(t, selected)

  const save = async () => {
    if (!agent || saving) return
    setSaving(true)
    try {
      const outcome = await setChatTimer(agent as unknown as Agent, connectionId, selected)
      if (outcome.carriedAs === 'not-sent') {
        Toast.show({ type: ToastType.Warn, text1: t('Chat.DisappearingNeedsUpdate', { name, ...asWritten }) })
      }
      onClose()
    } catch (error) {
      agent.config?.logger?.warn(`[chat] disappearing messages not set: ${String(error)}`)
      Toast.show({ type: ToastType.Error, text1: t('Chat.DisappearingFailed') })
    } finally {
      setSaving(false)
    }
  }

  const choice = (expiresIn: number) => {
    const checked = selected === expiresIn
    const label = expiresIn === 0 ? t('Chat.DisappearingOff') : formatExpiresIn(t, expiresIn)
    return (
      <TouchableOpacity
        key={expiresIn}
        onPress={() => setPicked(expiresIn)}
        style={styles.choice}
        accessibilityRole="radio"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        testID={testIdWithKey(`${ChatIds.disappearingOption}-${expiresIn}`)}
      >
        <ThemedText style={styles.choiceText}>{label}</ThemedText>
        <ThemedText style={styles.check}>{checked ? '✓' : ''}</ThemedText>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet} testID={testIdWithKey(ChatIds.disappearing)}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText variant="headingFour">{t('Chat.DisappearingMessages')}</ThemedText>
          {speaksChat === false && <ThemedText>{t('Chat.DisappearingNeedsUpdate', { name, ...asWritten })}</ThemedText>}
          {speaksChat && (
            <>
              <View style={styles.choices} accessibilityRole="radiogroup">
                {offMenu && (
                  <TouchableOpacity
                    onPress={() => setPicked(currentExpiresIn)}
                    style={styles.choice}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected === currentExpiresIn }}
                    testID={testIdWithKey(ChatIds.disappearingCurrent)}
                  >
                    <ThemedText style={styles.choiceText}>
                      {current?.setBy === 'sent'
                        ? t('Chat.DisappearingCurrentByYou', {
                            period: formatExpiresIn(t, currentExpiresIn),
                            ...asWritten,
                          })
                        : t('Chat.DisappearingCurrentByThem', {
                            period: formatExpiresIn(t, currentExpiresIn),
                            name,
                            ...asWritten,
                          })}
                    </ThemedText>
                    <ThemedText style={styles.check}>{selected === currentExpiresIn ? '✓' : ''}</ThemedText>
                  </TouchableOpacity>
                )}
                {TIMER_CHOICES.map(choice)}
              </View>
              {selected > 0 ? (
                <>
                  <ThemedText>{t('Chat.DisappearingAbout', { period, name, ...asWritten })}</ThemedText>
                  <ThemedText>{t('Chat.DisappearingKept')}</ThemedText>
                </>
              ) : (
                <ThemedText>{t('Chat.DisappearingOffAbout')}</ThemedText>
              )}
            </>
          )}
        </ScrollView>
        <View style={styles.buttons}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.button}
            accessibilityRole="button"
            accessibilityLabel={t('Global.Cancel')}
            testID={testIdWithKey(ChatIds.disappearingCancel)}
          >
            <ThemedText style={styles.buttonText}>{t('Global.Cancel')}</ThemedText>
          </TouchableOpacity>
          {speaksChat && (
            <TouchableOpacity
              onPress={() => void save()}
              disabled={saving || selected === currentExpiresIn}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel={t('Global.Save')}
              accessibilityState={{ disabled: saving || selected === currentExpiresIn }}
              testID={testIdWithKey(ChatIds.disappearingSave)}
            >
              <ThemedText
                style={[styles.buttonText, styles.save, selected === currentExpiresIn && styles.buttonDisabled]}
              >
                {t('Global.Save')}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' },
  content: { padding: 20, gap: 12 },
  choices: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#CCCCCC', overflow: 'hidden' },
  choice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  choiceText: { flex: 1, fontSize: 17, color: '#222222' },
  check: { fontSize: 17, width: 24, textAlign: 'right' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, paddingBottom: 32 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 17 },
  save: { fontWeight: '600' },
  buttonDisabled: { opacity: 0.4 },
})

export default DisappearingMessagesSheet
