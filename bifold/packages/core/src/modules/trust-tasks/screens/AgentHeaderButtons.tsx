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
import { hitSlop } from '../../../constants'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

/** The Join menu's width, in points, on a screen wide enough for it. */
const MENU_WIDTH = 320

/**
 * The corners' buttons, sized as the app's own header buttons (IconButton):
 * the icon, and a margin on the screen's side only. The header gives each
 * corner what the title (68% of the width) leaves, and with padding on both
 * sides the icons were clipped at the edge (236, iPhone and Pixel). The tap
 * area stays large through `hitSlop`.
 */
const ICON_SIZE = 26
const corner = StyleSheet.create({
  left: { marginLeft: 15, paddingVertical: 8 },
  right: { marginRight: 15, paddingVertical: 8 },
})

/** The gear: Agent settings. A dot when something there wants a look. */
export const AgentSettingsButton: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={corner.right}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={t('VtaLink.AgentSettings')}
      testID={testIdWithKey('AgentSettings')}
    >
      <Icon name="cog-outline" size={ICON_SIZE} color={ColorPalette.brand.headerIcon} />
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
  // A set width: sized to its content, the menu's second item ran out of the
  // box and over the page on Android (Pixel, 236 build), its wrapped hint
  // taller than the box was laid out for. It stays on screen whatever the
  // corner's place.
  const menuWidth = Math.min(MENU_WIDTH, width - 32)
  const styles = StyleSheet.create({
    // An icon the gear's size: the header's corners are narrow, and "+ Join"
    // in a pill was squeezed into a box with its letters stacked (Pixel,
    // 10-06). The menu says what it offers.
    scrim: { flex: 1 },
    menu: {
      position: 'absolute',
      width: menuWidth,
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
        style={corner.left}
        hitSlop={hitSlop}
        onPress={show}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('VtaLink.JoinCorner')}
        testID={testIdWithKey('AgentJoinCorner')}
      >
        <Icon name="account-multiple-plus-outline" size={ICON_SIZE} color={ColorPalette.brand.headerIcon} />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={t('Global.Close')}
          testID={testIdWithKey('AgentJoinMenuClose')}
        />
        <View
          style={[styles.menu, { left: Math.max(16, Math.min(anchor.x, width - menuWidth - 16)), top: anchor.y }]}
          testID={testIdWithKey('AgentJoinMenu')}
        >
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
