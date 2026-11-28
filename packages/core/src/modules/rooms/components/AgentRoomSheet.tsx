/**
 * The add sheet, "Add "<name>" to this room?" (step 7.13; canvas frame 35; the plan's name for it, PLAN:984): what
 * adding the agent lets it reach, then "Add to room" or "Not now", and, when the add comes back with anything but
 * `'added'`, that outcome's own line and "Done".
 *
 * A view, and not reachable yet: the add flow feeds it from fb's `useAddAgentToRoom(roomId)` once that hook merges
 * (backlog 3, Section B, Part T1). It never calls the hook: "Add to room" calls `onAdd`, and the caller passes back
 * what the add came to as `outcome`.
 *
 * @module rooms/components/AgentRoomSheet
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityInfo, ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar } from '../../connected-agents/components/AgentMark'
import { AGENT_COLORS } from '../../connected-agents/components/agentStyle'

// What fb's `useAddAgentToRoom(roomId).add(agentId)` resolves to, exactly as the seam gives it (backlog 3, Section B,
// "The result types, exactly"). Declared here, once; later tracks import it from this file.
export type AddRoomOutcome =
  | 'added'
  | 'refused'
  | 'unreachable'
  | 'accessChanged'
  | 'settingNo'
  | 'settingNotStated'
  | 'notAddable'

/**
 * Each outcome but `'added'`, and its own line (Part T1's table). A record over the type, so an outcome the table does
 * not name fails to compile here rather than falling to a generic line.
 */
const OUTCOME_LINE: Record<Exclude<AddRoomOutcome, 'added'>, string> = {
  refused: 'ConnectedAgents.AddRoomRefused',
  unreachable: 'ConnectedAgents.AddRoomUnreachable',
  notAddable: 'ConnectedAgents.AddRoomNotAddable',
  accessChanged: 'ConnectedAgents.MemoryAccessChanged',
  settingNo: 'ConnectedAgents.CommunityNo',
  settingNotStated: 'ConnectedAgents.CommunityNotStated',
}

export interface AgentRoomSheetProps {
  /** The agent's name, as the owner gave it. */
  name: string
  /** The persona the owner acts as in this room, by its name (`useRoomAgents`' `persona`). */
  persona: string
  /**
   * `RoomAgentAddable.widens?.context`: the persona's context, given when this add is the agent's first room of the
   * persona and so also grants that memory. Absent when the agent can already use the persona's rooms.
   */
  widensContext?: string
  /** What the add came to, once `onAdd`'s call has answered; absent before. */
  outcome?: AddRoomOutcome
  /** "Add to room": the caller runs the add. Called at most once in the sheet's life. */
  onAdd: () => void
  /** "Not now", "Done" after an outcome, or the screen reader's escape gesture: closes the sheet. */
  onClose: () => void
  /**
   * "See details", drawn only with `'accessChanged'`: the caller opens the agent's details, where "Restore" is. Not in
   * Part T1's prop list, which names the button but not its callback (decided here; said in the PR).
   */
  onSeeDetails: () => void
}

// Canvas frame 35, drawn at 2x like the Revoke and Delete sheets: 16 pt sides, a 22 pt title beside the robot, the
// notices boxed in amber, the members line plain, and two full-width 52 pt buttons, "Add to room" filled in Keyring's
// purple and "Not now" outlined.
const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleBox: { flex: 1 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 22, lineHeight: 28, color: AGENT_COLORS.text },
  notice: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FFF6E5',
    borderWidth: 1,
    borderColor: '#F2C66D',
    borderRadius: 10,
    padding: 12,
  },
  noticeText: {
    flex: 1,
    fontFamily: 'SourceSans3-Regular',
    fontSize: 17,
    lineHeight: 24,
    color: AGENT_COLORS.warnText,
  },
  plain: { flexDirection: 'row', gap: 10 },
  plainText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 16, lineHeight: 22, color: AGENT_COLORS.text },
  outcome: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 24, color: AGENT_COLORS.text },
  buttons: { gap: 12 },
  button: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primary: { backgroundColor: AGENT_COLORS.primary },
  primaryText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: '#FFFFFF' },
  secondary: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary },
  secondaryText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.primary },
  disabled: { opacity: 0.5 },
})

const AgentRoomSheet: React.FC<AgentRoomSheetProps> = ({
  name,
  persona,
  widensContext,
  outcome,
  onAdd,
  onClose,
  onSeeDetails,
}) => {
  const { t } = useTranslation()
  // Once in the sheet's life: the ref holds before the re-render that disables the button, so a second press in the
  // same frame sends nothing. Starting an add again from room info is a new sheet, not a retry inside this one.
  const sent = useRef(false)
  const [running, setRunning] = useState(false)
  const title = useRef<View>(null)

  // The sheet's first focus is its title, and no button takes it: the notices are read before "Add to room" can be
  // focused (PLAN:1361).
  useEffect(() => {
    if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus')
  }, [])

  const add = () => {
    if (sent.current) return
    sent.current = true
    setRunning(true)
    onAdd()
  }

  const button = (
    label: string,
    onPress: () => void,
    testID: string,
    kind: 'primary' | 'secondary',
    disabled = false
  ) => (
    <TouchableOpacity
      style={[styles.button, styles[kind], disabled ? styles.disabled : null]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: disabled && kind === 'primary' && running }}
    >
      {disabled && kind === 'primary' && running ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <ThemedText style={kind === 'primary' ? styles.primaryText : styles.secondaryText}>{label}</ThemedText>
      )}
    </TouchableOpacity>
  )

  // Anything but 'added' spends the action: the outcome's own line replaces the buttons, with one "Done", and "Add to
  // room" does not come back (a refusal spends the action, #1110). There is no "Try again".
  const spent = outcome !== undefined && outcome !== 'added' ? outcome : undefined

  return (
    <View
      style={styles.sheet}
      testID={testIdWithKey('AgentRoomSheet')}
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
    >
      <View style={styles.head}>
        <AgentAvatar size={44} />
        <View ref={title} style={styles.titleBox} accessible accessibilityRole="header">
          <ThemedText style={styles.title}>{t('ConnectedAgents.AddToRoomTitle', { name })}</ThemedText>
        </View>
      </View>
      <View style={styles.notice} testID={testIdWithKey('AgentRoomSheetReach')}>
        <Icon name="eye-outline" size={24} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
        <ThemedText style={styles.noticeText}>
          {widensContext !== undefined
            ? t('ConnectedAgents.AddToRoomBodyAllRooms', { persona })
            : t('ConnectedAgents.AddToRoomBodyAlready', { persona })}
        </ThemedText>
      </View>
      {widensContext !== undefined ? (
        <View style={styles.notice} testID={testIdWithKey('AgentRoomSheetMemory')}>
          <Icon name="layers-outline" size={24} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
          <ThemedText style={styles.noticeText}>
            {t('ConnectedAgents.AddRoomMemoryNotice', { context: widensContext })}
          </ThemedText>
        </View>
      ) : null}
      <View style={styles.plain}>
        <Icon name="account-multiple-outline" size={24} color={AGENT_COLORS.primary} accessibilityElementsHidden />
        <ThemedText style={styles.plainText}>{t('ConnectedAgents.MembersWillSee')}</ThemedText>
      </View>
      {spent ? (
        <>
          <ThemedText
            style={styles.outcome}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            testID={testIdWithKey('AgentRoomSheetOutcome')}
          >
            {t(OUTCOME_LINE[spent], { name })}
          </ThemedText>
          <View style={styles.buttons}>
            {/* A repair: the read-back of `act` was not exactly the bound memories plus the persona's context
                (PLAN:1361). It can happen when the VTA's entry was changed outside Keyring; the caller of the repair
                is `useAgentActions().restore`, from AgentDetails' "Restore", which "See details" opens. */}
            {spent === 'accessChanged'
              ? button(
                  t('ConnectedAgents.SeeDetails'),
                  onSeeDetails,
                  testIdWithKey('AgentRoomSheetSeeDetails'),
                  'secondary'
                )
              : null}
            {button(t('Global.Done'), onClose, testIdWithKey('AgentRoomSheetDone'), 'primary')}
          </View>
        </>
      ) : (
        <View style={styles.buttons}>
          {/* Off while the add runs, and once it came back 'added' (the flow then moves on): never a double add. */}
          {button(
            t('ConnectedAgents.AddToRoom'),
            add,
            testIdWithKey('AgentRoomSheetAdd'),
            'primary',
            running || outcome === 'added'
          )}
          {button(t('Global.NotNow'), onClose, testIdWithKey('AgentRoomSheetNotNow'), 'secondary')}
        </View>
      )}
    </View>
  )
}

export default AgentRoomSheet
