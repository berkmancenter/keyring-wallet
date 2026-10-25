/**
 * "Same person?", on a contact: when other contacts' cards give the same name (exchanging again with someone makes
 * another contact each time), offer to merge them all into one, in one step, on a merged contact too. The person
 * decides; the merge says it was theirs ("Merged by you"), never that the other phone confirmed it. A merged contact
 * can be separated again, every relationship its own contact. Neither touches a card, a connection or a message.
 *
 * Separate is a quiet link under the merge, not a button beside it: after a merge it is the way back, not the next
 * step. Once the other phone has confirmed the two are the same person, it is quieter still and asks first.
 *
 * @module vrc/components/ContactMergeSection
 */
import { useAgent } from '@bifold/react-hooks'
import type { W3cCredentialRecord } from '@credo-ts/core'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { ContactLinks } from '../contacts/contactLinks'
import { findMergeCandidates, mergeAllContacts, separateContact, type MergeCandidate } from '../contacts/mergeContacts'
import { askToConfirm, askedRecently, continuityEvents, isConfirmedByPeer } from '../contacts/continuity'

export interface ContactMergeSectionProps {
  /** The relationship the contact screen opened. */
  issuerId: string
  name: string
  /** Every relationship of this contact (more than one once merged). */
  relationships: string[]
  records: W3cCredentialRecord[]
  links: ContactLinks
  /** The connection of the relationship the screen opened, once known: a confirmation is asked over it. */
  connectionId?: string | null
  /** Called after a merge or a separation, so the screen reads the links again. */
  onChanged: () => void
}

export const ContactMergeSection: React.FC<ContactMergeSectionProps> = ({
  issuerId,
  name,
  relationships,
  records,
  links,
  connectionId,
  onChanged,
}) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [asking, setAsking] = useState<MergeCandidate[]>()
  const [separating, setSeparating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const merged = relationships.length > 1
  const candidates = useMemo(() => findMergeCandidates(records, links, issuerId), [records, links, issuerId])
  const words = { name, interpolation: { escapeValue: false } }
  // How many contacts a merge joins: this one and every namesake. Two keep the two-contact wording.
  const joining = candidates.length + 1
  const many = joining > 2
  const countWords = { ...words, count: joining }
  // A merge is the person's word until the other phone confirms it (continuity.ts); until then it can be asked to.
  const [confirmedByPhone, setConfirmedByPhone] = useState(false)
  const [asked, setAsked] = useState(false)
  const [checks, setChecks] = useState(0)

  useEffect(() => {
    if (!merged || !agent) return
    let cancelled = false
    void (async () => {
      const confirmed = await isConfirmedByPeer(agent, links, issuerId).catch(() => false)
      // An ask shows as asked for a day: a Not now is silent, so it may never be answered.
      const recent = connectionId ? await askedRecently(agent, connectionId).catch(() => false) : false
      if (!cancelled) {
        setConfirmedByPhone(confirmed)
        setAsked(recent)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [merged, agent, links, issuerId, connectionId, checks])

  useEffect(() => {
    const recheck = () => setChecks((count) => count + 1)
    continuityEvents.on('confirmed', recheck)
    return () => {
      continuityEvents.off('confirmed', recheck)
    }
  }, [])

  const styles = StyleSheet.create({
    section: { gap: 10, marginTop: 16 },
    title: { fontWeight: 'bold' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    separate: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    separateLink: { color: ColorPalette.brand.link },
    sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      padding: 24,
      gap: 12,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
  })

  const run = async (change: () => Promise<void>) => {
    if (!agent) return
    setBusy(true)
    setFailed(false)
    try {
      await change()
      setAsking(undefined)
      setSeparating(false)
      onChanged()
    } catch (error) {
      agent.config.logger.warn(`[VRC:Contacts] merge or separate failed: ${(error as Error)?.message ?? error}`)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (!merged && candidates.length === 0) return null

  return (
    <View style={styles.section} testID={testIdWithKey('ContactMerge')}>
      {candidates.length > 0 ? (
        <>
          <ThemedText style={styles.title}>{t('ContactDetails.MergeOfferTitle')}</ThemedText>
          <ThemedText style={styles.muted}>
            {t(candidates.length > 1 ? 'ContactDetails.MergeAllOfferBody' : 'ContactDetails.MergeOfferBody', {
              ...words,
              count: candidates.length,
            })}
          </ThemedText>
          <Button
            title={t(candidates.length > 1 ? 'ContactDetails.MergeAll' : 'ContactDetails.Merge')}
            buttonType={ButtonType.Secondary}
            onPress={() => setAsking(candidates)}
            disabled={busy}
            testID={testIdWithKey('ContactMergeOffer')}
          />
        </>
      ) : null}
      {merged ? (
        <>
          {confirmedByPhone ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('ContactMergeConfirmedByPhone')}>
              {t('ContactDetails.MergeConfirmedByPhone', words)}
            </ThemedText>
          ) : (
            <>
              <ThemedText style={styles.muted} testID={testIdWithKey('ContactMergedByYou')}>
                {t('ContactDetails.MergedByYou', words)}
              </ThemedText>
              {asked ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('ContactMergeAsked')}>
                  {t('ContactDetails.MergeAsked', words)}
                </ThemedText>
              ) : (
                <Button
                  title={t('ContactDetails.MergeAskPhone', words)}
                  buttonType={ButtonType.Secondary}
                  onPress={() =>
                    void run(async () => {
                      if ((await askToConfirm(agent, links, issuerId)) !== 'sent') {
                        throw new Error('the other phone cannot be asked from here')
                      }
                      setAsked(true)
                    })
                  }
                  disabled={busy || !connectionId}
                  testID={testIdWithKey('ContactMergeAskPhone')}
                />
              )}
            </>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() =>
              // Confirmed by their phone: asked first. On the person's word alone: at once (merging again is as easy).
              confirmedByPhone ? setSeparating(true) : void run(() => separateContact(agent, links, issuerId))
            }
            style={styles.separate}
            testID={testIdWithKey('ContactSeparate')}
          >
            <ThemedText style={confirmedByPhone ? styles.muted : styles.separateLink}>
              {t('ContactDetails.SeparateLink')}
            </ThemedText>
          </Pressable>
        </>
      ) : null}
      {failed ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('ContactMergeFailed')}>
          {t('ContactDetails.MergeFailed')}
        </ThemedText>
      ) : null}
      <SafeAreaModal visible={separating} transparent animationType="slide">
        <View style={styles.sheetBack}>
          {separating ? (
            <View style={styles.sheet} testID={testIdWithKey('ContactSeparateConfirm')}>
              <ThemedText variant="headingThree">{t('ContactDetails.SeparateConfirmTitle', words)}</ThemedText>
              <ThemedText>{t('ContactDetails.SeparateConfirmBody', words)}</ThemedText>
              <Button
                title={t('ContactDetails.Separate')}
                buttonType={ButtonType.Primary}
                onPress={() => void run(() => separateContact(agent, links, issuerId))}
                disabled={busy}
                testID={testIdWithKey('ContactSeparateYes')}
              />
              <Button
                title={t('ContactDetails.MergeBack')}
                buttonType={ButtonType.Secondary}
                onPress={() => setSeparating(false)}
                disabled={busy}
                testID={testIdWithKey('ContactSeparateBack')}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaModal>
      <SafeAreaModal visible={asking !== undefined} transparent animationType="slide">
        <View style={styles.sheetBack}>
          {asking ? (
            <View style={styles.sheet} testID={testIdWithKey('ContactMergeConfirm')}>
              <ThemedText variant="headingThree">
                {t(many ? 'ContactDetails.MergeAllConfirmTitle' : 'ContactDetails.MergeConfirmTitle', countWords)}
              </ThemedText>
              <ThemedText>
                {t(many ? 'ContactDetails.MergeAllConfirmBody' : 'ContactDetails.MergeConfirmBody', countWords)}
              </ThemedText>
              <Button
                title={t(many ? 'ContactDetails.MergeAll' : 'ContactDetails.Merge')}
                buttonType={ButtonType.Primary}
                onPress={() =>
                  void run(() =>
                    mergeAllContacts(agent, records, links, [
                      issuerId,
                      ...asking.map((candidate) => candidate.issuerId),
                    ])
                  )
                }
                disabled={busy}
                testID={testIdWithKey('ContactMergeYes')}
              />
              <Button
                title={t('ContactDetails.MergeBack')}
                buttonType={ButtonType.Secondary}
                onPress={() => setAsking(undefined)}
                disabled={busy}
                testID={testIdWithKey('ContactMergeBack')}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaModal>
    </View>
  )
}

export default ContactMergeSection
