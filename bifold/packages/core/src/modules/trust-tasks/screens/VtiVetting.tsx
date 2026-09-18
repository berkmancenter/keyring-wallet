/**
 * Vetting — the two seats of peer identity vetting on one screen, decided by
 * what this phone holds: a vetter grant for the community makes it the
 * vetter's desk; otherwise it is the applicant's application. Both ride the
 * persona's community session; both are the reference client's flows
 * (design §8–§10) with the terminal taken out of the room.
 *
 * @module trust-tasks/screens/VtiVetting
 */

import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore, type VtiHeldCredential } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { vtiClientIdentityFromPersona } from '../module/VtiMediatorTransport'
import { vtiAgent, type VtiManifest } from '../module/vtiAgent'
import { receiveIssue } from '../module/vtiInbox'
import {
  GenericRecordsVettingStore,
  VtiApplicant,
  VtiVetterDesk,
  type VettingApplication,
  type VettingDeskRequest,
  type VettingTicket,
} from '../module/vtiVetting'
import { ensurePersonaFor } from '../module/vtiJoin'

const shortDid = (did?: string) => (did && did.length > 32 ? `${did.slice(0, 22)}…${did.slice(-10)}` : did ?? '')

export interface VtiVettingProps {
  config?: { mediatorDid?: string; communityDid?: string; vtaDid?: string }
}

const VtiVetting: React.FC<VtiVettingProps> = ({ config }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { agent } = useAgent()
  const communityDid = config?.communityDid
  const mediatorDid = config?.mediatorDid
  const vtaDid = config?.vtaDid

  const [persona, setPersona] = useState<VtiPersona>()
  const [grant, setGrant] = useState<VtiHeldCredential>()
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [tick, setTick] = useState(0)
  const bump = useCallback(() => setTick((n) => n + 1), [])

  // desk
  const [tickets, setTickets] = useState<(VettingTicket & { link: string })[]>([])
  const [desk, setDesk] = useState<VettingDeskRequest[]>([])
  // application
  const [application, setApplication] = useState<VettingApplication>()
  const [manifest, setManifest] = useState<VtiManifest>()
  const [legalName, setLegalName] = useState('')
  const [ticketLink, setTicketLink] = useState('')
  const [checklist, setChecklist] = useState<{ held: number; needed: number; meets: boolean }>()
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
    code: { fontSize: 40, fontWeight: '700', letterSpacing: 4, color: TextTheme.normal.color, textAlign: 'center', paddingVertical: 8 },
    mono: { fontFamily: 'Courier', fontSize: 12, color: ColorPalette.grayscale.mediumGrey },
    button: { backgroundColor: ColorPalette.brand.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
    buttonText: { ...TextTheme.bold, color: '#FFFFFF' },
    input: { borderWidth: 1, borderColor: ColorPalette.grayscale.lightGrey, borderRadius: 8, padding: 10, color: TextTheme.normal.color, backgroundColor: ColorPalette.brand.primaryBackground },
    error: { ...TextTheme.normal, color: ColorPalette.semantic.error },
    row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  })

  // Load what the phone holds, and connect the persona's session with an inbox.
  useEffect(() => {
    if (!agent || !stores || !communityDid || !mediatorDid) return
    let cancelled = false
    void (async () => {
      const p = await stores.identity.getPersona(communityDid)
      if (cancelled) return
      setPersona(p)
      if (!p?.kmsKeyIds?.keyAgreement) return
      try {
        if (vtiAgent.getState().did !== p.did) {
          const identity = await vtiClientIdentityFromPersona(agent, p.did, p.kmsKeyIds.keyAgreement)
          await vtiAgent.connect(agent, mediatorDid, { identity })
        }
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
  useEffect(() => {
    if (!agent || !stores || !persona || !connected) return
    const stopIssue = vtiAgent.onInbound((m) => {
      void receiveIssue(stores.community, persona.did, m).then((got) => got.length && bump())
    })
    const refreshSeat = async () => {
      const grants = await stores.community.listHeldCredentials('vetter-grant', persona.communityDid)
      const g = grants.find((x) => x.subjectDid === persona.did)
      setGrant(g)
      const m = await stores.community.getMembership(persona.communityDid)
      setMembershipRole(m?.role)
      if (g) {
        if (!deskRef.current) deskRef.current = new VtiVetterDesk(agent, persona, stores.vetting, stores.community, bump)
        deskRef.current.listen()
        const ts = await stores.vetting.listTickets(persona.communityDid)
        setTickets(ts.map((x) => ({ ...x, link: deskRef.current!.linkFor(x) })))
        setDesk(await stores.vetting.listDesk())
      } else {
        if (!applicantRef.current) applicantRef.current = new VtiApplicant(agent, persona, stores.vetting, stores.community, bump)
        applicantRef.current.listen()
        const a = await stores.vetting.getApplication(persona.communityDid)
        setApplication(a)
        if (a) {
          setLegalName((v) => v || a.claims['name.legal'] || '')
          setChecklist(await applicantRef.current.checklist())
        }
      }
    }
    void refreshSeat()
    const timer = setInterval(() => void refreshSeat(), 3000)
    return () => {
      clearInterval(timer)
      stopIssue()
    }
  }, [agent, stores, persona, connected, bump])

  const run = useCallback(async (name: string, fn: () => Promise<unknown>) => {
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
  }, [bump])

  if (!communityDid || !mediatorDid || !vtaDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}><Text style={styles.value}>{t('MyAgent.NotConfigured')}</Text></View>
      </SafeAreaView>
    )
  }

  // No persona yet: the join DID is chosen before gathering, so this is step one.
  if (!persona) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.h}>{t('Vetting.Title')}</Text>
          <Text style={styles.value}>{t('Vetting.NeedIdentity')}</Text>
          <Pressable style={styles.button} testID={testIdWithKey('VettingCreateIdentityButton')} accessibilityRole="button" disabled={!!busy}
            onPress={() => run('identity', async () => { if (agent && stores) await ensurePersonaFor({ agent, identityStore: stores.identity, vtaDid, communityDid }) })}>
            {busy === 'identity' ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.buttonText}>{t('MyAgent.CreateIdentity')}</Text>
          </Pressable>
          {error ? <Text style={styles.error} testID={testIdWithKey('VettingError')}>{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ---------------------------------------------------------------- the desk
  if (grant) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.h}>{t('Vetting.DeskTitle')}</Text>
          <Text style={styles.value} testID={testIdWithKey('VettingYouVetFor')}>{t('Vetting.YouVetFor', { community: shortDid(persona.communityDid) })}</Text>

          <Text style={styles.h}>{t('Vetting.Tickets')}</Text>
          <Pressable style={styles.button} testID={testIdWithKey('VettingNewTicketButton')} accessibilityRole="button" disabled={!!busy}
            onPress={() => run('ticket', () => deskRef.current!.issueTicket())}>
            {busy === 'ticket' ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.buttonText}>{t('Vetting.NewTicket')}</Text>
          </Pressable>
          {tickets.filter((x) => x.usesLeft > 0).slice(-1).map((x) => (
            <View key={x.ticketId} style={styles.card} testID={testIdWithKey('VettingTicketCard')}>
              <Text style={styles.label}>{t('Vetting.ReadAloud')}</Text>
              <Text style={styles.code} testID={testIdWithKey('VettingTicketCode')}>{x.code}</Text>
              <Text style={styles.label}>{t('Vetting.OrScan')}</Text>
              <Text style={styles.mono} testID={testIdWithKey('VettingTicketLink')} selectable>{x.link}</Text>
              <Text style={styles.label}>{t('Vetting.TicketValid', { uses: x.usesLeft, until: x.expiresAt.slice(0, 10) })}</Text>
            </View>
          ))}

          <Text style={styles.h}>{t('Vetting.Desk')}</Text>
          {desk.length === 0 ? <Text style={styles.value} testID={testIdWithKey('VettingDeskEmpty')}>{t('Vetting.DeskEmpty')}</Text> : null}
          {desk.map((r) => (
            <View key={r.requestId} style={styles.card} testID={testIdWithKey('VettingDeskRequest')}>
              <Text style={styles.value}>{shortDid(r.applicantDid)}</Text>
              <Text style={styles.label} testID={testIdWithKey('VettingDeskStatus')}>{t(`Vetting.Status.${r.status}`)}</Text>
              {r.status === 'accepted' ? (
                <Pressable style={styles.button} testID={testIdWithKey('VettingOpenSessionButton')} accessibilityRole="button" disabled={!!busy}
                  onPress={() => run('session', () => deskRef.current!.openSession(r.requestId, ['name.legal'], r.preferredMethod ?? 'inPerson'))}>
                  <Text style={styles.buttonText}>{t('Vetting.OpenSession')}</Text>
                </Pressable>
              ) : null}
              {r.session && (r.status === 'session' || r.status === 'cardReceived') ? (
                <>
                  <Text style={styles.label}>{t('Vetting.MatchCodeHint')}</Text>
                  <Text style={styles.code} testID={testIdWithKey('VettingMatchCode')}>{r.session.matchCode}</Text>
                </>
              ) : null}
              {r.status === 'cardReceived' && r.card ? (
                <>
                  <Text style={styles.label}>{t('Vetting.CardReceived')}</Text>
                  {((r.card.claims as { type: string; value: string }[]) ?? []).map((c) => (
                    <Text key={c.type} style={styles.value} testID={testIdWithKey('VettingCardClaim')}>{c.type}: {String(c.value)}</Text>
                  ))}
                  <Pressable style={styles.button} testID={testIdWithKey('VettingAttestButton')} accessibilityRole="button" disabled={!!busy}
                    onPress={() => run('attest', () => deskRef.current!.attest(r.requestId, { documentClasses: ['passport'], claimsVerified: ['name.legal'], livenessConfirmed: true }))}>
                    {busy === 'attest' ? <ActivityIndicator color="#FFFFFF" /> : null}
                    <Text style={styles.buttonText}>{t('Vetting.Attest')}</Text>
                  </Pressable>
                </>
              ) : null}
              {r.status === 'attested' ? <Text style={styles.value} testID={testIdWithKey('VettingStatementIssued')}>{t('Vetting.StatementIssued')}</Text> : null}
            </View>
          ))}
          {error ? <Text style={styles.error} testID={testIdWithKey('VettingError')}>{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ---------------------------------------------------------- the application
  const requests = application?.requests ?? []
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h}>{t('Vetting.Title')}</Text>
        {membershipRole ? <Text style={styles.value} testID={testIdWithKey('VettingAlreadyMember')}>{t('Vetting.AlreadyMember', { role: membershipRole })}</Text> : null}

        <Text style={styles.h}>{t('Vetting.YourFace')}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>{t('Vetting.LegalName')}</Text>
          <TextInput style={styles.input} testID={testIdWithKey('VettingLegalNameInput')} value={legalName} onChangeText={setLegalName} placeholder={t('Vetting.LegalNamePlaceholder')} placeholderTextColor={ColorPalette.grayscale.mediumGrey} autoCapitalize="words" />
          <Text style={styles.label}>{t('Vetting.FaceNote')}</Text>
          <Pressable style={styles.button} testID={testIdWithKey('VettingStartButton')} accessibilityRole="button" disabled={!!busy || !connected}
            onPress={() => run('start', async () => {
              const m = manifest ?? (await vtiAgent.fetchManifest(communityDid))
              setManifest(m)
              await applicantRef.current!.start(m, { 'name.legal': legalName.trim() })
            })}>
            {busy === 'start' || !connected ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.buttonText}>{!connected ? t('Vetting.Connecting') : application ? t('Vetting.SaveFace') : t('Vetting.StartApplication')}</Text>
          </Pressable>
        </View>

        {application ? (
          <>
            <Text style={styles.value} testID={testIdWithKey('VettingRequirements')}>{t('Vetting.Requirements', { n: application.minStatements, claims: application.requiredClaims.join(', ') })}</Text>

            <Text style={styles.h}>{t('Vetting.AskAVetter')}</Text>
            <View style={styles.card}>
              <Text style={styles.label}>{t('Vetting.PasteTicket')}</Text>
              <TextInput style={styles.input} testID={testIdWithKey('VettingTicketInput')} value={ticketLink} onChangeText={setTicketLink} placeholder="vetting-ticket:?v=1&…" placeholderTextColor={ColorPalette.grayscale.mediumGrey} autoCapitalize="none" autoCorrect={false} />
              <Pressable style={styles.button} testID={testIdWithKey('VettingRequestButton')} accessibilityRole="button" disabled={!!busy || !ticketLink.trim()}
                onPress={() => run('request', () => applicantRef.current!.requestVetter({ link: ticketLink.trim() }))}>
                {busy === 'request' ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.buttonText}>{t('Vetting.Request')}</Text>
              </Pressable>
            </View>

            {requests.map((r) => (
              <View key={r.vetterDid} style={styles.card} testID={testIdWithKey('VettingRequestCard')}>
                <Text style={styles.value}>{shortDid(r.vetterDid)}</Text>
                <Text style={styles.label} testID={testIdWithKey('VettingRequestStatus')}>{t(`Vetting.Status.${r.status}`)}{r.eligibilityOk ? ` · ${t('Vetting.EligibleVetter')}` : ''}</Text>
                {r.session && r.status === 'session' ? (
                  <>
                    <Text style={styles.label}>{t('Vetting.MatchCodeHint')}</Text>
                    <Text style={styles.code} testID={testIdWithKey('VettingMatchCode')}>{r.session.matchCode}</Text>
                    <Text style={styles.label}>{t('Vetting.CardPreview', { name: legalName || application.claims['name.legal'] || '' })}</Text>
                    <Pressable style={styles.button} testID={testIdWithKey('VettingSendCardButton')} accessibilityRole="button" disabled={!!busy}
                      onPress={() => run('card', () => applicantRef.current!.sendCard(r.vetterDid))}>
                      {busy === 'card' ? <ActivityIndicator color="#FFFFFF" /> : null}
                      <Text style={styles.buttonText}>{t('Vetting.SendCard')}</Text>
                    </Pressable>
                  </>
                ) : null}
                {r.session && r.status === 'cardSent' ? <Text style={styles.code}>{r.session.matchCode}</Text> : null}
              </View>
            ))}

            <Text style={styles.h}>{t('Vetting.Checklist')}</Text>
            <View style={styles.card}>
              <Text style={styles.value} testID={testIdWithKey('VettingChecklist')}>
                {t('Vetting.ChecklistLine', { held: checklist?.held ?? 0, needed: checklist?.needed ?? application.minStatements })}{checklist?.meets ? ` · ${t('Vetting.Meets')}` : ''}
              </Text>
              {checklist?.meets && !membershipRole ? (
                <Pressable style={styles.button} testID={testIdWithKey('VettingApplyButton')} accessibilityRole="button" disabled={!!busy}
                  onPress={() => run('apply', async () => {
                    const m = manifest ?? (await vtiAgent.fetchManifest(communityDid))
                    const { statements } = await applicantRef.current!.checklist()
                    const stopInbox = vtiAgent.onInbound((msg) => { void receiveIssue(stores!.community, persona.did, msg, { via: 'vetting' }) })
                    try {
                      const verdict = await vtiAgent.apply(communityDid, m, { credentials: statements })
                      if (verdict.effect !== 'allow') throw new Error(`${verdict.effect}${verdict.needs.length ? `: ${verdict.needs.join(', ')}` : ''}`)
                      for (let i = 0; i < 20; i++) {
                        const mem = await stores!.community.getMembership(communityDid)
                        if (mem) { if (mem.via === 'unknown') await stores!.community.saveMembership({ ...mem, via: 'vetting' }); break }
                        await new Promise((res) => setTimeout(res, 1500))
                      }
                    } finally {
                      setTimeout(stopInbox, 30000)
                    }
                  })}>
                  {busy === 'apply' ? <ActivityIndicator color="#FFFFFF" /> : null}
                  <Text style={styles.buttonText}>{t('MyAgent.Apply')}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
        {!connected ? <View style={styles.row}><ActivityIndicator color={ColorPalette.brand.primary} /><Text style={styles.value}>{t('MyAgent.Authenticating')}</Text></View> : null}
        {error ? <Text style={styles.error} testID={testIdWithKey('VettingError')}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtiVetting
