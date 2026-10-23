/**
 * "Same person?", on a contact: when another contact's cards give the same name (exchanging again with someone makes
 * a second contact), offer to merge the two into one. The person decides; the merge says it was theirs ("Merged by
 * you"), never that the other phone confirmed it. A merged contact can be separated again. Neither touches a card, a
 * connection or a message.
 *
 * @module vrc/components/ContactMergeSection
 */
import { useAgent } from '@bifold/react-hooks'
import type { W3cCredentialRecord } from '@credo-ts/core'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { ContactLinks } from '../contacts/contactLinks'
import { findMergeCandidates, mergeContacts, separateContact, type MergeCandidate } from '../contacts/mergeContacts'

export interface ContactMergeSectionProps {
  /** The relationship the contact screen opened. */
  issuerId: string
  name: string
  /** Every relationship of this contact (more than one once merged). */
  relationships: string[]
  records: W3cCredentialRecord[]
  links: ContactLinks
  /** Called after a merge or a separation, so the screen reads the links again. */
  onChanged: () => void
}

export const ContactMergeSection: React.FC<ContactMergeSectionProps> = ({
  issuerId,
  name,
  relationships,
  records,
  links,
  onChanged,
}) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [asking, setAsking] = useState<MergeCandidate>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const merged = relationships.length > 1
  const candidates = useMemo(
    () => (merged ? [] : findMergeCandidates(records, links, issuerId)),
    [merged, records, links, issuerId]
  )
  const words = { name, interpolation: { escapeValue: false } }

  const styles = StyleSheet.create({
    section: { gap: 10, marginTop: 16 },
    title: { fontWeight: 'bold' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
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
      {merged ? (
        <>
          <ThemedText style={styles.muted} testID={testIdWithKey('ContactMergedByYou')}>
            {t('ContactDetails.MergedByYou', words)}
          </ThemedText>
          <Button
            title={t('ContactDetails.Separate')}
            buttonType={ButtonType.Secondary}
            onPress={() => void run(() => separateContact(agent, links, issuerId))}
            disabled={busy}
            testID={testIdWithKey('ContactSeparate')}
          />
        </>
      ) : (
        <>
          <ThemedText style={styles.title}>{t('ContactDetails.MergeOfferTitle')}</ThemedText>
          <ThemedText style={styles.muted}>{t('ContactDetails.MergeOfferBody', words)}</ThemedText>
          <Button
            title={t('ContactDetails.Merge')}
            buttonType={ButtonType.Secondary}
            onPress={() => setAsking(candidates[0])}
            disabled={busy}
            testID={testIdWithKey('ContactMergeOffer')}
          />
        </>
      )}
      {failed ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('ContactMergeFailed')}>
          {t('ContactDetails.MergeFailed')}
        </ThemedText>
      ) : null}
      <SafeAreaModal visible={asking !== undefined} transparent animationType="slide">
        <View style={styles.sheetBack}>
          {asking ? (
            <View style={styles.sheet} testID={testIdWithKey('ContactMergeConfirm')}>
              <ThemedText variant="headingThree">{t('ContactDetails.MergeConfirmTitle', words)}</ThemedText>
              <ThemedText>{t('ContactDetails.MergeConfirmBody', words)}</ThemedText>
              <Button
                title={t('ContactDetails.Merge')}
                buttonType={ButtonType.Primary}
                onPress={() => void run(() => mergeContacts(agent, records, links, issuerId, asking.issuerId))}
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
