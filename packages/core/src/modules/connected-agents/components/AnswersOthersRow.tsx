import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Switch, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

/** What `useAnswersOthers(agentId).set(on)` answers (backlog 3 Section B, the seam with fb, T3). */
export type AnswersOthersSetResult = 'saved' | 'notSaved'

/** The state `useAnswersOthers(agentId)` returns, without its `set` (backlog 3 Section B, "The result types, exactly"). */
export interface AnswersOthersState {
  /** As stored on the phone. */
  value: boolean
  /** False: "Off", and no switch (the hook check of step 0.3(f) failed). */
  offered: boolean
  /** Stored, not yet sent to the agent (backlog 3 ruling 3). */
  pending: boolean
}

export interface AnswersOthersRowProps extends AnswersOthersState {
  /** The agent's name, for the help and pending lines. */
  name: string
  /** The last change came back `'notSaved'`: the caller sets it until the next change. The switch stays at `value`. */
  notSaved: boolean
  /** The switch moved to On: the caller opens AnswersOthersConfirmSheet; nothing is changed here. */
  onTurnOn: () => void
  /** The switch moved to Off: the caller calls `set(false)` at once, with no confirmation (PLAN:1041). */
  onTurnOff: () => void
}

// Canvas frames 14 and 16: a white card with a 1 pt grey edge, the title in bold on the left and "Off" / "On" with the
// switch on the right, the help under it; "WHAT OTHERS SEE" in small capitals, then the fixed reply in a dashed box.
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9D9DE',
    padding: 14,
    gap: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  title: { flex: 1, fontFamily: 'SourceSans3-Bold', fontSize: 18, lineHeight: 24, color: AGENT_COLORS.text },
  value: { fontFamily: 'SourceSans3-Regular', fontSize: 17, color: AGENT_COLORS.muted },
  help: { fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.muted },
  note: { fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.warnText },
  heading: {
    fontFamily: 'SourceSans3-Bold',
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: AGENT_COLORS.muted,
    paddingTop: 6,
  },
  reply: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B9B9C0',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#F7F7F8',
  },
  replyText: { fontFamily: 'SourceSans3-Regular', fontSize: 16, lineHeight: 22, color: AGENT_COLORS.text },
})

/**
 * "Answers other people" (§3.13, §6; step 7.14; canvas frame 14's card, and frame 16 in the details): the setting, its
 * value with a switch, the help for the value, the pending and not-saved lines, then "What others see" with the fixed
 * reply the plugin sends while it is off. A view: the value is the caller's, from `useAnswersOthers`, and the switch is
 * held at it, so a change that was not saved leaves the switch where it was.
 *
 * Turning it on only calls `onTurnOn`, for the caller to ask first (AnswersOthersConfirmSheet, frame 15); turning it off
 * calls `onTurnOff` at once.
 */
const AnswersOthersRow: React.FC<AnswersOthersRowProps> = ({
  name,
  value,
  offered,
  pending,
  notSaved,
  onTurnOn,
  onTurnOff,
}) => {
  const { t } = useTranslation()
  // A repair (D23, PLAN:774: "would read 'Off' with no way to turn it on"). `offered` is false only when the plugin's
  // hook check failed, and the caller is fb's hook-check value in `useAnswersOthers` (true today: 0.3(f) is measured).
  // The setting then reads Off whatever is stored, since the plugin will not act on On, and there is no switch.
  const on = offered && value
  const valueWord = on ? t('ConnectedAgents.AnswersOn') : t('ConnectedAgents.AnswersOff')

  return (
    <View style={styles.card} testID={testIdWithKey('AnswersOthers')}>
      <View style={styles.top}>
        <ThemedText style={styles.title} accessibilityRole="header">
          {t('ConnectedAgents.AnswersOthers')}
        </ThemedText>
        <ThemedText style={styles.value} testID={testIdWithKey('AnswersOthersValue')}>
          {valueWord}
        </ThemedText>
        {offered ? (
          <Switch
            value={value}
            onValueChange={(next) => (next ? onTurnOn() : onTurnOff())}
            trackColor={{ false: '#8E8E93', true: AGENT_COLORS.primary }}
            thumbColor="#FFFFFF"
            ios_backgroundColor="#8E8E93"
            accessibilityRole="switch"
            accessibilityLabel={t('ConnectedAgents.AnswersOthers')}
            accessibilityState={{ checked: value }}
            testID={testIdWithKey('AnswersOthersSwitch')}
          />
        ) : null}
      </View>
      <ThemedText style={styles.help} testID={testIdWithKey('AnswersOthersHelp')}>
        {on ? t('ConnectedAgents.AnswersOnHelp', { name }) : t('ConnectedAgents.AnswersOffHelp', { name })}
      </ThemedText>
      {pending ? (
        <ThemedText style={styles.note} testID={testIdWithKey('AnswersOthersPending')}>
          {t('ConnectedAgents.AnswersOthersPending', { name })}
        </ThemedText>
      ) : null}
      {notSaved ? (
        <ThemedText style={styles.note} accessibilityRole="alert" testID={testIdWithKey('AnswersOthersNotSaved')}>
          {t('ConnectedAgents.AnswersOthersNotSaved')}
        </ThemedText>
      ) : null}
      <ThemedText style={styles.heading} accessibilityRole="header" testID={testIdWithKey('WhatOthersSee')}>
        {t('ConnectedAgents.WhatOthersSee')}
      </ThemedText>
      <View style={styles.reply}>
        <ThemedText style={styles.replyText}>{t('ConnectedAgents.OthersReply')}</ThemedText>
      </View>
    </View>
  )
}

export default AnswersOthersRow
