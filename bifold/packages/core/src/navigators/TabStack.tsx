import { useAgent } from '@bifold/react-hooks'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { AppState, Text, useWindowDimensions, View, StyleSheet, DeviceEventEmitter } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { AttachTourStep } from '../components/tour/AttachTourStep'
import { EventTypes } from '../constants'
import { TOKENS, useServices } from '../container-api'
import { useNetwork } from '../contexts/network'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { BifoldError } from '../types/error'
import { Screens, Stacks, TabStackParams, TabStacks } from '../types/navigators'
import { connectFromScanOrDeepLink } from '../utils/helpers'
import { findUsedInvitation, openUsedInvitation, usedInvitationToast } from '../utils/usedInvitation'
import { deepLinkCarriesInvitation, invitationLinkError } from '../utils/invitationLink'
import { appMessageWakeDeps, openMessageWake, type WakeNavigation } from '../utils/messageWake'
import { isOpenIdCredentialOffer } from '../utils/parsers'
import { testIdWithKey } from '../utils/testable'
import { useChatExpirySweep } from '../modules/chat/expiry'
import { useChatRetentionSweep } from '../modules/chat/retention'
import { vtaAgent } from '../modules/trust-tasks/module/vtaAgent'
import { isLinkOnline, useAgentPresence } from '../modules/trust-tasks/module/vtaPresence'
import { myAgentTabBadge, useWaitingRequestsCount } from '../modules/trust-tasks/module/waitingRequests'
import { SiblingNoticeHost } from '../modules/trust-tasks/screens/SiblingNoticeHost'
import { StepUpAskHost } from '../modules/trust-tasks/screens/StepUpAskHost'
import { VtaOfflineBanner } from '../modules/trust-tasks/screens/VtaStatus'
import { isMessagesLink, keyringAgentLinkKind, myAgentLinkParams } from '../modules/trust-tasks/module/vtiLinks'
import { linkNoticeToast, openKeyringLink, type KeyringLinkNotice } from '../modules/trust-tasks/module/keyringLinkOpen'
import { useVtiCardVault } from '../modules/trust-tasks/module/vtiCardVault'
import { useVtiWalletCards } from '../modules/trust-tasks/module/vtiWalletCards'
import { useCardAgentNames } from '../modules/trust-tasks/screens/cardAgentNames'
// How a community's card reads in the Wallet (registers itself on import).
import '../modules/trust-tasks/screens/communityCardDisplay'
import { useVtiPersonaInbox } from '../modules/trust-tasks/module/vtiPersonaInbox'
import { logHiddenVettingSeams } from '../modules/trust-tasks/hiddenVettingModules'
import { useVtiIdentityListeners } from '../modules/trust-tasks/module/vtiIdentityListeners'
import { useLookAtOtherAgents } from '../modules/trust-tasks/module/lookAtOtherAgents'
import { useVtiRefusedCardNotice } from '../modules/trust-tasks/screens/refusedCardNotice'
import { useVtiJoinedNotice } from '../modules/trust-tasks/screens/joinedNotice'
import { useVtiVetterGrantedNotice } from '../modules/trust-tasks/screens/vetterNotice'
import { useToastAboveTabBar } from '../modules/trust-tasks/screens/aboveTabBar'
import { useVtiRemovedNotice } from '../modules/trust-tasks/screens/removedNotice'
import { useVtiTurnedDownNotice } from '../modules/trust-tasks/screens/turnedDownNotice'
import { useRoomNotices } from '../modules/rooms/roomNotices'
import { useRoomsUnreadCount } from '../modules/rooms/useRoomRows'
import { communityTarget } from '../modules/trust-tasks/module/vtiCommunityLink'
import { useChosenCommunityDid } from '../modules/trust-tasks/screens/useCommunity'

import { useUnreadMessages } from '../hooks/useUnreadMessages'
import InAppMessageNotifier from '../components/InAppMessageNotifier'
import ContactStack from './ContactStack'
import CredentialStack from './CredentialStack'
import MessageStack from './MessageStack'
import MyAgentStack from './MyAgentStack'
import SettingStack from './SettingStack'
import { BaseTourID } from '../types/tour'
import QRCodeExchangeSlider from '../modules/vrc/components/QRCodeExchangeSlider'

const TabStack: React.FC = () => {
  const [{ enableImplicitInvitations, enableReuseConnections, vti }, logger, GlobalListener] = useServices([
    TOKENS.CONFIG,
    TOKENS.UTIL_LOGGER,
    TOKENS.COMPONENT_APP_GLOBAL_LISTENER,
  ])
  const { t } = useTranslation()
  // Bottom toasts sit clear of the tab bar (aboveTabBar).
  const toastBottomOffset = useToastAboveTabBar()
  const Tab = createBottomTabNavigator<TabStackParams>()
  const { assertNetworkConnected } = useNetwork()
  const { TabTheme, TextTheme, Assets, NavigationTheme, GradientTheme } = useTheme()
  const [store, dispatch] = useStore()
  const { agent } = useAgent()
  // Disappearing messages: due ones are deleted here, once unlocked, on each return to the foreground, and every minute.
  useChatExpirySweep(agent)
  // Keep messages: older chat messages are deleted here, once unlocked and on each return to the foreground.
  useChatRetentionSweep(agent, store.preferences.keepMessages)
  // What a community sends this phone's persona — a vetter grant, a membership —
  // is collected from unlock, not only while Vetting is open. A persona whose
  // agent refused this phone, did not answer, or is no longer linked is said
  // where its community is (PersonaAgentNotice), not as a toast over whatever
  // screen is open: one covered a contact's chat and its composer (IN-350).
  const onInboxError = useCallback(
    (e: unknown) => {
      logger.warn(`persona inbox: ${(e as Error)?.message ?? e}`)
    },
    [logger]
  )
  // The community chosen by a link before this launch comes back first.
  useEffect(() => {
    void communityTarget.restore()
  }, [])
  // The community a link chose (else the build's suggestion) gets the inbox.
  const inboxCommunityDid = useChosenCommunityDid(vti?.communityDid)
  useVtiPersonaInbox(agent, { mediatorDid: vti?.mediatorDid, communityDid: inboxCommunityDid, onError: onInboxError })
  // …and every other identity this phone holds listens on its own, so what a
  // community sends any of them arrives, whichever is chosen (IN-102).
  useVtiIdentityListeners(agent, vti?.mediatorDid)
  useLookAtOtherAgents(agent)
  // Each persona's cards are kept by its agent too, so a new phone can get them back (226).
  useVtiCardVault(agent)
  // …and shown in the Wallet while they stand, copied from the community store.
  useVtiWalletCards(agent)
  // …each saying which agent holds it, when there are several.
  useCardAgentNames(agent)
  // A delivered card the inbox did not keep is said in plain words.
  useVtiRefusedCardNotice()
  // This phone tells its agent it is here, from unlock (#10): registered once,
  // a heartbeat every five minutes, and SIBLING_SEEN when another device acts as it.
  // Keyed on the link being online, so the first beat goes out the moment the
  // link is back — at start the link is still being restored, and a beat then
  // found no agent and waited five minutes for the next.
  const linkOnline = useSyncExternalStore(vtaAgent.subscribe, () => isLinkOnline(vtaAgent.getState().link))
  const presencePort = useMemo(
    () => (agent && linkOnline ? () => vtaAgent.presencePort(agent) : undefined),
    [agent, linkOnline]
  )
  // A removed phone learns it from its next refused heartbeat, not only at its next sign-in.
  const presenceFailed = useCallback((error: unknown) => vtaAgent.presenceFailed(error), [])
  const presenceLog = useCallback((message: string) => agent?.config.logger.warn(message), [agent])
  const presenceLink = useCallback(() => vtaAgent.getState().link, [])
  useAgentPresence(presencePort, presenceFailed, presenceLog, presenceLink)
  // A community's removal notice is said in plain words when it arrives.
  useVtiRemovedNotice()
  // …and a community making this phone a member.
  useVtiJoinedNotice()
  // …and a community making this phone a vetter.
  useVtiVetterGrantedNotice()
  // …and a community turning a request down, once, when the app first learns it.
  useVtiTurnedDownNotice()
  // …and the member's rooms: a new offer, an admission, a post that didn't send. Runs the offers poll, so a new
  // offer is said from the start, not only once My Agent has been opened.
  useRoomNotices()
  const navigation = useNavigation<StackNavigationProp<TabStackParams>>()
  const { fontScale } = useWindowDimensions()
  const showLabels = fontScale * TabTheme.tabBarTextStyle.fontSize < 18
  // Two points each side of a tab's icon and label, so two labels shrunk to fill their slots stay apart. On the
  // container, not the label: padding inside an Android Text is left out when it sizes the text to fit, and the
  // label's last letter was clipped with no ellipsis ("Contact" for "Contacts" at font scale 1.15).
  const labelGap = { paddingHorizontal: 2 }
  const [showQRCodeBottomSheet, setShowQRCodeBottomSheet] = React.useState(false)
  const { totalUnread: peopleUnread } = useUnreadMessages()
  // Rooms shown in Messages add their posts by others the member hasn't seen; the badge and its spoken label say one
  // number (rooms in Messages, R1).
  const totalUnread = peopleUnread + useRoomsUnreadCount()
  // Requests waiting for this phone's decision: said on the tab, wherever the person is.
  const myAgentBadge = myAgentTabBadge(useWaitingRequestsCount(), t)
  const styles = StyleSheet.create({
    tabBarIcon: {
      flex: 1,
    },
    // One badge for every tab that counts something waiting.
    tabBarBadge: {
      backgroundColor: '#D21E30',
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '600',
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      lineHeight: 17,
    },
  })

  const handleDeepLink = useCallback(
    async (deepLink: string) => {
      logger.info(`Handling deeplink: ${deepLink}`)

      // A tapped message notification (MESSAGES_LINK): the Messages tab,
      // through the main stack so it comes above any open modal.
      // The wake carries no content, so the chat it is for is found after the
      // tap: the list at once, a pickup now, then the newest unread chat
      // (utils/messageWake.ts).
      if (isMessagesLink(deepLink)) {
        dispatch({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [undefined] })
        const nav = navigation as unknown as WakeNavigation
        if (!agent) {
          nav.navigate(Stacks.TabStack, { screen: TabStacks.MessageStack })
          return
        }
        void openMessageWake(
          appMessageWakeDeps({
            navigation: nav,
            agent,
            names: {
              tabStack: Stacks.TabStack,
              messageStack: TabStacks.MessageStack,
              contactStack: Stacks.ContactStack,
              chat: Screens.Chat,
            },
            log: (message, data) => logger.info(message, data),
          })
        ).then((outcome) => logger.info(`message wake: ${outcome}`))
        return
      }

      // An agent enrolment offer (keyring://vta/enrol?o=…), a community
      // invitation (keyring://vti/invitation?c=…), a vetter's ticket
      // (vetting-ticket:?…) or a bare DID the phone's camera opened through
      // the `did` scheme — ours, not DIDComm OOB links. The same routing the
      // scanner and the paste screen use, and the person is told what
      // happened: nothing on screen used to say a link had failed.
      if (keyringAgentLinkKind(deepLink)) {
        try {
          if (agent) {
            await openKeyringLink(
              deepLink,
              agent,
              // Through the main stack, as the scanner does: navigating to the
              // tabs pops whatever sits above them, so the screen a link opens
              // comes to the top. Navigating the tabs alone left it underneath
              // an open modal, where the person could not see it had worked.
              (destination) =>
                (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate(
                  Stacks.TabStack,
                  { screen: TabStacks.MyAgentStack, params: myAgentLinkParams(destination) }
                ),
              (notice: KeyringLinkNotice) => {
                if (notice.kind === 'unusable') logger.warn(`agent link not usable: ${notice.message ?? 'unreadable'}`)
                const toast = linkNoticeToast(notice, t, toastBottomOffset)
                if (toast === 'hide') Toast.hide()
                else Toast.show(toast)
              }
            )
          }
        } finally {
          dispatch({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [undefined] })
        }
        return
      }

      // If it's just the general link with no params, set link inactive and do nothing.
      // An OpenID credential offer carries none of these: it goes on to the
      // OpenID flow (an offer whose issuer is a community's DID was already
      // taken above, as ours).
      // Our short invitation links (/i/<id>) carry none of these: Credo fetches them.
      if (!deepLinkCarriesInvitation(deepLink) && !isOpenIdCredentialOffer(deepLink)) {
        dispatch({
          type: DispatchAction.ACTIVE_DEEP_LINK,
          payload: [undefined],
        })
        return
      }

      // An invitation cut or altered on its way is said for what it is, not
      // as "Unable to handle deeplink" (share link, build 265).
      const incomplete = invitationLinkError(deepLink, t)
      if (incomplete) {
        logger.warn(`deep link: ${incomplete.message}`)
        DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, incomplete)
        dispatch({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [undefined] })
        return
      }

      try {
        await connectFromScanOrDeepLink(
          deepLink,
          agent,
          logger,
          navigation,
          true, // isDeepLink
          enableImplicitInvitations,
          enableReuseConnections,
          store.preferences.walletName
        )
      } catch (err: unknown) {
        // An invitation taken before: open the contact it made, not "Unable to handle deeplink".
        const used = await findUsedInvitation(agent, err)
        if (used) {
          logger.info(`deep link: invitation ${used.invitationId} was already used`)
          openUsedInvitation(used, navigation as unknown as { navigate: (name: string, params?: object) => void })
          Toast.show(usedInvitationToast(used, t, toastBottomOffset))
          return
        }
        const error = new BifoldError(
          t('Error.Title1039'),
          t('Error.Message1039'),
          (err as Error)?.message ?? err,
          1039
        )
        DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
      } finally {
        dispatch({
          type: DispatchAction.ACTIVE_DEEP_LINK,
          payload: [undefined],
        })
      }
    },
    [
      agent,
      enableImplicitInvitations,
      enableReuseConnections,
      logger,
      navigation,
      store.preferences.walletName,
      t,
      dispatch,
      toastBottomOffset,
    ]
  )

  // A linked phone reconnects to its agent from start-up, and again whenever
  // the app returns to the foreground (plan §4.2) — not only when a screen
  // that needs the agent happens to be open.
  // Whether private vetting is in this build, said where an iPhone's report
  // can see it: through the agent's logger, once there is an agent.
  useEffect(() => logHiddenVettingSeams(agent), [agent])

  useEffect(() => {
    if (!agent || !store.authentication.didAuthenticate) return
    void vtaAgent.restore(agent)
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void vtaAgent.foregrounded(agent)
    })
    return () => subscription.remove()
  }, [agent, store.authentication.didAuthenticate])

  useEffect(() => {
    if (store.deepLink && agent && store.authentication.didAuthenticate) {
      handleDeepLink(store.deepLink)
    }
  }, [store.deepLink, agent, store.authentication.didAuthenticate, handleDeepLink])

  const GradientBg = GradientTheme?.HeaderBackground

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: GradientBg ? 'transparent' : NavigationTheme.colors.primary }}
      edges={['left', 'right', 'top']}
    >
      {GradientBg && <GradientBg style={StyleSheet.absoluteFillObject} />}
      <VtaOfflineBanner />
      {/* "Also open as you": the presence loop above emits it (#10, part F); each header shows the strip. */}
      <SiblingNoticeHost />
      {/* The agent asks to be sure it is the person before a task (a step-up, #200). */}
      <StepUpAskHost />
      <Tab.Navigator
        initialRouteName={TabStacks.ContactStack}
        screenOptions={{
          unmountOnBlur: true,
          tabBarStyle: {
            ...TabTheme.tabBarStyle,
          },
          tabBarActiveTintColor: TabTheme.tabBarActiveTintColor,
          tabBarInactiveTintColor: TabTheme.tabBarInactiveTintColor,
          header: () => null,
        }}
      >
        <Tab.Screen
          name={TabStacks.ContactStack}
          component={ContactStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <View
                style={{
                  ...TabTheme.tabBarContainerStyle,
                  ...labelGap,
                  justifyContent: showLabels ? 'flex-end' : 'center',
                }}
              >
                {focused ? (
                  <Assets.svg.contactsIconFocused height={20} width={20} fill={color} />
                ) : (
                  <Assets.svg.contactsIconOutline height={20} width={20} fill={color} />
                )}
                {showLabels && (
                  <Text
                    // One line in every language (all six labels): a long word ("Portefeuille") shrinks rather
                    // than breaking. 0.7 keeps it whole up to the largest text size that still shows labels
                    // (fontScale about 1.28). The gap between neighbours is the container's (labelGap), never
                    // the label's own padding: Android sizes the text without it and clipped a last letter.
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={{
                      ...TabTheme.tabBarTextStyle,
                      color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                      fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                    }}
                  >
                    {t('TabStack.Contacts')}
                  </Text>
                )}
              </View>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('TabStack.Contacts'),
            tabBarTestID: testIdWithKey('Contacts'),
          }}
        />
        <Tab.Screen
          name={TabStacks.MessageStack}
          component={MessageStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
            tabBarBadgeStyle: styles.tabBarBadge,
            tabBarIcon: ({ color, focused }) => (
              <AttachTourStep tourID={BaseTourID.HomeTour} index={0}>
                <View
                  style={{
                    ...TabTheme.tabBarContainerStyle,
                    ...labelGap,
                    justifyContent: showLabels ? 'flex-end' : 'center',
                  }}
                >
                  {focused ? (
                    <Assets.svg.tabFourFocusedIcon height={20} width={20} fill={color} />
                  ) : (
                    <Assets.svg.tabFourIcon height={20} width={20} fill={color} />
                  )}
                  {showLabels && (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      style={{
                        ...TabTheme.tabBarTextStyle,
                        color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                        fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                      }}
                    >
                      {t('TabStack.Messages')}
                    </Text>
                  )}
                </View>
              </AttachTourStep>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel:
              totalUnread > 0 ? `${t('TabStack.Messages')}, ${totalUnread} unread` : t('TabStack.Messages'),
            tabBarTestID: testIdWithKey('Message'),
          }}
        />
        <Tab.Screen
          name={TabStacks.ConnectStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <AttachTourStep tourID={BaseTourID.HomeTour} index={2}>
                <View
                  style={{
                    ...TabTheme.tabBarContainerStyle,
                    ...labelGap,
                    justifyContent: showLabels ? 'flex-end' : 'center',
                  }}
                >
                  <Assets.svg.tabTwoIcon height={20} width={20} fill={color} />
                  {showLabels && (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      style={{
                        ...TabTheme.tabBarTextStyle,
                        color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                        fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                      }}
                    >
                      {t('TabStack.QRCode')}
                    </Text>
                  )}
                </View>
              </AttachTourStep>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('TabStack.QRCode'),
            tabBarTestID: testIdWithKey('QR Code'),
          }}
          listeners={() => ({
            tabPress: (e) => {
              e.preventDefault()
              if (!assertNetworkConnected()) {
                return
              }
              setShowQRCodeBottomSheet(true)
            },
          })}
        >
          {() => <View />}
        </Tab.Screen>
        <Tab.Screen
          name={TabStacks.CredentialStack}
          component={CredentialStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <AttachTourStep tourID={BaseTourID.HomeTour} index={1}>
                <View
                  style={{
                    ...TabTheme.tabBarContainerStyle,
                    ...labelGap,
                    justifyContent: showLabels ? 'flex-end' : 'center',
                  }}
                >
                  {focused ? (
                    <Assets.svg.tabThreeFocusedIcon height={20} width={20} fill={color} />
                  ) : (
                    <Assets.svg.tabThreeIcon height={20} width={20} fill={color} />
                  )}
                  {showLabels && (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      style={{
                        ...TabTheme.tabBarTextStyle,
                        color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                        fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                      }}
                    >
                      {t('TabStack.Wallet')}
                    </Text>
                  )}
                </View>
              </AttachTourStep>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('TabStack.Wallet'),
            tabBarTestID: testIdWithKey('Wallet'),
          }}
        />
        <Tab.Screen
          name={TabStacks.MyAgentStack}
          component={MyAgentStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarBadge: myAgentBadge.badge,
            tabBarBadgeStyle: styles.tabBarBadge,
            tabBarIcon: ({ color, focused }) => (
              <View
                style={{
                  ...TabTheme.tabBarContainerStyle,
                  ...labelGap,
                  justifyContent: showLabels ? 'flex-end' : 'center',
                }}
              >
                <Icon name={focused ? 'shield-account' : 'shield-account-outline'} size={24} color={color} />
                {showLabels && (
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={{
                      ...TabTheme.tabBarTextStyle,
                      color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                      fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                    }}
                  >
                    {t('TabStack.MyAgent')}
                  </Text>
                )}
              </View>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: myAgentBadge.label,
            // A literal key, not the translated label: the tabs that pass a
            // translated string into testIdWithKey have locale-dependent
            // testIDs, which the e2e harness already works around.
            tabBarTestID: testIdWithKey('MyAgent'),
          }}
        />
        <Tab.Screen
          name={TabStacks.SettingStack}
          component={SettingStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <View
                style={{
                  ...TabTheme.tabBarContainerStyle,
                  ...labelGap,
                  justifyContent: showLabels ? 'flex-end' : 'center',
                }}
              >
                <Icon name={focused ? 'account-circle' : 'account-circle-outline'} size={26} color={color} />
                {showLabels && (
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={{
                      ...TabTheme.tabBarTextStyle,
                      color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                      fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                    }}
                  >
                    {t('Screens.Settings')}
                  </Text>
                )}
              </View>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('Screens.Settings'),
            tabBarTestID: testIdWithKey('Settings'),
          }}
        />
      </Tab.Navigator>
      <SafeAreaView style={{ backgroundColor: TabTheme.tabBarSecondaryBackgroundColor }} edges={['bottom']} />
      <QRCodeExchangeSlider
        visible={showQRCodeBottomSheet}
        onDismiss={() => setShowQRCodeBottomSheet(false)}
        navigation={navigation}
      />
      <InAppMessageNotifier />
      <GlobalListener />
    </SafeAreaView>
  )
}

export default TabStack
