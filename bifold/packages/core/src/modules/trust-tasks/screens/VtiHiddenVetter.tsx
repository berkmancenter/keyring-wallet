/**
 * Vouching privately: a vetter in a community that runs hidden vetting. Their
 * agent enrols for each period, draws tokens on each tick, and turns a token
 * into an attestation after a session, so the community learns that enough
 * members vouched for a person, never which (hiddenVetterSeam).
 *
 * The vetter knows who they vouch for (they met them); the community does
 * not learn who vouched. The screen says both, plainly.
 *
 * @module trust-tasks/screens/VtiHiddenVetter
 */

import { useAgent } from '@bifold/react-hooks'
import { useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiCriterion } from '../module/joinManifest'
import { vtiAgent } from '../module/vtiAgent'

import { communityLabelOf, identityWord } from './communityName'
import { pcsErrorCode } from './hiddenVettingSeam'
import {
  DECLARED_RELATIONSHIPS,
  drawDue,
  hiddenVetterSeam,
  type DeclaredRelationship,
  type HiddenVetterRequest,
  type HiddenVetterStanding,
  VOUCH_METHODS,
  type VouchMethod,
} from './hiddenVetterSeam'
import { localDate } from './localTime'

export const HiddenVetterIds = {
  screen: 'HiddenVetter',
  notAvailable: 'HiddenVetterNotAvailable',
  enrol: 'HiddenVetterEnrol',
  standing: 'HiddenVetterStanding',
  tokens: 'HiddenVetterTokens',
  nextDraw: 'HiddenVetterNextDraw',
  lapses: 'HiddenVetterLapses',
  draw: 'HiddenVetterDraw',
  noRequests: 'HiddenVetterNoRequests',
  request: 'HiddenVetterRequest',
  vouch: 'HiddenVetterVouch',
  decline: 'HiddenVetterDecline',
  method: 'HiddenVetterMethod',
  claims: 'HiddenVetterClaims',
  live: 'HiddenVetterLive',
  relationship: 'HiddenVetterRelationship',
  confirm: 'HiddenVetterConfirm',
  done: 'HiddenVetterDone',
  error: 'HiddenVetterError',
} as const

/** A vetter's error code, in words. */
export function hiddenVetterErrorKey(code: string | undefined): string {
  if (!code) return 'Vetting.Vouch.ErrorGeneric'
  if (code.endsWith(':noToken')) return 'Vetting.Vouch.NoTokensError'
  if (code.endsWith(':notEnrolled')) return 'Vetting.Vouch.NotEnrolledError'
  // The community's vetter or token period is not live any more.
  if (code.endsWith(':labelNotLive')) return 'Vetting.Vouch.PeriodClosed'
  // A draw already running, accepted twice, or more than one tick allows.
  if (code.endsWith(':alreadyInFlight') || code.endsWith(':noDrawInFlight') || code.endsWith(':countExceedsDrip'))
    return 'Vetting.Vouch.DrawBusy'
  if (code.endsWith(':notImplemented')) return 'Vetting.Hidden.NotInThisBuild'
  return 'Vetting.Vouch.ErrorGeneric'
}

