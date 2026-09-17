import {
  DispatchAction,
  SafeAreaModal,
  Screens,
  testIdWithKey,
  TOKENS,
  useServices,
  useStore,
  useTheme,
  seedTestContacts,
  clearTestContacts,
  setTspCarriageEnabled,
  setDidCommV2Enabled,
  vtaAgent,
} from '@bifold/core'
import { RemoteLogger, RemoteLoggerEventTypes } from '@bifold/remote-logs'
import {
  createVtiClientDid,
  resolveVtiMediator,
  vtiClientIdentityFromDid,
  VtiMediatorSession,
  VtaClient,
  GenericRecordsIdentityStore,
  vtiClientIdentityFromPersona,
  vtiAgent,
} from '@bifold/core'
import { utils } from '@credo-ts/core'
import Config from 'react-native-config'
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'

import { BCDispatchAction, BCState } from '@/store'
import IASEnvironment from './IASEnvironment'
import RemoteLogWarning from './RemoteLogWarning'

const Developer: React.FC = () => {
  const { t } = useTranslation()
  const [store, dispatch] = useStore<BCState>()
  const { SettingsTheme, TextTheme, ColorPalette } = useTheme()
  const [logger] = useServices([TOKENS.UTIL_LOGGER]) as [RemoteLogger]
  const { agent } = useAgent()
  const [environmentModalVisible, setEnvironmentModalVisible] = useState<boolean>(false)
  const [devMode, setDevMode] = useState<boolean>(true)
  const [useVerifierCapability, setUseVerifierCapability] = useState<boolean>(!!store.preferences.useVerifierCapability)
  const [acceptDevCredentials, setAcceptDevCredentials] = useState<boolean>(!!store.preferences.acceptDevCredentials)
  const [useConnectionInviterCapability, setConnectionInviterCapability] = useState(
    !!store.preferences.useConnectionInviterCapability
  )
  const [remoteLoggingWarningModalVisible, setRemoteLoggingWarningModalVisible] = useState(false)
  const [useDevVerifierTemplates, setDevVerifierTemplates] = useState(!!store.preferences.useDevVerifierTemplates)
  const [enableWalletNaming, setEnableWalletNaming] = useState(!!store.preferences.enableWalletNaming)
  const [preventAutoLock, setPreventAutoLock] = useState(!!store.preferences.preventAutoLock)
  const [remoteLoggingEnabled, setRemoteLoggingEnabled] = useState(logger?.remoteLoggingEnabled)
  const [enableShareableLink, setEnableShareableLink] = useState(!!store.preferences.enableShareableLink)
  const [enableProxy, setEnableProxy] = useState(!!store.developer.enableProxy)
  const [enableAppToAppPersonFlow, setEnableAppToAppPersonFlow] = useState(!!store.developer.enableAppToAppPersonFlow)
  const [enableTspCarriage, setEnableTspCarriage] = useState(!!store.developer.enableTspCarriage)
  const [enableDidCommV2, setEnableDidCommV2] = useState(!!store.developer.enableDidCommV2)
  const [isSeedingContacts, setIsSeedingContacts] = useState(false)
  const [isProbingVta, setIsProbingVta] = useState(false)
  // The probe's stages, on screen as well as in the log: a simulator has no
  // logcat and React Native's console output never reaches the unified log, so
  // a run on iOS can only assert what the screen shows.
  const [vtaProbeLog, setVtaProbeLog] = useState<string[]>([])
  // The manager probe: the phone as the manager of ITS OWN VTA (§2.4 B). Two
  // halves, because enrolment sits between them — the phone shows the identity
  // it minted, the VTA's operator admits it, then the phone connects.
  const [isProbingManager, setIsProbingManager] = useState(false)
  const [managerProbeLog, setManagerProbeLog] = useState<string[]>([])
  const [isClearingContacts, setIsClearingContacts] = useState(false)
  const navigation = useNavigation()

  const styles = StyleSheet.create({
    container: {
      backgroundColor: ColorPalette.brand.primaryBackground,
      width: '100%',
    },
    section: {
      backgroundColor: SettingsTheme.groupBackground,
      padding: 24,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 0,
    },
    sectionSeparator: {
      marginBottom: 10,
    },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowTitle: {
      ...TextTheme.headingFour,
      flex: 1,
      fontWeight: 'normal',
      flexWrap: 'wrap',
    },
    rowSeparator: {
      borderBottomWidth: 1,
      borderBottomColor: ColorPalette.brand.primaryBackground,
      marginHorizontal: 24,
    },
    logo: {
      height: 64,
      width: '50%',
      marginVertical: 16,
    },
    footer: {
      marginVertical: 25,
      alignItems: 'center',
    },
  })

  const shouldDismissModal = () => {
    setEnvironmentModalVisible(false)
  }

  const SectionHeader = ({ icon, title }: { icon: string; title: string }): React.JSX.Element => (
    <View style={[styles.section, styles.sectionHeader]}>
      <Icon name={icon} size={24} style={{ marginRight: 10, color: TextTheme.normal.color }} />
      <Text style={[TextTheme.headingThree, { flexShrink: 1 }]}>{title}</Text>
    </View>
  )

  interface SectionRowProps {
    title: string
    accessibilityLabel?: string
    testID?: string
    children: React.JSX.Element
    showRowSeparator?: boolean
    subContent?: React.JSX.Element
    onPress?: () => void
  }
  const SectionRow = ({
    title,
    accessibilityLabel,
    testID,
    onPress,
    children,
    showRowSeparator,
    subContent,
  }: SectionRowProps) => (
    <>
      <View style={styles.section}>
        <View style={{ flexDirection: 'row' }}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Pressable
            onPress={onPress}
            accessible={true}
            accessibilityLabel={accessibilityLabel}
            testID={testID}
            style={styles.sectionRow}
          >
            {children}
          </Pressable>
        </View>
        {subContent}
      </View>
      {showRowSeparator && (
        <View style={{ backgroundColor: SettingsTheme.groupBackground }}>
          <View style={styles.rowSeparator}></View>
        </View>
      )}
    </>
  )

  const toggleSwitch = () => {
    dispatch({
      type: DispatchAction.ENABLE_DEVELOPER_MODE,
      payload: [!devMode],
    })
    setDevMode(!devMode)
  }

  const toggleVerifierCapabilitySwitch = () => {
    // if verifier feature is switched off then also turn off the dev templates
    if (useVerifierCapability) {
      dispatch({
        type: DispatchAction.USE_DEV_VERIFIER_TEMPLATES,
        payload: [false],
      })
      setDevVerifierTemplates(false)
    }
    dispatch({
      type: DispatchAction.USE_VERIFIER_CAPABILITY,
      payload: [!useVerifierCapability],
    })
    setUseVerifierCapability((previousState) => !previousState)
  }

  const toggleAcceptDevCredentialsSwitch = () => {
    dispatch({
      type: DispatchAction.ACCEPT_DEV_CREDENTIALS,
      payload: [!acceptDevCredentials],
    })
    setAcceptDevCredentials((previousState) => !previousState)
  }

  const toggleConnectionInviterCapabilitySwitch = () => {
    dispatch({
      type: DispatchAction.USE_CONNECTION_INVITER_CAPABILITY,
      payload: [!useConnectionInviterCapability],
    })
    setConnectionInviterCapability((previousState) => !previousState)
  }

  const toggleDevVerifierTemplatesSwitch = () => {
    // if we switch on dev templates we can assume the user also
    // wants to enable the verifier capability
    if (!useDevVerifierTemplates) {
      dispatch({
        type: DispatchAction.USE_VERIFIER_CAPABILITY,
        payload: [true],
      })
      setUseVerifierCapability(true)
    }
    dispatch({
      type: DispatchAction.USE_DEV_VERIFIER_TEMPLATES,
      payload: [!useDevVerifierTemplates],
    })
    setDevVerifierTemplates((previousState) => !previousState)
  }

  const toggleWalletNamingSwitch = () => {
    dispatch({
      type: DispatchAction.ENABLE_WALLET_NAMING,
      payload: [!enableWalletNaming],
    })

    setEnableWalletNaming((previousState) => !previousState)
  }

  const toggleRemoteLoggingSwitch = () => {
    if (remoteLoggingEnabled) {
      const remoteLoggingEnabled = false

      DeviceEventEmitter.emit(RemoteLoggerEventTypes.ENABLE_REMOTE_LOGGING, remoteLoggingEnabled)
      setRemoteLoggingEnabled(remoteLoggingEnabled)

      dispatch({
        type: BCDispatchAction.REMOTE_DEBUGGING_STATUS_UPDATE,
        payload: [{ enabled: remoteLoggingEnabled, expireAt: undefined }],
      })

      return
    }

    setRemoteLoggingWarningModalVisible(true)
  }

  const onEnableRemoteLoggingPressed = () => {
    const remoteLoggingEnabled = true
    DeviceEventEmitter.emit(RemoteLoggerEventTypes.ENABLE_REMOTE_LOGGING, remoteLoggingEnabled)
    dispatch({
      type: BCDispatchAction.REMOTE_DEBUGGING_STATUS_UPDATE,
      payload: [{ enabledAt: new Date(), sessionId: logger.sessionId }],
    })
    setRemoteLoggingEnabled(remoteLoggingEnabled)

    setRemoteLoggingWarningModalVisible(false)

    if (store.authentication.didAuthenticate) {
      navigation.navigate(Screens.Home as never)
    }
  }

  const onRemoteLoggingBackPressed = () => {
    setRemoteLoggingWarningModalVisible(false)
  }

  const togglePreventAutoLockSwitch = () => {
    dispatch({
      type: DispatchAction.PREVENT_AUTO_LOCK,
      payload: [!preventAutoLock],
    })

    setPreventAutoLock((previousState) => !previousState)
  }

  const toggleShareableLinkSwitch = () => {
    dispatch({
      type: DispatchAction.USE_SHAREABLE_LINK,
      payload: [!enableShareableLink],
    })
    setEnableShareableLink((previousState) => !previousState)
  }

  const toggleEnableProxySwitch = () => {
    dispatch({
      type: BCDispatchAction.TOGGLE_PROXY,
      payload: [!enableProxy],
    })
    setEnableProxy((previousState) => !previousState)
  }

  const toggleEnableAppToAppPersonFlowSwitch = () => {
    dispatch({
      type: BCDispatchAction.TOGGLE_APP_TO_APP_PERSON_FLOW,
      payload: [!enableAppToAppPersonFlow],
    })
    setEnableAppToAppPersonFlow((previousState) => !previousState)
  }

  const toggleEnableTspCarriageSwitch = () => {
    const next = !enableTspCarriage
    dispatch({
      type: BCDispatchAction.TOGGLE_TSP_CARRIAGE,
      payload: [next],
    })
    // Outbound (sendTrustTaskDocument) reads this flag live, so it takes
    // effect immediately; inbound (setupTrustTasksInbound) only registers
    // the TSP carriage's handler at agent setup, so a restart is needed for
    // the inbound side to pick this up — same restart-to-apply behavior as
    // most of this screen's other developer toggles.
    setTspCarriageEnabled(next)
    setEnableTspCarriage(next)
  }

  const toggleEnableDidCommV2Switch = () => {
    const next = !enableDidCommV2
    dispatch({
      type: BCDispatchAction.TOGGLE_DIDCOMM_V2,
      payload: [next],
    })
    // The agent's `didcommVersions` is fixed at construction, so a restart is
    // needed for the agent to accept and produce v2 envelopes; new
    // relationship invitations read the flag live (isDidCommV2Enabled).
    setDidCommV2Enabled(next)
    setEnableDidCommV2(next)
  }

  /**
   * Dev probe for the VTA/VTC leg: resolve the mediator a VTI agent advertises,
   * log in, hold the socket, and ask the community for its join manifest. Marks
   * every stage in the log so an e2e run can assert on it.
   *
   * VTI_MEDIATOR_DID and VTI_COMMUNITY_DID come from `app/.env`, like the
   * mediator URLs — the local stack mints new DIDs whenever its tunnels change.
   */
  const handleProbeVtaMediator = async () => {
    if (!agent) {
      Alert.alert('Error', 'Agent not initialized')
      return
    }
    const mediatorDid = Config.VTI_MEDIATOR_DID
    const communityDid = Config.VTI_COMMUNITY_DID
    if (!mediatorDid || !communityDid) {
      Alert.alert('Not configured', 'Set VTI_MEDIATOR_DID and VTI_COMMUNITY_DID in app/.env and rebuild.')
      return
    }

    setIsProbingVta(true)
    setVtaProbeLog([])
    // A DID is most of a screen; the log keeps it whole, the screen keeps its ends.
    const short = (part: string) => (part.length > 44 ? `${part.slice(0, 28)}…${part.slice(-12)}` : part)
    const mark = (...parts: string[]) => {
      // eslint-disable-next-line no-console
      console.log(parts.join(' '))
      setVtaProbeLog((previous) => [...previous, parts.map(short).join(' ')])
    }
    let session: VtiMediatorSession | undefined
    try {
      mark('[VTI-PROBE] resolving mediator', mediatorDid)
      const mediator = await resolveVtiMediator(agent, mediatorDid)
      mark('[VTI-PROBE] mediator endpoints', mediator.authEndpoint, mediator.wsEndpoint)

      const ourDid = await createVtiClientDid(agent, mediator)
      mark('[VTI-PROBE] our did', ourDid as string)

      const identity = await vtiClientIdentityFromDid(agent, ourDid as string)
      // One socket, several legs: each leg installs its own listener rather
      // than opening a second session the community would see as a new member.
      let onVtiMessage: ((plaintext: { type?: string; body?: unknown }) => void) | undefined
      const reply = new Promise<{ type?: string; body?: unknown }>((resolve) => {
        onVtiMessage = resolve
      })
      session = new VtiMediatorSession(agent, identity, mediator, {
        // eslint-disable-next-line no-console
        onError: (error: Error) => console.log('[VTI-PROBE] session error', error.message),
        onMessage: (plaintext) => onVtiMessage?.(plaintext),
      })
      await session.start()
      mark('[VTI-PROBE] socket open, live delivery on')

      await session.sendTo(communityDid, {
        id: `urn:uuid:${utils.uuid()}`,
        typ: 'application/didcomm-plain+json',
        type: 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2',
        from: ourDid as string,
        to: [communityDid],
        created_time: Math.floor(Date.now() / 1000),
        expires_time: Math.floor(Date.now() / 1000) + 300,
        // The VTC reads the body as a whole Trust Task document, where a VTA
        // takes a bare payload — measured in tsp-reference/ref-20.
        body: {
          id: `urn:uuid:${utils.uuid()}`,
          type: 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2',
          payload: {},
          issuer: ourDid as string,
          recipient: communityDid,
          issuedAt: new Date().toISOString(),
        },
      })
      mark('[VTI-PROBE] manifest request forwarded to', communityDid)

      // The manifest comes back through the mediator on the same socket. A
      // reply that never arrives is a result too, so this is a race with a
      // deadline rather than an open-ended wait.
      const answer = await Promise.race([
        reply,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30000)),
      ])
      if (answer) {
        // A manifest's payload carries the community's join criteria — the
        // thing a join screen has to render.
        const criteria = (answer.body as { payload?: { criteria?: { description?: string }[] } } | undefined)?.payload
          ?.criteria
        mark(
          '[VTI-PROBE] manifest received',
          String(answer.type),
          Array.isArray(criteria) ? `${criteria.length} criterion(a)` : 'no criteria listed'
        )
        for (const criterion of criteria ?? []) {
          mark('[VTI-PROBE] criterion:', String(criterion.description ?? 'unnamed'))
        }

        // Apply. With no credentials in hand the honest presentation is an
        // empty one: the community should answer `requestMore` naming what it
        // still needs, which is the verdict ref-20 measured from Node.
        const manifestPayload = (answer.body as { payload?: { requirementsDigest?: string } } | undefined)?.payload
        const submitType = 'https://trusttasks.org/spec/vtc/join-requests/submit/0.2'
        let resolveVerdict: ((plaintext: { type?: string; body?: unknown }) => void) | undefined
        const verdictReply = new Promise<{ type?: string; body?: unknown }>((resolve) => {
          resolveVerdict = resolve
        })
        onVtiMessage = (plaintext) => resolveVerdict?.(plaintext)
        await session.sendTo(communityDid, {
          id: `urn:uuid:${utils.uuid()}`,
          typ: 'application/didcomm-plain+json',
          type: submitType,
          from: ourDid as string,
          to: [communityDid],
          created_time: Math.floor(Date.now() / 1000),
          expires_time: Math.floor(Date.now() / 1000) + 300,
          body: {
            id: `urn:uuid:${utils.uuid()}`,
            type: submitType,
            issuer: ourDid as string,
            recipient: communityDid,
            issuedAt: new Date().toISOString(),
            payload: {
              vp: {
                '@context': ['https://www.w3.org/ns/credentials/v2'],
                type: ['VerifiablePresentation'],
                holder: ourDid as string,
                verifiableCredential: [],
              },
              registryConsent: false,
              extensions: manifestPayload?.requirementsDigest
                ? { requirementsDigest: manifestPayload.requirementsDigest }
                : {},
            },
          },
        })
        mark('[VTI-PROBE] join request submitted')

        const verdictAnswer = await Promise.race([
          verdictReply,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30000)),
        ])
        // A verdict is `{ effect, with: { needs } }`: the effect says what the
        // community decided, `needs` names what it is still waiting for.
        const payload = (
          verdictAnswer?.body as
            | { payload?: { requestId?: string; verdict?: { effect?: string; with?: { needs?: string[] } } } }
            | undefined
        )?.payload
        if (payload?.verdict) {
          mark(
            '[VTI-PROBE] verdict',
            String(payload.verdict.effect ?? 'unstated'),
            `needs: ${(payload.verdict.with?.needs ?? []).join(', ') || 'nothing stated'}`
          )
          mark('[VTI-PROBE] request id', String(payload.requestId ?? 'none'))
          Alert.alert('VTI probe', `Join verdict: ${String(payload.verdict.effect ?? 'unstated')}`)
        } else {
          mark('[VTI-PROBE] no verdict within 30s')
          Alert.alert('VTI probe', 'Join request submitted, but no verdict came back.')
        }
      } else {
        mark('[VTI-PROBE] no manifest within 30s')
        Alert.alert('VTI probe', 'Logged in, socket open, manifest request sent — but nothing came back.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mark('[VTI-PROBE] failed', message)
      Alert.alert('VTI probe failed', message)
    } finally {
      await session?.stop()
      setIsProbingVta(false)
    }
  }

  // The app's one session with its VTA (shared with My Agent), so a consent
  // granted for a task started here reaches the client that waits for it.
  const vtaClientFor = (vtaDid: string): VtaClient => {
    if (!agent) throw new Error('Agent not initialized')
    return vtaAgent.client(agent, vtaDid, new GenericRecordsIdentityStore(agent))
  }

  /** Half 1 — mint (or recall) the manager identity and show it, so it can be enrolled. */
  const handleShowManagerIdentity = async () => {
    const vtaDid = Config.VTI_VTA_DID
    if (!vtaDid) {
      Alert.alert('Not configured', 'Set VTI_VTA_DID in app/.env and rebuild.')
      return
    }
    const short = (part: string) => (part.length > 44 ? `${part.slice(0, 28)}…${part.slice(-12)}` : part)
    const mark = (...parts: string[]) => {
      // eslint-disable-next-line no-console
      console.log(parts.join(' '))
      setManagerProbeLog((previous) => [...previous, parts.map(short).join(' ')])
    }
    setManagerProbeLog([])
    try {
      const did = await vtaClientFor(vtaDid).ensureManagerIdentity()
      mark('[VTA-PROBE] manager did', did)
      // The whole DID, unshortened, on its own line: the enrolment stand-in reads it off the screen.
      setManagerProbeLog((previous) => [...previous, `MANAGER_DID=${did}`])
    } catch (error) {
      mark('[VTA-PROBE] failed', error instanceof Error ? error.message : String(error))
    }
  }

  /** Half 2 — after enrolment: connect, ask who we are, mint a persona, borrow its key. */
  const handleProbeVtaManager = async () => {
    const vtaDid = Config.VTI_VTA_DID
    if (!agent || !vtaDid) {
      Alert.alert('Not configured', 'Set VTI_VTA_DID in app/.env and rebuild.')
      return
    }
    const short = (part: string) => (part.length > 44 ? `${part.slice(0, 28)}…${part.slice(-12)}` : part)
    const mark = (...parts: string[]) => {
      // eslint-disable-next-line no-console
      console.log(parts.join(' '))
      setManagerProbeLog((previous) => [...previous, parts.map(short).join(' ')])
    }
    setIsProbingManager(true)
    try {
      const client = vtaClientFor(vtaDid)
      await client.connect()
      mark('[VTA-PROBE] connected as', client.managerDid ?? '?')

      const me = await client.whoAmI()
      const roles = (me.roles ?? []).join(',') || String(me.role ?? '?')
      const scopes = (me.scopes ?? []).join(',') || '*'
      mark('[VTA-PROBE] whoami', `roles=${roles}`, `scopes=${scopes}`)

      const contexts = await client.listContexts()
      mark('[VTA-PROBE] contexts', String(contexts.length), contexts.map((c) => c.id).join(','))
      const contextId = contexts[0]?.id ?? 'vta'

      // A registered DID-hosting server is the documented path (the server
      // serves the persona's log); a serverless mint is the fallback, and only
      // resolves if something serves the log at that URL.
      const servers = await client.listServers()
      mark('[VTA-PROBE] servers', String(servers.length), servers.map((x) => x.id).join(','))
      const base = Config.VTI_PERSONA_BASE_URL
      const label = `keyring-${Date.now().toString(36)}`
      const persona = await client.mintPersona(
        servers[0] ? { contextId, serverId: servers[0].id, label } : { contextId, didUrl: `${base}/${label}`, label }
      )
      mark('[VTA-PROBE] persona minted', persona.did)
      mark('[VTA-PROBE] persona keys', `signing=${persona.signingKeyId}`, `ka=${persona.kaKeyId}`)

      // Under an approval policy the VTA holds this until an approver consents;
      // the controller's state says so while the wait is on.
      const unsub = vtaAgent.subscribe(() => {
        const waiting = vtaAgent.getState().awaitingConsentFor
        if (waiting) mark('[VTA-PROBE] consent required', waiting.replace('https://trusttasks.org/spec/', ''))
      })
      let borrowed
      try {
        borrowed = await client.borrowKey(persona.kaKeyId)
      } finally {
        unsub()
      }
      mark('[VTA-PROBE] key borrowed', borrowed.curve, `kms=${borrowed.keyId}`)

      // The community leg, wearing the persona: the phone seals with the key it
      // just borrowed, and the community sees a VTA-hosted did:webvh as the
      // applicant — the B shape end to end.
      const communityDid = Config.VTI_COMMUNITY_DID
      const mediatorDid = Config.VTI_MEDIATOR_DID
      if (communityDid && mediatorDid) {
        const identity = await vtiClientIdentityFromPersona(agent, persona.did, borrowed.keyId)
        await vtiAgent.connect(agent, mediatorDid, { identity })
        mark('[VTA-PROBE] community session as persona', vtiAgent.getState().did ?? '?')
        const manifest = await vtiAgent.fetchManifest(communityDid)
        mark('[VTA-PROBE] manifest as persona', `${manifest.criteria.length} criteria`)
      }
      Alert.alert('VTA probe', `Manager session up; persona ${short(persona.did)}; key borrowed.`)
    } catch (error) {
      mark('[VTA-PROBE] failed', error instanceof Error ? error.message : String(error))
      Alert.alert('VTA probe failed', error instanceof Error ? error.message : String(error))
    } finally {
      setIsProbingManager(false)
    }
  }

  // Dev convenience: with VTI_PROBE_ON_START=1 baked in, the probe runs as soon
  // as this screen mounts. Driving a button through Appium costs an onboarding
  // lap per iteration; the transport it exercises is the same either way.
  const autoProbed = useRef(false)
  useEffect(() => {
    if (Config.VTI_PROBE_ON_START !== '1' || autoProbed.current || !agent) return
    autoProbed.current = true
    void handleProbeVtaMediator()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent])

  const handleSeedTestContacts = async () => {
    if (!agent) {
      Alert.alert('Error', 'Agent not initialized')
      return
    }

    setIsSeedingContacts(true)
    try {
      const count = await seedTestContacts(agent)
      Alert.alert('Success', `Seeded ${count} test contacts. Navigate to Contacts to view them.`)
    } catch (error) {
      Alert.alert('Error', `Failed to seed test contacts: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSeedingContacts(false)
    }
  }

  const handleClearTestContacts = async () => {
    if (!agent) {
      Alert.alert('Error', 'Agent not initialized')
      return
    }

    Alert.alert('Clear Test Contacts', 'Are you sure you want to clear all test contacts?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          setIsClearingContacts(true)
          try {
            const count = await clearTestContacts(agent)
            Alert.alert('Success', `Cleared ${count} test contacts`)
          } catch (error) {
            Alert.alert(
              'Error',
              `Failed to clear test contacts: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          } finally {
            setIsClearingContacts(false)
          }
        },
      },
    ])
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
      <SafeAreaModal
        visible={remoteLoggingWarningModalVisible}
        transparent={false}
        animationType={'fade'}
        onRequestClose={() => {
          return
        }}
      >
        <RemoteLogWarning onBackPressed={onRemoteLoggingBackPressed} onEnablePressed={onEnableRemoteLoggingPressed} />
      </SafeAreaModal>
      <SafeAreaModal
        visible={environmentModalVisible}
        transparent={false}
        animationType={'slide'}
        onRequestClose={() => {
          return
        }}
      >
        <IASEnvironment shouldDismissModal={shouldDismissModal} />
      </SafeAreaModal>
      <ScrollView style={styles.container}>
        <SectionRow
          title={t('Developer.DeveloperMode')}
          accessibilityLabel={t('Developer.Toggle')}
          testID={testIdWithKey('ToggleDeveloper')}
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={devMode ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleSwitch}
            value={devMode}
          />
        </SectionRow>
        <View style={styles.sectionSeparator}></View>
        <SectionHeader icon={'apartment'} title={'IAS'} />
        <SectionRow
          title={t('Developer.Environment')}
          accessibilityLabel={t('Developer.Environment')}
          testID={testIdWithKey(t('Developer.Environment').toLowerCase())}
          onPress={() => {
            setEnvironmentModalVisible(true)
          }}
        >
          <Text style={[TextTheme.headingFour, { fontWeight: 'normal', color: ColorPalette.brand.link }]}>
            {store.developer.environment.name}
          </Text>
        </SectionRow>
        <View style={styles.sectionSeparator}></View>
        <SectionRow
          title={t('Verifier.UseVerifierCapability')}
          accessibilityLabel={t('Verifier.Toggle')}
          testID={testIdWithKey('ToggleVerifierCapability')}
          showRowSeparator
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={useVerifierCapability ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleVerifierCapabilitySwitch}
            value={useVerifierCapability}
          />
        </SectionRow>
        <SectionRow
          title={t('Verifier.AcceptDevCredentials')}
          accessibilityLabel={t('Verifier.Toggle')}
          testID={testIdWithKey('ToggleAcceptDevCredentials')}
          showRowSeparator
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={acceptDevCredentials ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleAcceptDevCredentialsSwitch}
            value={acceptDevCredentials}
          />
        </SectionRow>
        <SectionRow
          title={t('Connection.UseConnectionInviterCapability')}
          accessibilityLabel={t('Connection.Toggle')}
          testID={testIdWithKey('ToggleConnectionInviterCapabilitySwitch')}
          showRowSeparator
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={useConnectionInviterCapability ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleConnectionInviterCapabilitySwitch}
            value={useConnectionInviterCapability}
          />
        </SectionRow>
        <SectionRow
          title={t('Verifier.UseDevVerifierTemplates')}
          accessibilityLabel={t('Verifier.ToggleDevTemplates')}
          testID={testIdWithKey('ToggleDevVerifierTemplatesSwitch')}
          showRowSeparator
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={useDevVerifierTemplates ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleDevVerifierTemplatesSwitch}
            value={useDevVerifierTemplates}
          />
        </SectionRow>
        {!store.onboarding.didCreatePIN && (
          <SectionRow
            title={t('NameWallet.EnableWalletNaming')}
            accessibilityLabel={t('NameWallet.ToggleWalletNaming')}
            testID={testIdWithKey('ToggleWalletNamingSwitch')}
            showRowSeparator
          >
            <Switch
              trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
              thumbColor={enableWalletNaming ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              ios_backgroundColor={ColorPalette.grayscale.lightGrey}
              onValueChange={toggleWalletNamingSwitch}
              value={enableWalletNaming}
            />
          </SectionRow>
        )}
        <SectionRow
          title={t('Settings.PreventAutoLock')}
          accessibilityLabel={t('Settings.TogglePreventAutoLock')}
          testID={testIdWithKey('TogglePreventAutoLockSwitch')}
          showRowSeparator
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={preventAutoLock ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={togglePreventAutoLockSwitch}
            value={preventAutoLock}
          />
        </SectionRow>
        <SectionRow
          title={'Remote Logging'}
          accessibilityLabel={'Remote Logging'}
          testID={testIdWithKey('ToggleRemoteLoggingSwitch')}
          subContent={
            remoteLoggingEnabled ? (
              <Text style={[styles.rowTitle, { marginTop: 10 }]}>
                {`${t('RemoteLogging.SessionID')}: `}
                <Text style={[styles.rowTitle, { fontWeight: 'bold' }]}>{logger.sessionId.toString()}</Text>
              </Text>
            ) : (
              <></>
            )
          }
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={remoteLoggingEnabled ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleRemoteLoggingSwitch}
            value={remoteLoggingEnabled}
          />
        </SectionRow>

        <SectionRow
          title={t('PasteUrl.UseShareableLink')}
          accessibilityLabel={t('PasteUrl.UseShareableLink')}
          testID={testIdWithKey('ToggleUseShareableLink')}
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={enableShareableLink ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleShareableLinkSwitch}
            value={enableShareableLink}
            disabled={!store.authentication.didAuthenticate}
          />
        </SectionRow>

        <SectionRow
          title={t('Developer.EnableProxy')}
          accessibilityLabel={t('Developer.EnableProxy')}
          testID={testIdWithKey('ToggleEnableProxy')}
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={enableProxy ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleEnableProxySwitch}
            value={enableProxy}
          />
        </SectionRow>

        <SectionRow
          title={t('Developer.EnableAppToAppPersonFlow')}
          accessibilityLabel={t('Developer.EnableAppToAppPersonFlow')}
          testID={testIdWithKey('ToggleEnableAppToAppPersonFlow')}
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={enableAppToAppPersonFlow ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleEnableAppToAppPersonFlowSwitch}
            value={enableAppToAppPersonFlow}
          />
        </SectionRow>

        <SectionRow
          title={t('Developer.EnableTspCarriage')}
          accessibilityLabel={t('Developer.EnableTspCarriage')}
          testID={testIdWithKey('ToggleEnableTspCarriage')}
          // The row toggles too: iOS hides the Switch behind the accessible row
          // from automation (same fix as the DIDComm v2 row, 2026-09-14).
          onPress={toggleEnableTspCarriageSwitch}
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={enableTspCarriage ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleEnableTspCarriageSwitch}
            value={enableTspCarriage}
          />
        </SectionRow>

        <View style={styles.sectionSeparator}></View>

        <SectionRow
          title={t('Developer.EnableDidCommV2')}
          accessibilityLabel={t('Developer.EnableDidCommV2')}
          testID={testIdWithKey('ToggleEnableDidCommV2')}
          // The row itself toggles too: on iOS the accessible row hides the
          // Switch from automation, and a tap on the row did nothing (the
          // Android+iOS DIDComm v2 e2e came back with the flag off, 2026-09-14).
          onPress={toggleEnableDidCommV2Switch}
        >
          <Switch
            trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
            thumbColor={enableDidCommV2 ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
            ios_backgroundColor={ColorPalette.grayscale.lightGrey}
            onValueChange={toggleEnableDidCommV2Switch}
            value={enableDidCommV2}
          />
        </SectionRow>

        <View style={styles.sectionSeparator}></View>
        <SectionHeader icon={'contacts'} title={'Test Data'} />
        <View style={styles.section}>
          <Pressable
            style={[
              {
                backgroundColor: ColorPalette.brand.primary,
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                marginBottom: 10,
              },
              isSeedingContacts && { backgroundColor: ColorPalette.brand.primaryDisabled },
            ]}
            onPress={handleSeedTestContacts}
            disabled={isSeedingContacts}
            testID={testIdWithKey('SeedTestContactsButton')}
          >
            {isSeedingContacts ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Seed Test Contacts</Text>
            )}
          </Pressable>
        </View>
        <View style={styles.section}>
          <Pressable
            style={[
              {
                backgroundColor: ColorPalette.brand.primary,
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                marginBottom: 10,
              },
              isProbingVta && { backgroundColor: ColorPalette.brand.primaryDisabled },
            ]}
            onPress={handleProbeVtaMediator}
            disabled={isProbingVta}
            testID={testIdWithKey('ProbeVtaMediatorButton')}
          >
            {isProbingVta ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Probe VTA mediator</Text>
            )}
          </Pressable>
          <Pressable
            style={[
              {
                backgroundColor: ColorPalette.brand.primary,
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 8,
                alignItems: 'center',
                marginTop: 12,
              },
            ]}
            onPress={handleShowManagerIdentity}
            testID={testIdWithKey('ShowManagerIdentityButton')}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>My VTA: show manager identity</Text>
          </Pressable>
          <Pressable
            style={[
              {
                backgroundColor: ColorPalette.brand.primary,
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 8,
                alignItems: 'center',
                marginTop: 8,
              },
              isProbingManager && { backgroundColor: ColorPalette.brand.primaryDisabled },
            ]}
            onPress={handleProbeVtaManager}
            disabled={isProbingManager}
            testID={testIdWithKey('ProbeVtaManagerButton')}
          >
            {isProbingManager ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                My VTA: connect and mint a persona
              </Text>
            )}
          </Pressable>
          {managerProbeLog.length > 0 && (
            <Text
              testID={testIdWithKey('VtaManagerProbeLog')}
              accessibilityLabel={managerProbeLog.join('\n')}
              style={{ color: TextTheme.normal.color, fontSize: 12, marginTop: 12 }}
            >
              {managerProbeLog.join('\n')}
            </Text>
          )}
          {vtaProbeLog.length > 0 && (
            <Text
              testID={testIdWithKey('VtaProbeLog')}
              accessibilityLabel={vtaProbeLog.join('\n')}
              style={{ color: TextTheme.normal.color, fontSize: 12, marginTop: 12 }}
            >
              {vtaProbeLog.join('\n')}
            </Text>
          )}
        </View>
        <View style={styles.section}>
          <Pressable
            style={[
              {
                backgroundColor: ColorPalette.grayscale.mediumGrey,
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
              },
              isClearingContacts && { backgroundColor: ColorPalette.brand.primaryDisabled },
            ]}
            onPress={handleClearTestContacts}
            disabled={isClearingContacts}
            testID={testIdWithKey('ClearTestContactsButton')}
          >
            {isClearingContacts ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Clear Test Contacts</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export default Developer
