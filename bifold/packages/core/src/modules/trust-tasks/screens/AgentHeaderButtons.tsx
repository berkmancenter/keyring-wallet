/**
 * The two corners of "Your agent"'s header (Alberto, 10-06): Join on one,
 * with a short menu of the two ways in ("I was invited", "Join a community"),
 * and a gear on the other that opens Agent settings, as other tabs keep their
 * own tools in the header. Before, both sat in the page: Join as a button in
 * the middle of it, and settings as a row at its foot that unfolded a long
 * list in place.
 *
 * Test ids: `AgentJoinCorner` (the Join button), `AgentJoinMenu`, the menu's
 * `AgentJoinMenuInvited` and `AgentJoinMenuJoin` (a phone that has not joined
 * yet also has the two doors in the page, `AgentInvited` and
 * `AgentJoinCommunity`), and `AgentSettings` on the gear.
 *
 * @module trust-tasks/screens/AgentHeaderButtons
 */
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

/** The gear: Agent settings. A dot when something there wants a look. */
export const AgentSettingsButton: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{ paddingHorizontal: 16, paddingVertical: 8 }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('VtaLink.AgentSettings')}
      testID={testIdWithKey('AgentSettings')}
    >
      <Icon name="cog-outline" size={26} color={ColorPalette.brand.headerIcon} />
    </Pressable>
  )
}

export interface JoinMenuButtonProps {
  /** An invitation is waiting: said on the menu's first line. */
  invitationText?: string
  /** Already a member somewhere: "Join another community". */
  member: boolean
  onInvited: () => void
  onJoin: () => void
}

/** Join, with the two ways in under it. */
export const JoinMenuButton: React.FC<JoinMenuButtonProps> = ({ invitationText, member, onInvited, onJoin }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { width } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ x: 16, y: 96 })
  const button = useRef<View>(null)
  const styles = StyleSheet.create({
    // An icon the gear's size: the header's corners are narrow (the title
    // takes 68% of the width), and "+ Join" in a pill was squeezed into a box
    // with its letters stacked (Pixel, 10-06). The menu says what it offers.
    button: { paddingHorizontal: 16, paddingVertical: 8 },
    scrim: { flex: 1 },
    menu: {
      position: 'absolute',
      minWidth: 240,
      maxWidth: width - 32,
      borderRadius: 12,
      paddingVertical: 6,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      shadowColor: ColorPalette.grayscale.black,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 12,
      shadowOpacity: 0.2,
      elevation: 8,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      minHeight: 52,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: ColorPalette.grayscale.lightGrey,
      marginHorizontal: 16,
    },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const show = () => {
    // Under the button, wherever the header put it.
    button.current?.measureInWindow?.((x, y, _w, h) => {
      if (Number.isFinite(x) && Number.isFinite(y)) setAnchor({ x: Math.max(16, x), y: y + h + 6 })
    })
    setOpen(true)
  }
  const choose = (then: () => void) => {
    setOpen(false)
    then()
  }
  return (
    <>
      <Pressable
        ref={button}
        style={styles.button}
        hitSlop={8}
        onPress={show}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('VtaLink.JoinCorner')}
        testID={testIdWithKey('AgentJoinCorner')}
      >
        <Icon name="account-multiple-plus-outline" size={26} color={ColorPalette.brand.headerIcon} />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={t('Global.Close')}
          testID={testIdWithKey('AgentJoinMenuClose')}
        />
        <View style={[styles.menu, { left: anchor.x, top: anchor.y }]} testID={testIdWithKey('AgentJoinMenu')}>
          <Pressable
            style={styles.item}
            onPress={() => choose(onInvited)}
            accessibilityRole="menuitem"
            testID={testIdWithKey('AgentJoinMenuInvited')}
          >
            <Icon name="email-open-outline" size={22} color={ColorPalette.brand.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText variant="bold">{t('VtaLink.IWasInvited')}</ThemedText>
              <ThemedText
                style={styles.muted}
                testID={invitationText ? testIdWithKey('AgentJoinMenuInvitationWaiting') : undefined}
              >
                {invitationText ?? t('VtaLink.IWasInvitedHint')}
              </ThemedText>
            </View>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.item}
            onPress={() => choose(onJoin)}
            accessibilityRole="menuitem"
            testID={testIdWithKey('AgentJoinMenuJoin')}
          >
            <Icon name="account-group-outline" size={22} color={ColorPalette.brand.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText variant="bold">{member ? t('VtaLink.JoinAnother') : t('VtaLink.WantToJoin')}</ThemedText>
              <ThemedText style={styles.muted}>{t('VtaLink.WantToJoinHint')}</ThemedText>
            </View>
          </Pressable>
        </View>
      </Modal>
    </>
  )
}