const VtiHiddenVetter: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const { communityDid, criterionId } = (useRoute().params ?? {}) as { communityDid: string; criterionId: string }
  const seam = hiddenVetterSeam()
  const community = communityLabelOf(communityDid, t)
  const named = { community, interpolation: { escapeValue: false } }

  const [criterion, setCriterion] = useState<VtiCriterion>()
  const [standing, setStanding] = useState<HiddenVetterStanding>()
  const [requests, setRequests] = useState<HiddenVetterRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState<string>()
  const [method, setMethod] = useState<VouchMethod>()
  const [claimsChecked, setClaimsChecked] = useState(false)
  const [live, setLive] = useState(false)
  const [relationship, setRelationship] = useState<DeclaredRelationship>()
  const [vouched, setVouched] = useState<string[]>([])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  const say = (e: unknown) => setError(t(hiddenVetterErrorKey(pcsErrorCode(e)), named) as string)

  const reread = useCallback(
    async (c: VtiCriterion) => {
      if (!agent || !seam) return undefined
      // Never enrolled is a standing, not a failure: the screen offers to enrol.
      const standingOf = () =>
        seam.standing(agent, communityDid, c).catch((e: unknown): HiddenVetterStanding => {
          if (pcsErrorCode(e)?.endsWith('vetter/show:notFound')) return { enrolled: false, tokens: 0 }
          throw e
        })
      const [s, r] = await Promise.all([standingOf(), seam.requests(agent, communityDid)])
      setStanding(s)
      setRequests(r)
      return s
    },
    [agent, seam, communityDid]
  )

  // Where the agent stands, and what is waiting; a draw that is due is made,
  // since tokens are only drawn while Keyring is open.
  useEffect(() => {
    if (!agent || !seam || !communityDid) return
    let live = true
    void (async () => {
      try {
        const manifest = await vtiAgent.fetchManifest(communityDid)
        const found = manifest.criteria.find((c) => c.id === criterionId)
        if (!found || !live) return
        setCriterion(found)
        const s = await reread(found)
        if (live && drawDue(s, Date.now())) {
          await seam.drawTokens(agent, communityDid, found)
          if (live) await reread(found)
        }
      } catch (e) {
        if (live) say(e)
      } finally {
        if (live) setLoaded(true)
      }
    })()
    return () => {
      live = false
    }
    // Read once per community and way in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, seam, communityDid, criterionId])

  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name)
    setError(undefined)
    try {
      await work()
    } catch (e) {
      say(e)
    } finally {
      setBusy(undefined)
    }
  }

  if (!seam) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content} testID={testIdWithKey(HiddenVetterIds.notAvailable)}>
          <ThemedText>{t('Vetting.Vouch.NotAvailable', named)}</ThemedText>
        </View>
      </SafeAreaView>
    )
  }

  const enrol = () =>
    run('enrol', async () => {
      if (!agent || !criterion) return
      await seam.enrol(agent, communityDid, criterion)
      // Just enrolled: draw this tick's tokens now.
      await seam.drawTokens(agent, communityDid, criterion)
      await reread(criterion)
    })

  const draw = () =>
    run('draw', async () => {
      if (!agent || !criterion) return
      await seam.drawTokens(agent, communityDid, criterion)
      await reread(criterion)
    })

  const startVouch = (id: string) => {
    setOpen(id)
    setMethod(undefined)
    setClaimsChecked(false)
    setLive(false)
    setRelationship(undefined)
  }

  const claims = (
    Array.isArray(criterion?.vetting?.requiredClaims) ? criterion?.vetting?.requiredClaims : ['name.legal']
  ) as string[]
  // Only the ways the criterion accepts: an attestation by another way would be refused.
  const accepted = criterion?.vetting?.acceptedMethods
  const methods = VOUCH_METHODS.filter((m) => !Array.isArray(accepted) || accepted.length === 0 || accepted.includes(m))

  const vouch = (request: HiddenVetterRequest) =>
    run(`vouch-${request.id}`, async () => {
      if (!agent || !criterion || !method || !relationship) return
      await seam.attest(agent, request.id, {
        method,
        claimsVerified: claims,
        livenessConfirmed: live,
        declaredRelationship: relationship,
      })
      setVouched((was) => [...was, request.id])
      setOpen(undefined)
      await reread(criterion)
    })

  const decline = (request: HiddenVetterRequest) =>
    run(`decline-${request.id}`, async () => {
      if (!agent || !criterion) return
      await seam.decline(agent, request.id)
      await reread(criterion)
    })

  const check = (checked: boolean, onPress: () => void, label: string, testID: string) => (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      testID={testIdWithKey(testID)}
    >
      <Icon
        name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={24}
        color={ColorPalette.brand.primary}
      />
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
    </Pressable>
  )

  const tokens = standing?.tokens ?? 0

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey(HiddenVetterIds.screen)}>
        <ThemedText variant="headingThree" accessibilityRole="header">
          {t('Vetting.Vouch.Title', named)}
        </ThemedText>
        <ThemedText style={styles.muted}>{t('Vetting.Vouch.Explain', named)}</ThemedText>

        {!loaded ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}

        {loaded && standing && !standing.enrolled ? (
          <View style={styles.card}>
            <ThemedText>{t('Vetting.Vouch.EnrolBody', named)}</ThemedText>
            <Button
              title={t('Vetting.Vouch.Enrol')}
              buttonType={ButtonType.Primary}
              disabled={Boolean(busy) || !criterion}
              onPress={enrol}
              testID={testIdWithKey(HiddenVetterIds.enrol)}
            />
          </View>
        ) : null}

        {standing?.enrolled ? (
          <View style={styles.card} testID={testIdWithKey(HiddenVetterIds.standing)}>
            <ThemedText variant="bold">
              {standing.enrolledUntil
                ? t('Vetting.Vouch.EnrolledUntil', { date: localDate(standing.enrolledUntil) })
                : t('Vetting.Vouch.Enrolled')}
            </ThemedText>
            <ThemedText testID={testIdWithKey(HiddenVetterIds.tokens)}>
              {t('Vetting.Vouch.Tokens', { count: tokens })}
            </ThemedText>
            {standing.nextDrawAt ? (
              <ThemedText style={styles.muted} testID={testIdWithKey(HiddenVetterIds.nextDraw)}>
                {t('Vetting.Vouch.NextDraw', { date: localDate(standing.nextDrawAt) })}
              </ThemedText>
            ) : null}
            {standing.lapsesAt && drawDue(standing, Date.now()) ? (
              <ThemedText testID={testIdWithKey(HiddenVetterIds.lapses)}>
                {t('Vetting.Vouch.LapsesOn', { date: localDate(standing.lapsesAt) })}
              </ThemedText>
            ) : null}
            {/* Tokens are drawn on a schedule, and only while Keyring is open. */}
            <ThemedText style={styles.muted}>{t('Vetting.Vouch.KeepOpening')}</ThemedText>
            {drawDue(standing, Date.now()) || tokens === 0 ? (
              <Button
                title={t('Vetting.Vouch.Draw')}
                buttonType={ButtonType.Secondary}
                disabled={Boolean(busy)}
                onPress={draw}
                testID={testIdWithKey(HiddenVetterIds.draw)}
              />
            ) : null}
          </View>
        ) : null}

        {standing?.enrolled ? (
          <>
            <ThemedText variant="labelTitle" accessibilityRole="header">
              {t('Vetting.Vouch.RequestsTitle')}
            </ThemedText>
            {requests.length === 0 ? (
              <ThemedText style={styles.muted} testID={testIdWithKey(HiddenVetterIds.noRequests)}>
                {t('Vetting.Vouch.NoRequests')}
              </ThemedText>
            ) : null}
            {requests.map((r) => (
              <View key={r.id} style={styles.card} testID={testIdWithKey(`${HiddenVetterIds.request}_${r.id}`)}>
                <ThemedText variant="bold">{r.applicantName ?? identityWord(r.applicantDid)}</ThemedText>
                <ThemedText style={styles.muted}>
                  {t('Vetting.Vouch.Received', { date: localDate(r.receivedAt) })}
                </ThemedText>
                {vouched.includes(r.id) ? (
                  <ThemedText testID={testIdWithKey(`${HiddenVetterIds.done}_${r.id}`)}>
                    {t('Vetting.Vouch.Done', named)}
                  </ThemedText>
                ) : open === r.id ? (
                  <View style={{ gap: 4 }}>
                    <ThemedText>{t('Vetting.Vouch.HowMet')}</ThemedText>
                    {methods.map((m) =>
                      check(
                        method === m,
                        () => setMethod(m),
                        t(`Vetting.Vouch.Method.${m}`),
                        `${HiddenVetterIds.method}_${m}`
                      )
                    )}
                    {check(
                      claimsChecked,
                      () => setClaimsChecked((was) => !was),
                      t('Vetting.Vouch.ClaimsChecked', named),
                      HiddenVetterIds.claims
                    )}
                    {check(live, () => setLive((was) => !was), t('Vetting.Vouch.Live'), HiddenVetterIds.live)}
                    {/* Declared by the vetter, with no default: the attestation carries it. */}
                    <ThemedText>{t('Vetting.Vouch.HowKnow')}</ThemedText>
                    {DECLARED_RELATIONSHIPS.map((rel) =>
                      check(
                        relationship === rel,
                        () => setRelationship(rel),
                        t(`Vetting.Vouch.Relationship.${rel}`),
                        `${HiddenVetterIds.relationship}_${rel}`
                      )
                    )}
                    {tokens === 0 ? (
                      <ThemedText style={styles.muted}>
                        {standing?.nextDrawAt
                          ? t('Vetting.Vouch.NoTokensUntil', { date: localDate(standing.nextDrawAt) })
                          : t('Vetting.Vouch.NoTokens')}
                      </ThemedText>
                    ) : null}
                    <Button
                      title={t('Vetting.Vouch.Confirm')}
                      buttonType={ButtonType.Primary}
                      disabled={Boolean(busy) || !method || !claimsChecked || !live || !relationship || tokens === 0}
                      onPress={() => vouch(r)}
                      testID={testIdWithKey(`${HiddenVetterIds.confirm}_${r.id}`)}
                    />
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    <Button
                      title={t('Vetting.Vouch.Vouch')}
                      buttonType={ButtonType.Primary}
                      disabled={Boolean(busy)}
                      onPress={() => startVouch(r.id)}
                      testID={testIdWithKey(`${HiddenVetterIds.vouch}_${r.id}`)}
                    />
                    <Button
                      title={t('Vetting.Vouch.Decline')}
                      buttonType={ButtonType.Tertiary}
                      disabled={Boolean(busy)}
                      onPress={() => decline(r)}
                      testID={testIdWithKey(`${HiddenVetterIds.decline}_${r.id}`)}
                    />
                  </View>
                )}
              </View>
            ))}
          </>
        ) : null}

        {error ? (
          <ThemedText style={{ color: ColorPalette.semantic.error }} testID={testIdWithKey(HiddenVetterIds.error)}>
            {error}
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtiHiddenVetter
