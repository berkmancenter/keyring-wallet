/**
 * Vetting — the two seats of peer identity vetting on one screen, decided by
 * what this phone holds: a vetter grant for the community makes it the
 * vetter's desk; otherwise it is the applicant's application. Both ride the
 * persona's community session; both are the reference client's flows
 * (design §8–§10) with the terminal taken out of the room.
 *
 * The seat is said out loud before anything else on the screen — a badge, a
 * heading and one sentence — because the two people at a vetting hold phones
 * that look alike, and which of them is checking whom is the one thing
 * neither should have to infer.
 *
 * @module trust-tasks/screens/VtiVetting
 */

import { useAgent } from '@bifold/react-hooks'
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import QRRenderer from '../../../components/misc/QRRenderer'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore, type VtiHeldCredential } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { openJoinRequestOf, vtiAgent, type VtiManifest } from '../module/vtiAgent'
import { GenericRecordsTspPeerRevisionStore } from '../module/vtiTsp'
import { receiveIssue } from '../module/vtiInbox'
import {
  GenericRecordsVettingStore,
  VtiApplicant,
  VtiVetterDesk,
  type VettingApplication,
  type VettingDeskRequest,
  type VettingVetterProfile,
  type VettingTicket,
} from '../module/vtiVetting'
import { ensurePersonaFor } from '../module/vtiJoin'
import { pendingVettingTicket } from '../module/vtiLinks'
import { requestBiometricConfirmationWithUI } from '../../vrc/vrc-biometric'

import { openScanner } from './openScanner'
import { communityTarget } from '../module/vtiCommunityLink'
import { pickOwnVetterGrant, type VetterGrantState } from '../module/vtiGrantState'
import { joinSeed } from '../module/vtiJoinSeed'

import { useCommunityDid } from './useCommunity'
import { communityLabelOf } from './communityName'
import { vetterStandingLine } from './vetterStanding'
import { useVtaDid } from './VtaStatus'

const shortDid = (did?: string) => (did && did.length > 32 ? `${did.slice(0, 22)}…${did.slice(-10)}` : (did ?? ''))

/**
 * A short, stable name for one vetting request: the tail of its request
 * document's id. A second request to the same vetter replaces the first with a
 * new id, so this is what tells the two apart when their answers read the same.
 * It is for tests, not people — it rides in the testID, never on screen.
 */
export const requestRef = (requestDocumentId: string) => requestDocumentId.replace(/[^A-Za-z0-9]/g, '').slice(-8)

/** The testID of a request's "Sent" line: the fixed key, then which request it is. */
export const requestTestKey = (requestDocumentId: string) => `VettingRequestId.${requestRef(requestDocumentId)}`

export interface VtiVettingProps {
  config?: { mediatorDid?: string; communityDid?: string; vtaDid?: string }
}

const VtiVetting: React.FC<VtiVettingProps> = ({ config }) => {
  const { t } = useTranslation()
  // i18next escapes interpolated values for HTML by default, and React Native
  // renders them as plain text — so a locale date reads "9&#x2F;21&#x2F;26" and a
  // legal name like O'Brien reads "O&#39;Brien" on the card preview. Nothing on
  // this screen is HTML; every interpolation goes through here.
  const tp = (key: string, values: Record<string, unknown>) =>
    t(key, { ...values, interpolation: { escapeValue: false } }) as string
  const { ColorPalette, TextTheme } = useTheme()
  const { agent } = useAgent()
  const communityDid = useCommunityDid(config?.communityDid)
  const mediatorDid = config?.mediatorDid
  const vtaDid = useVtaDid(config?.vtaDid)

  const [persona, setPersona] = useState<VtiPersona>()
  const [grant, setGrant] = useState<VtiHeldCredential>()
  /**
   * Whether this phone is a vetter *now*, not merely whether it holds a grant.
   * The desk used to seat anyone with a grant and say nothing about its
   * standing, so a vetter whose grant was revoked or re-granted (a re-grant is
   * a new credential, and the new one may never have arrived) sat at a desk
   * that would refuse to sign, with nothing on screen to explain it.
   */
  const [standing, setStanding] = useState<VetterGrantState>({ state: 'none' })
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string>()
  // The community answered that an application is already open (and which).
  const [alreadyOpen, setAlreadyOpen] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [tick, setTick] = useState(0)
  const bump = useCallback(() => setTick((n) => n + 1), [])

  // desk
  const [tickets, setTickets] = useState<(VettingTicket & { link: string })[]>([])
  const [desk, setDesk] = useState<VettingDeskRequest[]>([])
  const [profile, setProfile] = useState<VettingVetterProfile>()
  const [profileName, setProfileName] = useState('')
  // application
  const [application, setApplication] = useState<VettingApplication>()
  const [manifest, setManifest] = useState<VtiManifest>()
  const [legalName, setLegalName] = useState('')
  /**
   * Whether what this phone already holds has been read once. The name is
   * filled from a stored application, which arrives from the store rather
   * than with the first render — so without this the field shows empty and
   * then "suddenly" fills, which reads as something having gone wrong
   * (report #18). The step waits instead, briefly and visibly.
   */
  const [heldRead, setHeldRead] = useState(false)
  // The profile chosen at Join as fills the name in, once (seed by copy).
  const seed = communityDid ? joinSeed.get(communityDid) : undefined
  useEffect(() => {
    if (seed?.legalName) setLegalName((v) => v || seed.legalName)
  }, [seed?.legalName])
  const [ticketLink, setTicketLink] = useState('')
  const navigation = useNavigation()
  const { width } = useWindowDimensions()
  // A QR sized for a phone held at arm's length, not for the whole width of an
  // iPad: past ~240 pt it only gets harder to fit in another camera's frame.
  const ticketQrSize = Math.min(240, width - 80)
  const [linkCopied, setLinkCopied] = useState(false)
  // Which sessions this person has confirmed the match code for, and which
  // finished requests they have moved on from — what they answered on this
  // screen, not protocol state.
  const [matchConfirmed, setMatchConfirmed] = useState<Record<string, true>>({})
  const [doneDismissed, setDoneDismissed] = useState<Record<string, true>>({})

  // A ticket scanned or pasted anywhere lands here (vtiLinks): fill it in.
  // The applicant still asks for vetting themselves.
  useEffect(() => {
    const takePending = () => {
      const ticket = pendingVettingTicket.take()
      if (ticket) setTicketLink(ticket)
    }
    takePending()
    return pendingVettingTicket.subscribe(takePending)
  }, [])

  const onScanTicket = useCallback(() => {
    openScanner(navigation)
  }, [navigation])
  const [checklist, setChecklist] = useState<{
    held: number
    needed: number
    counted: number
    meets: boolean
    discounted: number
    needs: { kind: 'statements' | 'method'; method?: string; n: number }[]
    independenceOk: boolean
    exceededCaps: { relationship: string; limit: number; seen: number }[]
    unreadableMaxAge?: string
    unchecked: { vetterDid: string; reason: string }[]
  }>()
  const [membershipRole, setMembershipRole] = useState<string>()

  const stores = useMemo(
    () =>
      agent
        ? {
            identity: new GenericRecordsIdentityStore(agent),
            community: new GenericRecordsCommunityStore(agent),
            vetting: new GenericRecordsVettingStore(agent),
          }
        : undefined,
    [agent]
  )
  const deskRef = useRef<VtiVetterDesk | undefined>(undefined)
  const applicantRef = useRef<VtiApplicant | undefined>(undefined)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 24, gap: 18 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, padding: 18, gap: 8 },
    h: { ...TextTheme.headingFour, color: TextTheme.normal.color },
    label: { ...TextTheme.labelSubtitle, color: ColorPalette.grayscale.mediumGrey },
    value: { ...TextTheme.normal, color: TextTheme.normal.color },
    code: {
      fontSize: 40,
      fontWeight: '700',
      letterSpacing: 4,
      color: TextTheme.normal.color,
      textAlign: 'center',
      paddingVertical: 8,
    },
    // 'Courier' is an iOS face; Android has no font by that name, and asking
    // for one it cannot resolve takes the whole Text — and its siblings — out
    // of the rendered tree, so the ticket card came out as three empty views
    // with no testIDs and the run could never find the link inside it.
    mono: {
      fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
      fontSize: 12,
      color: ColorPalette.grayscale.mediumGrey,
    },
    button: {
      backgroundColor: ColorPalette.brand.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    buttonText: { ...TextTheme.bold, color: '#FFFFFF' },
    input: {
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 8,
      padding: 10,
      color: TextTheme.normal.color,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    error: { ...TextTheme.normal, color: ColorPalette.semantic.error },
    row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    seat: { backgroundColor: ColorPalette.brand.primary, borderRadius: 16, padding: 18, gap: 8 },
    seatBadge: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: '#FFFFFF',
    },
    seatBadgeText: { ...TextTheme.labelSubtitle, color: ColorPalette.brand.primary, fontWeight: '700' },
    seatTitle: { ...TextTheme.headingThree, color: '#FFFFFF' },
    seatText: { ...TextTheme.normal, color: '#FFFFFF' },
    step: {
      ...TextTheme.labelSubtitle,
      color: ColorPalette.brand.primary,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
  })

  /**
   * What the phone's vetter standing means for the person sitting at the desk.
   * Revoked and expired lead to the same request of an admin but are not the
   * same thing to read, and someone who believes they are a vetter must not be
   * told they never were. Nothing is claimed about what happens next: a
   * re-granted vetter's new grant may not have arrived at all, so "try again"
   * would be a promise the app cannot keep.
   */
  /** Whether this phone can actually vet right now, not merely sit at the desk. */
  const canVet = standing.state === 'active'

  const standingNotice = (() => {
    const said = vetterStandingLine(standing)
    if (!said) return null
    return (
      <View style={styles.card} testID={testIdWithKey('VettingStanding')}>
        <View style={styles.row}>
          <Icon name="alert-circle-outline" size={24} color={ColorPalette.semantic.error} />
          <Text style={styles.value} testID={testIdWithKey('VettingStandingLine')}>
            {t(said.line)}
          </Text>
        </View>
        {said.ask ? (
          <Text style={styles.label} testID={testIdWithKey('VettingStandingAsk')}>
            {t('Vetting.StandingAsk')}
          </Text>
        ) : null}
        <Text style={styles.label} testID={testIdWithKey('VettingStandingNoTicket')}>
          {t('Vetting.StandingNoTicket')}
        </Text>
      </View>
    )
  })()

  /** The seat banner: who this phone is at the vetting, in three lines. */
  const seatBanner = (which: 'vetter' | 'applicant') => (
    <View style={styles.seat} testID={testIdWithKey('VettingSeatBanner')} accessibilityRole="header">
      <View style={styles.row}>
        <Icon name={which === 'vetter' ? 'account-check' : 'account-search'} size={28} color="#FFFFFF" />
        <Text style={styles.seatTitle}>
          {which === 'vetter' ? t('Vetting.DeskTitle') : t('Vetting.ApplicantTitle')}
        </Text>
      </View>
      <View style={styles.seatBadge} testID={testIdWithKey('VettingRoleBadge')}>
        <Text style={styles.seatBadgeText}>
          {which === 'vetter' ? t('Vetting.SeatVetter') : t('Vetting.SeatApplicant')}
        </Text>
      </View>
      <Text style={styles.seatText}>
        {which === 'vetter' ? t('Vetting.SeatVetterHint') : t('Vetting.SeatApplicantHint')}
      </Text>
    </View>
  )

  // Load what the phone holds, and connect the persona's session with an inbox.
  useEffect(() => {
    if (!agent || !stores || !communityDid) return
    let cancelled = false
    void (async () => {
      const p = await stores.identity.getPersona(communityDid)
      if (cancelled) return
      setPersona(p)
      if (!p?.kmsKeyIds?.keyAgreement) return
      try {
        // Always ask: `connect` returns immediately when its socket is still
        // open for this persona, and reconnects when it is not. Guarding on
        // the DID alone trusted state that outlives the socket — after the
        // mediator dropped the stream, the screen saw a matching DID, skipped
        // the connect, and reported itself connected with nothing underneath.
        // Anything sent to the persona then went nowhere: not delivered, not
        // even queued, because the mediator had deregistered it.
        await vtiAgent.connect(agent, mediatorDid, {
          persona: p,
          peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
        })
        setConnected(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agent, stores, communityDid, mediatorDid, tick])

  // Whatever the community or a vetter delivers, keep it; then decide the seat.
  //
  // Deliberately NOT gated on `connected`. Opening the session drains whatever
  // the mediator has been holding, and those messages are emitted while
  // `connect` is still in flight — measured at roughly 900ms before it
  // returned, which is when `connected` becomes true. A listener attached
  // after that misses the entire backlog: the mediator counts the messages as
  // delivered and drops them, so a vetter grant issued while the app was shut
  // arrives once, is heard by nobody, and never comes again. The seat then
  // never appears and the community looks at fault, having done everything
  // right. Registering before the connect costs nothing — `onInbound` is a
  // listener on the agent, not on a session — and closes the window.
  useEffect(() => {
    if (!agent || !stores || !persona) return
    const stopIssue = vtiAgent.onInbound((m) => {
      void receiveIssue(stores.community, persona.did, m).then((got) => got.length && bump())
    })
    const refreshSeat = async () => {
      const grants = await stores.community.listHeldCredentials('vetter-grant', persona.communityDid)
      const mine = grants.filter((x) => x.subjectDid === persona.did)
      // One chooser for the desk and for signing: `pickOwnVetterGrant` picks
      // the grant the app will actually sign under and says what it is, so the
      // desk cannot seat someone under one grant while the signature is made
      // under another — or refused.
      const picked = await pickOwnVetterGrant(agent, mine, { allowInsecureLocal: __DEV__ })
      setGrant(picked.held)
      setStanding(picked.state)
      const m = await stores.community.getMembership(persona.communityDid)
      setMembershipRole(m?.role)
      // Seated at the desk for any grant it holds, live or not — a vetter
      // whose grant was revoked should find the desk and be told why it will
      // not work, rather than be quietly returned to the applicant's chair as
      // though they had never been a vetter.
      if (picked.held) {
        if (!deskRef.current)
          deskRef.current = new VtiVetterDesk(agent, persona, stores.vetting, stores.community, bump)
        deskRef.current.listen()
        const p = await stores.vetting.getProfile(persona.communityDid)
        setProfile(p)
        setProfileName((v) => v || p?.displayName || '')
        const ts = await stores.vetting.listTickets(persona.communityDid)
        setTickets(ts.map((x) => ({ ...x, link: deskRef.current!.linkFor(x) })))
        setDesk(await stores.vetting.listDesk())
        setHeldRead(true)
      } else {
        if (!applicantRef.current)
          applicantRef.current = new VtiApplicant(agent, persona, stores.vetting, stores.community, bump)
        applicantRef.current.listen()
        const a = await stores.vetting.getApplication(persona.communityDid)
        setApplication(a)
        if (a) {
          setLegalName((v) => v || a.claims['name.legal'] || '')
          setChecklist(await applicantRef.current.checklist())
        }
        setHeldRead(true)
      }
    }
    void refreshSeat()
    const timer = setInterval(() => void refreshSeat(), 3000)
    return () => {
      clearInterval(timer)
      stopIssue()
    }
  }, [agent, stores, persona, connected, bump])

  const run = useCallback(
    async (name: string, fn: () => Promise<unknown>) => {
      setBusy(name)
      setError(undefined)
      try {
        await fn()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(undefined)
        bump()
      }
    },
    [bump]
  )

  // Say what is missing and offer the way to it — a store build names neither.
  if (!vtaDid || !communityDid) {
    const go = (screen: Screens) => (navigation as unknown as { navigate: (name: string) => void }).navigate(screen)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <Text style={styles.value} testID={testIdWithKey(!vtaDid ? 'VettingNeedsAgent' : 'VettingNeedsCommunity')}>
            {!vtaDid ? t('Join.NeedsAgent') : t('Vetting.NeedsCommunity')}
          </Text>
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            onPress={() => go(!vtaDid ? Screens.VtaLink : Screens.VtiJoin)}
            testID={testIdWithKey(!vtaDid ? 'VettingLinkAgent' : 'VettingJoinCommunity')}
          >
            <Text style={styles.buttonText}>{!vtaDid ? t('VtaLink.LinkYourAgent') : t('Vetting.JoinCommunity')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  // No persona yet: the join DID is chosen before gathering, so this is step one.
  if (!persona) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          {seatBanner('applicant')}
          <Text style={styles.value}>{t('Vetting.NeedIdentity')}</Text>
          <Pressable
            style={styles.button}
            testID={testIdWithKey('VettingCreateIdentityButton')}
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() =>
              run('identity', async () => {
                if (agent && stores) {
                  await ensurePersonaFor({ agent, identityStore: stores.identity, vtaDid, communityDid })
                  communityTarget.choose(communityDid)
                }
              })
            }
          >
            {busy === 'identity' ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.buttonText}>{t('MyAgent.CreateIdentity')}</Text>
          </Pressable>
          {error ? (
            <Text style={styles.error} testID={testIdWithKey('VettingError')}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ------------------------------------------------------------ shared pieces
  const stepHeader = (n: number, of: number, title: string) => (
    <View style={{ gap: 4 }}>
      <Text style={styles.step} testID={testIdWithKey('VettingStepIndicator')}>
        {tp('Vetting.StepOf', { n, of })}
      </Text>
      <Text style={styles.h} accessibilityRole="header">
        {title}
      </Text>
    </View>
  )

  const errorLine = error ? (
    <Text style={styles.error} testID={testIdWithKey('VettingError')}>
      {error}
    </Text>
  ) : null

  /** The full-screen match code, answered on both phones (plan §5.3–5.4). */
  const matchStep = (code: string, question: string, onMatch: () => void, onDiffer: () => void) => (
    <View
      style={[styles.card, { alignItems: 'center', paddingVertical: 32 }]}
      testID={testIdWithKey('VettingMatchStep')}
    >
      <Text style={styles.label}>{t('Vetting.MatchCodeHint')}</Text>
      <Text style={[styles.code, { fontSize: 56 }]} testID={testIdWithKey('VettingMatchCode')} selectable>
        {code}
      </Text>
      <Text style={[styles.value, { textAlign: 'center' }]}>{question}</Text>
      <View style={{ alignSelf: 'stretch', gap: 12 }}>
        <Pressable
          style={styles.button}
          testID={testIdWithKey('VettingCodesMatch')}
          accessibilityRole="button"
          disabled={!!busy}
          onPress={onMatch}
        >
          <Text style={styles.buttonText}>{t('Vetting.CodesMatch')}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: ColorPalette.grayscale.mediumGrey }]}
          testID={testIdWithKey('VettingCodesDiffer')}
          accessibilityRole="button"
          disabled={!!busy}
          onPress={onDiffer}
        >
          <Text style={styles.buttonText}>{t('Vetting.CodesDiffer')}</Text>
        </Pressable>
      </View>
    </View>
  )

  /** Every signing act asks for the person's face or fingerprint (plan principle 9). */
  const confirmWithBiometrics = async (counterparty: string, act: 'Send' | 'Attest' | 'Apply') => {
    if (!agent) return false
    // Say what is being signed: the shared modal otherwise speaks of a
    // relationship credential, which none of these is.
    const result = await requestBiometricConfirmationWithUI(agent, counterparty, 'vetting', {
      title: t(`Vetting.Confirm${act}Title`),
      description: t(`Vetting.Confirm${act}Body`),
    })
    return result.success
  }

  // ---------------------------------------------------------------- the desk
  if (grant) {
    // The desk lists requests newest first; the one in progress is the step.
    const current = desk.find((r) => r.status !== 'attested' && r.status !== 'declined')
    const latest = desk[0]
    type VetterStep = 'ticket' | 'request' | 'match' | 'waitCard' | 'check' | 'done'
    const vetterStep: VetterStep = current
      ? current.status === 'accepted'
        ? 'request'
        : !matchConfirmed[current.requestId]
          ? 'match'
          : current.status === 'cardReceived'
            ? 'check'
            : 'waitCard'
      : latest?.status === 'attested' && !doneDismissed[latest.requestId]
        ? 'done'
        : 'ticket'
    const stepNumber = { ticket: 1, request: 2, match: 3, waitCard: 3, check: 4, done: 5 }[vetterStep]
    const request = vetterStep === 'done' ? latest : current

    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          {seatBanner('vetter')}
          {standingNotice}
          <Text style={styles.value} testID={testIdWithKey('VettingYouVetFor')}>
            {tp('Vetting.YouVetFor', { community: communityLabelOf(persona.communityDid) })}
          </Text>

          {vetterStep === 'ticket' ? (
            <>
              {stepHeader(stepNumber, 5, t('Vetting.DeskStep1'))}
              {/* A ticket is the invitation to begin: handing one out with no
                  live grant starts a ceremony that cannot finish — codes
                  matched, card sent, statement issued, and only then does the
                  applicant learn none of it counted. The applicant is a
                  stranger to this problem, so the desk does not start one. */}
              <Pressable
                style={styles.button}
                testID={testIdWithKey('VettingNewTicketButton')}
                accessibilityRole="button"
                disabled={!!busy || !canVet}
                accessibilityState={{ disabled: !!busy || !canVet }}
                onPress={() => run('ticket', () => deskRef.current!.issueTicket())}
              >
                {busy === 'ticket' ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.buttonText}>{t('Vetting.NewTicket')}</Text>
              </Pressable>
              {tickets
                .filter((x) => x.usesLeft > 0)
                .slice(-1)
                .map((x) => (
                  <View key={x.ticketId} style={styles.card} testID={testIdWithKey('VettingTicketCard')}>
                    <Text style={styles.label}>{t('Vetting.ReadAloud')}</Text>
                    <Text style={styles.code} testID={testIdWithKey('VettingTicketCode')}>
                      {x.code}
                    </Text>
                    <Text style={styles.label}>{t('Vetting.OrScan')}</Text>
                    <View style={{ alignItems: 'center' }} testID={testIdWithKey('VettingTicketQr')}>
                      <QRRenderer value={x.link} size={ticketQrSize} />
                    </View>
                    <Pressable
                      style={styles.button}
                      testID={testIdWithKey('VettingCopyTicketLink')}
                      accessibilityRole="button"
                      onPress={() => {
                        Clipboard.setString(x.link)
                        setLinkCopied(true)
                      }}
                    >
                      <Text style={styles.buttonText}>
                        {linkCopied ? t('Vetting.LinkCopied') : t('Vetting.CopyLink')}
                      </Text>
                    </Pressable>
                    <Text style={styles.mono} testID={testIdWithKey('VettingTicketLink')} selectable>
                      {x.link}
                    </Text>
                    <Text style={styles.label}>
                      {tp('Vetting.TicketValid', { uses: x.usesLeft, until: x.expiresAt.slice(0, 10) })}
                    </Text>
                  </View>
                ))}
              <Text style={styles.value} testID={testIdWithKey('VettingDeskEmpty')}>
                {t('Vetting.DeskEmpty')}
              </Text>

              {/* Optional, and not part of a session: how people looking for a vetter find you. */}
              <Text style={styles.h}>{t('Vetting.YourProfile')}</Text>
              <View style={styles.card}>
                <Text style={styles.label}>{t('Vetting.ProfileHint')}</Text>
                <TextInput
                  style={styles.input}
                  testID={testIdWithKey('VettingProfileNameInput')}
                  value={profileName}
                  onChangeText={setProfileName}
                  placeholder={t('Vetting.ProfileNamePlaceholder')}
                  placeholderTextColor={ColorPalette.grayscale.mediumGrey}
                  autoCapitalize="words"
                />
                <Pressable
                  style={styles.button}
                  testID={testIdWithKey('VettingPublishProfileButton')}
                  accessibilityRole="button"
                  disabled={!!busy || !connected}
                  onPress={() =>
                    run('profile', async () => {
                      await deskRef.current!.publishProfile({
                        listed: true,
                        displayName: profileName.trim() || undefined,
                      })
                      setProfile(await stores!.vetting.getProfile(persona.communityDid))
                    })
                  }
                >
                  {busy === 'profile' ? <ActivityIndicator color="#FFFFFF" /> : null}
                  <Text style={styles.buttonText}>{t('Vetting.PublishProfile')}</Text>
                </Pressable>
                {profile ? (
                  <Text style={styles.label} testID={testIdWithKey('VettingProfilePublished')}>
                    {tp('Vetting.ProfilePublished', { when: new Date(profile.publishedAt).toLocaleString() })}
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}

          {request && vetterStep !== 'ticket' ? (
            // One request at a time, in its own container: the runner scopes its
            // lookups to the current VettingDeskRequest.
            <View style={{ gap: 18 }} testID={testIdWithKey('VettingDeskRequest')}>
              <Text style={styles.label} testID={testIdWithKey('VettingDeskStatus')}>
                {t(`Vetting.Status.${request.status}`)}
              </Text>

              {vetterStep === 'request' ? (
                <>
                  {stepHeader(stepNumber, 5, t('Vetting.SomeoneWantsVetting'))}
                  <Text style={styles.value}>{shortDid(request.applicantDid)}</Text>
                  <Pressable
                    style={styles.button}
                    testID={testIdWithKey('VettingOpenSessionButton')}
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() =>
                      run('session', () =>
                        deskRef.current!.openSession(
                          request.requestId,
                          ['name.legal'],
                          request.preferredMethod ?? 'inPerson'
                        )
                      )
                    }
                  >
                    <Text style={styles.buttonText}>{t('Vetting.OpenSession')}</Text>
                  </Pressable>
                </>
              ) : null}

              {vetterStep === 'match' && request.session ? (
                <>
                  {stepHeader(stepNumber, 5, t('Vetting.CompareCodes'))}
                  {matchStep(
                    request.session.matchCode,
                    t('Vetting.MatchQuestionVetter'),
                    () => setMatchConfirmed((m) => ({ ...m, [request.requestId]: true })),
                    // The vetter's decline reaches the applicant: the session ends on both phones.
                    () => run('decline', () => deskRef.current!.decline(request.requestId, 'match code differs'))
                  )}
                </>
              ) : null}

              {vetterStep === 'waitCard' ? (
                <>
                  {stepHeader(stepNumber, 5, t('Vetting.CompareCodes'))}
                  <View style={styles.row}>
                    <ActivityIndicator color={ColorPalette.brand.primary} />
                    <Text style={styles.value}>{t('Vetting.WaitingForCard')}</Text>
                  </View>
                </>
              ) : null}

              {vetterStep === 'check' && request.card ? (
                <>
                  {stepHeader(stepNumber, 5, t('Vetting.CheckTheirId'))}
                  <View style={styles.card}>
                    <Text style={styles.label}>{t('Vetting.CardReceived')}</Text>
                    {((request.card.claims as { type: string; value: string }[]) ?? []).map((c) => (
                      <Text
                        key={c.type}
                        style={[styles.value, { fontSize: 22 }]}
                        testID={testIdWithKey('VettingCardClaim')}
                      >
                        {c.type}: {String(c.value)}
                      </Text>
                    ))}
                  </View>
                  <Pressable
                    style={styles.button}
                    testID={testIdWithKey('VettingAttestButton')}
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() =>
                      run('attest', async () => {
                        if (!(await confirmWithBiometrics(shortDid(request.applicantDid), 'Attest'))) return
                        await deskRef.current!.attest(request.requestId, {
                          documentClasses: ['passport'],
                          claimsVerified: ['name.legal'],
                          livenessConfirmed: true,
                        })
                      })
                    }
                  >
                    {busy === 'attest' ? <ActivityIndicator color="#FFFFFF" /> : null}
                    <Text style={styles.buttonText}>{t('Vetting.Attest')}</Text>
                  </Pressable>
                </>
              ) : null}

              {vetterStep === 'request' || vetterStep === 'waitCard' || vetterStep === 'check' ? (
                // A session the vetter cannot finish — the person left, the wrong
                // ticket, anything — ends here; the decline reaches the applicant.
                <Pressable
                  style={[styles.button, { backgroundColor: ColorPalette.grayscale.mediumGrey }]}
                  testID={testIdWithKey('VettingEndSession')}
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() =>
                    run('decline', () => deskRef.current!.decline(request.requestId, 'session ended by the vetter'))
                  }
                >
                  <Text style={styles.buttonText}>{t('Vetting.EndSession')}</Text>
                </Pressable>
              ) : null}

              {vetterStep === 'done' ? (
                <>
                  {stepHeader(stepNumber, 5, t('Vetting.StatementIssued'))}
                  <View style={styles.row}>
                    <Icon name="check-circle" size={28} color={ColorPalette.semantic.success} />
                    <Text style={styles.value} testID={testIdWithKey('VettingStatementIssued')}>
                      {t('Vetting.StatementIssued')}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.button}
                    testID={testIdWithKey('VettingVetSomeoneElse')}
                    accessibilityRole="button"
                    onPress={() => setDoneDismissed((d) => ({ ...d, [request.requestId]: true }))}
                  >
                    <Text style={styles.buttonText}>{t('Vetting.VetSomeoneElse')}</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          {desk.length > 0 && (vetterStep === 'ticket' || vetterStep === 'done') ? (
            <Pressable
              style={[styles.button, { backgroundColor: ColorPalette.grayscale.mediumGrey }]}
              testID={testIdWithKey('VettingDeskClearButton')}
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() =>
                run('clear', async () => {
                  await stores!.vetting.clearDesk(persona.communityDid)
                  setDesk([])
                })
              }
            >
              <Text style={styles.buttonText}>{t('Vetting.ClearDesk')}</Text>
            </Pressable>
          ) : null}
          {errorLine}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ---------------------------------------------------------- the application
  const requests = application?.requests ?? []
  const active = requests.find((r) => ['sent', 'accepted', 'session', 'cardSent'].includes(r.status))
  const ended = requests.filter((r) => r.status === 'refused' || r.status === 'declined')
  const attestedCount = requests.filter((r) => r.status === 'attested').length
  type ApplicantStep = 'member' | 'name' | 'waiting' | 'match' | 'send' | 'checking' | 'apply' | 'ticket'
  const applicantStep: ApplicantStep = membershipRole
    ? 'member'
    : !application
      ? 'name'
      : active
        ? active.status === 'sent' || active.status === 'accepted'
          ? 'waiting'
          : active.status === 'cardSent'
            ? 'checking'
            : !matchConfirmed[active.vetterDid]
              ? 'match'
              : 'send'
        : attestedCount > 0 || application.submission
          ? 'apply'
          : 'ticket'
  const applicantNumber = { name: 1, ticket: 2, waiting: 3, match: 3, send: 4, checking: 4, apply: 5, member: 5 }[
    applicantStep
  ]

  /** Ask a vetter: scan their ticket, or paste it. */
  const ticketInputs = (
    <View style={styles.card}>
      <Pressable
        style={styles.button}
        testID={testIdWithKey('VettingScanTicketButton')}
        accessibilityRole="button"
        onPress={onScanTicket}
      >
        <Text style={styles.buttonText}>{t('Vetting.ScanTicket')}</Text>
      </Pressable>
      <Text style={styles.label}>{t('Vetting.PasteTicket')}</Text>
      <TextInput
        style={styles.input}
        testID={testIdWithKey('VettingTicketInput')}
        value={ticketLink}
        onChangeText={setTicketLink}
        placeholder="vetting-ticket:?v=1&…"
        placeholderTextColor={ColorPalette.grayscale.mediumGrey}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={styles.button}
        testID={testIdWithKey('VettingRequestButton')}
        accessibilityRole="button"
        disabled={!!busy || !ticketLink.trim()}
        onPress={() => run('request', () => applicantRef.current!.requestVetter({ link: ticketLink.trim() }))}
      >
        {busy === 'request' ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.buttonText}>{t('Vetting.Request')}</Text>
      </Pressable>
    </View>
  )

  const requestCard = (r: (typeof requests)[number]) => (
    // Keyed by the request, not the vetter: asking the same vetter again is a
    // new request, and mounts a new card rather than relabelling the old one.
    <View key={r.requestDocumentId} style={styles.card} testID={testIdWithKey('VettingRequestCard')}>
      <Text style={styles.value}>{shortDid(r.vetterDid)}</Text>
      <Text style={styles.label} testID={testIdWithKey('VettingRequestStatus')}>
        {t(`Vetting.Status.${r.status}`)}
        {r.eligibilityOk ? ` · ${t('Vetting.EligibleVetter')}` : ''}
      </Text>
      {/* When it was sent is what a person can use to tell two requests apart;
          which request it is rides in the testID, for tests only. Requests
          stored before sentAt existed show no line. */}
      {r.sentAt ? (
        <Text style={styles.label} testID={testIdWithKey(requestTestKey(r.requestDocumentId))}>
          {t('Vetting.SentAt', {
            time: new Date(r.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })}
        </Text>
      ) : null}
    </View>
  )

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        {seatBanner('applicant')}

        {applicantStep === 'member' ? (
          <View style={styles.row}>
            <Icon name="check-circle" size={28} color={ColorPalette.semantic.success} />
            <Text style={styles.value} testID={testIdWithKey('VettingAlreadyMember')}>
              {tp('Vetting.AlreadyMember', { role: membershipRole })}
            </Text>
          </View>
        ) : null}

        {applicantStep === 'name' && !heldRead ? (
          <View style={styles.row} testID={testIdWithKey('VettingReadingHeld')}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <Text style={styles.value}>{t('Vetting.ReadingHeld')}</Text>
          </View>
        ) : null}

        {applicantStep === 'name' && heldRead ? (
          <>
            {stepHeader(applicantNumber, 5, t('Vetting.YourFace'))}
            <View style={styles.card}>
              <Text style={styles.label}>{t('Vetting.LegalName')}</Text>
              <TextInput
                style={styles.input}
                testID={testIdWithKey('VettingLegalNameInput')}
                value={legalName}
                onChangeText={setLegalName}
                placeholder={t('Vetting.LegalNamePlaceholder')}
                placeholderTextColor={ColorPalette.grayscale.mediumGrey}
                autoCapitalize="words"
              />
              {seed?.legalName && legalName.trim() === seed.legalName ? (
                <Text style={styles.label} testID={testIdWithKey('VettingNameFromProfile')}>
                  {seed.profileLabel
                    ? tp('Join.FromProfile', { profile: seed.profileLabel })
                    : t('Join.FromYourProfile')}
                </Text>
              ) : null}
              <Text style={styles.label}>{t('Vetting.FaceNote')}</Text>
              <Pressable
                style={styles.button}
                testID={testIdWithKey('VettingStartButton')}
                accessibilityRole="button"
                disabled={!!busy || !connected || !legalName.trim()}
                onPress={() =>
                  run('start', async () => {
                    const m = manifest ?? (await vtiAgent.fetchManifest(communityDid))
                    setManifest(m)
                    await applicantRef.current!.start(m, { 'name.legal': legalName.trim() })
                  })
                }
              >
                {busy === 'start' || !connected ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.buttonText}>
                  {!connected ? t('Vetting.Connecting') : t('Vetting.StartApplication')}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {application && applicantStep !== 'name' && applicantStep !== 'member' ? (
          <Text style={styles.value} testID={testIdWithKey('VettingRequirements')}>
            {tp('Vetting.Requirements', {
              n: application.minStatements,
              claims: application.requiredClaims.join(', '),
            })}
          </Text>
        ) : null}

        {applicantStep === 'ticket' ? (
          <>
            {stepHeader(applicantNumber, 5, t('Vetting.AskAVetter'))}
            {ended.length ? (
              <Text style={styles.label} testID={testIdWithKey('VettingSessionEnded')}>
                {t('Vetting.CodesDifferEnded')}
              </Text>
            ) : null}
            {ticketInputs}
            {ended.map(requestCard)}
          </>
        ) : null}

        {applicantStep === 'waiting' && active ? (
          <>
            {stepHeader(applicantNumber, 5, t('Vetting.AskAVetter'))}
            <View style={styles.row}>
              <ActivityIndicator color={ColorPalette.brand.primary} />
              <Text style={styles.value}>{t('Vetting.WaitingForVetter')}</Text>
            </View>
            {requestCard(active)}
          </>
        ) : null}

        {applicantStep === 'match' && active?.session ? (
          <>
            {stepHeader(applicantNumber, 5, t('Vetting.CompareCodes'))}
            {matchStep(
              active.session.matchCode,
              t('Vetting.MatchQuestionApplicant'),
              () => setMatchConfirmed((m) => ({ ...m, [active.vetterDid]: true })),
              () => run('abandon', () => applicantRef.current!.abandonSession(active.vetterDid))
            )}
            {requestCard(active)}
          </>
        ) : null}

        {applicantStep === 'send' && active ? (
          <>
            {stepHeader(applicantNumber, 5, t('Vetting.SendNameTitle'))}
            <View style={styles.card}>
              <Text style={styles.value}>
                {tp('Vetting.CardPreview', { name: legalName || application?.claims['name.legal'] || '' })}
              </Text>
              <Pressable
                style={styles.button}
                testID={testIdWithKey('VettingSendCardButton')}
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() =>
                  run('card', async () => {
                    if (!(await confirmWithBiometrics(shortDid(active.vetterDid), 'Send'))) return
                    await applicantRef.current!.sendCard(active.vetterDid)
                  })
                }
              >
                {busy === 'card' ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.buttonText}>{t('Vetting.SendCard')}</Text>
              </Pressable>
            </View>
            {requestCard(active)}
          </>
        ) : null}

        {applicantStep === 'checking' && active ? (
          <>
            {stepHeader(applicantNumber, 5, t('Vetting.SendNameTitle'))}
            <View style={styles.row}>
              <ActivityIndicator color={ColorPalette.brand.primary} />
              <Text style={styles.value}>{t('Vetting.WaitingForStatement')}</Text>
            </View>
            {active.session ? <Text style={styles.code}>{active.session.matchCode}</Text> : null}
            {requestCard(active)}
          </>
        ) : null}

        {applicantStep === 'apply' && application ? (
          <>
            {stepHeader(applicantNumber, 5, t('Vetting.Checklist'))}
            <View style={styles.card}>
              <Text style={styles.value} testID={testIdWithKey('VettingChecklist')}>
                {tp('Vetting.ChecklistLine', {
                  held: checklist?.held ?? 0,
                  needed: checklist?.needed ?? application.minStatements,
                })}
                {checklist?.meets ? ` · ${t('Vetting.Meets')}` : ''}
              </Text>
              {checklist?.discounted ? (
                <Text style={styles.error} testID={testIdWithKey('VettingDiscounted')}>
                  {tp('Vetting.Discounted', { n: checklist.discounted })}
                </Text>
              ) : null}
              {/*
                A grant we could not reach is said out loud rather than folded
                into the count above. The applicant can still submit — being
                offline is not a finding — but they should not be told the
                statement is good when nobody asked.
              */}
              {checklist?.unchecked?.length ? (
                <Text style={styles.label} testID={testIdWithKey('VettingGrantUnchecked')}>
                  {tp('Vetting.GrantUnchecked', { n: checklist.unchecked.length })}
                </Text>
              ) : null}
              {/* The reason stays in the record; a developer build says it. */}
              {__DEV__ && checklist?.unchecked?.length ? (
                <Text style={styles.label} testID={testIdWithKey('VettingGrantUncheckedReason')}>
                  {checklist.unchecked.map((u) => u.reason).join('\n')}
                </Text>
              ) : null}
              {/*
                What is still missing, in the community's own terms — a count
                alone cannot say "one of them has to be in person".
              */}
              {checklist?.needs?.length ? (
                <Text style={styles.label} testID={testIdWithKey('VettingNeeds')}>
                  {checklist.needs
                    .map((need) =>
                      need.kind === 'method'
                        ? tp('Vetting.NeedsMethod', { n: need.n, method: t(`Vetting.Method.${need.method}`) })
                        : tp('Vetting.NeedsStatements', { n: need.n })
                    )
                    .join(' · ')}
                </Text>
              ) : null}
              {/*
                An exceeded relationship cap is a referral, not a refusal: the
                application still stands and a human will look at it. Saying so
                is kinder than letting the delay look like a fault.
              */}
              {checklist && !checklist.independenceOk ? (
                <Text style={styles.label} testID={testIdWithKey('VettingIndependence')}>
                  {tp('Vetting.IndependenceCapped', {
                    relationships: checklist.exceededCaps.map((c) => c.relationship).join(', '),
                  })}
                </Text>
              ) : null}
              {checklist?.unreadableMaxAge ? (
                <Text style={styles.label} testID={testIdWithKey('VettingUnreadableAge')}>
                  {tp('Vetting.UnreadableMaxAge', { value: checklist.unreadableMaxAge })}
                </Text>
              ) : null}
              {checklist?.meets ? (
                <Pressable
                  style={styles.button}
                  testID={testIdWithKey('VettingApplyButton')}
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() =>
                    run('apply', async () => {
                      if (!(await confirmWithBiometrics(shortDid(communityDid), 'Apply'))) return
                      const m = manifest ?? (await vtiAgent.fetchManifest(communityDid))
                      // Ask about the grants now, not when the statements were
                      // gathered: the community applies the status at intake,
                      // so a vetter revoked since is the case this catches.
                      await applicantRef.current!.refreshGrantStatus()
                      const { statements } = await applicantRef.current!.checklist()
                      const stopInbox = vtiAgent.onInbound((msg) => {
                        void receiveIssue(stores!.community, persona.did, msg, { via: 'vetting' })
                      })
                      try {
                        // Submits, or answers an open deferral in place — a
                        // second submit while one is open would be refused.
                        let verdict
                        try {
                          verdict = await applicantRef.current!.submit(m, statements, application?.requirementsDigest)
                        } catch (e) {
                          // Already applied (requestAlreadyOpen): not an error. The
                          // open request is now recorded on the application, and the
                          // card below says where it stands and what can be done.
                          if (openJoinRequestOf(e)) {
                            setAlreadyOpen(true)
                            return
                          }
                          throw e
                        }
                        // A deferral or a referral leaves the request open;
                        // the submission card says where it stands and what
                        // the applicant can do. Only a verdict that closes it
                        // without admitting them is an error.
                        if (verdict.effect === 'requestMore' || verdict.effect === 'refer') return
                        if (verdict.effect !== 'allow')
                          throw new Error(
                            `${verdict.effect}${verdict.needs.length ? `: ${verdict.needs.join(', ')}` : ''}`
                          )
                        for (let i = 0; i < 20; i++) {
                          const mem = await stores!.community.getMembership(communityDid)
                          if (mem) {
                            if (mem.via === 'unknown')
                              await stores!.community.saveMembership({ ...mem, via: 'vetting' })
                            break
                          }
                          await new Promise((res) => setTimeout(res, 1500))
                        }
                      } finally {
                        setTimeout(stopInbox, 30000)
                      }
                    })
                  }
                >
                  {busy === 'apply' ? <ActivityIndicator color="#FFFFFF" /> : null}
                  <Text style={styles.buttonText}>
                    {application?.submission?.state === 'deferred' ? t('Vetting.AddWhatTheyAsked') : t('MyAgent.Apply')}
                  </Text>
                </Pressable>
              ) : null}
              {/*
                Where the join request stands, once there is one. A deferral is
                the community asking for more, not a failure: the applicant can
                gather and send again, or close it and be free to apply anew.
              */}
              {application?.submission ? (
                <View testID={testIdWithKey('VettingSubmission')}>
                  {alreadyOpen ? (
                    <Text style={styles.value} testID={testIdWithKey('VettingAlreadyApplied')}>
                      {t('Vetting.AlreadyApplied')}
                    </Text>
                  ) : null}
                  <Text style={styles.label} testID={testIdWithKey('VettingSubmissionState')}>
                    {application.submission.state === 'deferred'
                      ? tp('Vetting.SubmissionDeferred', {
                          needs: (application.submission.needs ?? []).join(', ') || '—',
                        })
                      : application.submission.state === 'pending'
                        ? t('Vetting.SubmissionPending')
                        : application.submission.state === 'withdrawn'
                          ? t('Vetting.SubmissionWithdrawn')
                          : tp('Vetting.SubmissionDecided', { effect: application.submission.effect ?? '—' })}
                  </Text>
                  {application.submission.state === 'deferred' || application.submission.state === 'pending' ? (
                    <Pressable
                      style={[styles.button, { backgroundColor: ColorPalette.grayscale.mediumGrey }]}
                      testID={testIdWithKey('VettingWithdrawButton')}
                      accessibilityRole="button"
                      disabled={!!busy}
                      onPress={() =>
                        run('withdraw', async () => {
                          const outcome = await applicantRef.current!.withdraw()
                          if (outcome === 'nothingOpen') throw new Error(t('Vetting.WithdrawNothingOpen'))
                        })
                      }
                    >
                      {busy === 'withdraw' ? <ActivityIndicator color="#FFFFFF" /> : null}
                      <Text style={styles.buttonText}>{t('Vetting.Withdraw')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            {/* Not enough yet: ask another vetter from here. */}
            {!checklist?.meets ? (
              <>
                <Text style={styles.h}>{t('Vetting.AskAnotherVetter')}</Text>
                {ticketInputs}
              </>
            ) : null}
            {requests.map(requestCard)}
          </>
        ) : null}

        {!connected ? (
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <Text style={styles.value}>{t('MyAgent.Authenticating')}</Text>
          </View>
        ) : null}
        {errorLine}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtiVetting
