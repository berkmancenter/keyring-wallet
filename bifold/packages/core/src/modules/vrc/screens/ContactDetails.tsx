import { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useState, useMemo } from 'react'
import { StyleSheet, View, TouchableOpacity, ScrollView, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAgent, useConnections } from '@bifold/react-hooks'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTranslation } from 'react-i18next'
import Toast from 'react-native-toast-message'

import { ThemedText } from '../../../components/texts/ThemedText'
import { ToastType } from '../../../components/toast/BaseToast'
import { TOKENS, useServices } from '../../../container-api'
import { useTheme } from '../../../contexts/theme'
import { ContactStackParams, Screens } from '../../../types/navigators'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import CommonRemoveModal from '../../../components/modals/CommonRemoveModal'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import Button, { ButtonType } from '../../../components/buttons/Button'
import { ModalUsage } from '../../../types/remove'
import { useDeleteContact } from '../hooks/useDeleteContact'
import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import {
  getVerifiedWitnessCredentialsForSubject,
  extractWitnessInfo,
  WitnessRecord,
} from '../utils/witnessCredentialUtils'
import RelationshipLayers from '../components/RelationshipLayers'
import RelationshipUpgradeSection from '../components/RelationshipUpgradeSection'
import ContactMergeSection from '../components/ContactMergeSection'
import { relationshipLayers } from '../utils/relationshipLayers'
import { resolveContactDisplayInfo } from '../utils/rcardDisplayUtils'
import { useRCardCredential } from '../hooks/useRCardCredential'
import { formInputFromTemplate } from '../types/rcard'
import { testIdWithKey } from '../../../utils/testable'
import { DidDetails } from '../../trust-tasks/screens/DidDetails'
import { ContactLinks, loadContactLinks, relationshipsOfContact } from '../contacts/contactLinks'
import { separateContact } from '../contacts/mergeContacts'
import { connectionToOpen } from '../contacts/messageRows'
import { useConnectionRelationships, useContactFacts } from '../contacts/useContactFacts'
import { useConnectionActivity } from '../../../hooks/useConnectionActivity'
import { useUnreadMessages } from '../../../hooks/useUnreadMessages'
import { localDate } from '../../trust-tasks/screens/localTime'
import { useContactLinks } from '../contacts/useContactLinks'

const AVATAR_BG = '#E8E0E8'
const NAME_COLOR = '#010B13'
const CHIP_BG = '#F0E6F0'
const CHIP_TEXT = '#4A4A4A'
const CHIP_ICON = '#622C62'
const ROW_ICON = '#4A4A4A'
const HAIRLINE = '#E3DEE3'
const AVATAR_SIZE = 88

type ContactDetailsProps = StackScreenProps<ContactStackParams, Screens.ContactDetails>

const ContactDetails: React.FC<ContactDetailsProps> = ({ route, navigation }) => {
  if (!route?.params) {
    throw new Error('ContactDetails route params were not set properly')
  }

  const { contact } = route.params
  const { ColorPalette, TextTheme } = useTheme()
  const { agent } = useAgent()
  const { t } = useTranslation()
  const [ContactDetailsFooter] = useServices([TOKENS.COMPONENT_CONTACT_DETAILS_FOOTER])
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [sharedProfileId, setSharedProfileId] = useState<string | undefined>(undefined)
  const [sharedProfileLabelSnapshot, setSharedProfileLabelSnapshot] = useState<string | undefined>(undefined)
  const [isRemoveModalDisplayed, setIsRemoveModalDisplayed] = useState<boolean>(false)
  const { deleteContact } = useDeleteContact()
  const { profiles } = useRCardCredential()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()
  // Every relationship this contact has on this phone, the one the row opened first. One, unless relationships were
  // merged: cards, witness records and badges cover them all; the DID, messages, upgrade and removal stay on the
  // first (the row's own relationship).
  // Bumped after a merge or a separation on this screen, so the links are read again.
  const [linksVersion, setLinksVersion] = useState(0)
  const contactLinks = useContactLinks(linksVersion)
  const relationships = useMemo(
    () => relationshipsOfContact(contactLinks, contact.issuer.id),
    [contactLinks, contact.issuer.id]
  )

  // Live-resolve contact info from stored credentials (received RCard first,
  // legacy VRC issuer object second) so the screen self-heals if the RCard
  // arrives after navigation. Route params act as the final fallback.
  const displayInfo = useMemo(() => {
    return resolveContactDisplayInfo(w3cCredentialRecords, contact.issuer.id)
  }, [w3cCredentialRecords, contact.issuer.id])
  const displayName = displayInfo.name || contact.issuer.name
  const displayEmail = displayInfo.email || contact.issuer.email
  const displayOrganization = displayInfo.organization || contact.issuer.organization
  const displayPhoto = displayInfo.photo || contact.issuer.photo

  // Live lookup by id so a later profile rename shows up here immediately;
  // only falls back to the share-time label snapshot once the profile no
  // longer exists (findByCounterpartyRelationshipDid useEffect below).
  const liveSharedProfile = useMemo(
    () => profiles.find((profile) => profile.id === sharedProfileId),
    [profiles, sharedProfileId]
  )

  const witnessCredentials = useMemo(() => {
    return relationships.flatMap((issuerId) => getVerifiedWitnessCredentialsForSubject(w3cCredentialRecords, issuerId))
  }, [w3cCredentialRecords, relationships])

  const witnessRecords = useMemo(() => {
    return witnessCredentials.map(extractWitnessInfo).filter((record): record is WitnessRecord => record !== null)
  }, [witnessCredentials])

  // Any confirmed VWC is enough for the glanceable badge — same "any, not
  // all" rule as the Witnessed badge above; the per-record breakdown below
  // still shows every record's own state.
  const hasLocalityConfirmed = useMemo(
    () => witnessRecords.some((record) => record.locality?.outcome === 'confirmed'),
    [witnessRecords]
  )

  // Verified once and shared with the Contacts list (contacts/useContactFacts): not again here, from false, with the
  // badge appearing late. While evidence the contact carries is checked, the badge's place is held.
  const { hwVerified: hardware } = useContactFacts(relationships)
  const hwVerified = hardware.known && hardware.value
  const hwChecking = !hardware.known && contact.hasHardwareAttestation === true

  // The relationship's layers, as the records on this phone show them.
  const layers = useMemo(
    () => relationshipLayers(w3cCredentialRecords, relationships, witnessRecords),
    [w3cCredentialRecords, relationships, witnessRecords]
  )

  // Message opens the chat the Messages row for this contact opens: of its connections holding unread messages the
  // newest, else the newest (messageRows' connectionToOpen), by the same activity, a connection's making included.
  const relationshipOf = useConnectionRelationships()
  const activity = useConnectionActivity()
  const { unreadByConnection } = useUnreadMessages()
  const { records: connectionRecords } = useConnections()
  const messageConnectionId = useMemo(() => {
    const madeAt = new Map(connectionRecords.map((record) => [record.id, record.createdAt]))
    const own = relationshipOf
      ? [...relationshipOf].filter(([, did]) => relationships.includes(did)).map(([id]) => id)
      : []
    if (own.length === 0) return connectionId
    return connectionToOpen(
      own,
      (id) => activity(id, madeAt.get(id)),
      (id) => unreadByConnection[id] ?? 0
    )
  }, [relationshipOf, relationships, activity, unreadByConnection, connectionRecords, connectionId])

  useEffect(() => {
    const lookupConnection = async () => {
      if (!agent) return

      try {
        const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
        const record = await repository.findByCounterpartyRelationshipDid(agent.context, contact.issuer.id)

        if (record?.connectionId) {
          setConnectionId(record.connectionId)
        }
        setSharedProfileId(record?.sharedProfileId)
        setSharedProfileLabelSnapshot(record?.sharedProfileLabel)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          '[VRC:ContactDetails] Connection lookup error:',
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    lookupConnection()
  }, [agent, contact.issuer.id])

  const removeWords = { name: displayName, count: relationships.length, interpolation: { escapeValue: false } }

  const styles = StyleSheet.create({
    sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      padding: 24,
      gap: 12,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    contentContainer: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
    // 1. Who they are
    identity: { alignItems: 'center', paddingTop: 28, gap: 10 },
    avatarCircle: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: AVATAR_BG,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: AVATAR_SIZE, height: AVATAR_SIZE },
    contactName: { ...TextTheme.headingTwo, fontWeight: '700', color: NAME_COLOR, textAlign: 'center' },
    organization: { fontSize: 13, color: ColorPalette.grayscale.mediumGrey, textAlign: 'center' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 12,
      backgroundColor: CHIP_BG,
    },
    chipText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: CHIP_TEXT },
    // The sections: rows on the screen's ground under a small label, as the chat and rooms screens do.
    section: { marginTop: 20 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.48,
      textTransform: 'uppercase',
      color: ColorPalette.grayscale.mediumGrey,
      marginBottom: 4,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 },
    rowText: { flex: 1, gap: 1 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: NAME_COLOR },
    rowCaption: { fontSize: 13, lineHeight: 18, color: ColorPalette.grayscale.mediumGrey },
    linkedProfileAvatar: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: AVATAR_BG,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    linkedProfileAvatarImage: { width: 22, height: 22 },
    witnessRecord: { paddingVertical: 6 },
    witnessLabel: { fontSize: 13, color: ColorPalette.grayscale.mediumGrey },
    witnessValue: { fontSize: 15, color: NAME_COLOR },
    localityVerified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    // 5. What is hard to undo: last, apart.
    danger: { marginTop: 28, paddingTop: 20, borderTopWidth: 1, borderTopColor: HAIRLINE },
    removeButton: {
      minHeight: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: ColorPalette.semantic.error,
      backgroundColor: ColorPalette.grayscale.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeButtonText: { ...TextTheme.bold, fontSize: 16, color: ColorPalette.semantic.error },
  })

  const handleViewMessages = () => {
    if (messageConnectionId) {
      navigation.getParent()?.navigate(Screens.Chat, { connectionId: messageConnectionId })
    }
  }

  const handleRemoveContact = useCallback(() => {
    setIsRemoveModalDisplayed(true)
  }, [])

  const handleConfirmRemove = useCallback(async () => {
    setIsRemoveModalDisplayed(false)

    // What goes is decided by the links as stored now, not as last read: a read that failed earlier would leave part
    // of a merged contact behind. If they can't be read, or name other relationships than the question the person
    // answered was about, nothing is removed and the screen reads them again.
    let links: ContactLinks
    try {
      links = await loadContactLinks(agent)
    } catch {
      Toast.show({ type: ToastType.Error, text1: t('ContactDetails.MergeFailed') })
      return
    }
    const group = relationshipsOfContact(links, contact.issuer.id)
    const asked = new Set(relationships)
    if (group.length !== asked.size || group.some((member) => !asked.has(member))) {
      setLinksVersion((version) => version + 1)
      Toast.show({ type: ToastType.Error, text1: t('ContactDetails.MergeFailed') })
      return
    }

    let success = await deleteContact({
      issuerId: contact.issuer.id,
      connectionId,
    })

    // A merged contact is removed whole: every relationship it holds, each with its own connection, then its links.
    for (const other of group) {
      if (!success || other === contact.issuer.id || !agent) continue
      const record = await agent.dependencyManager
        .resolve(RelationshipDidRepository)
        .findByCounterpartyRelationshipDid(agent.context, other)
        .catch(() => null)
      success = await deleteContact({ issuerId: other, connectionId: record?.connectionId ?? null })
    }
    if (success && group.length > 1 && agent) {
      await separateContact(agent, links, contact.issuer.id).catch(() => undefined)
    }

    if (success) {
      navigation.pop()
    }
  }, [deleteContact, contact.issuer.id, connectionId, navigation, relationships, agent, t])

  const handleCancelRemove = useCallback(() => {
    setIsRemoveModalDisplayed(false)
  }, [])

  // A merged contact rests on the person's word and may join two different people of the same name, so removing it
  // says how many relationships go and offers to separate them instead.
  const merged = relationships.length > 1
  const handleSeparateInstead = useCallback(async () => {
    setIsRemoveModalDisplayed(false)
    if (!agent) return
    await separateContact(agent, contactLinks, contact.issuer.id).catch(() => undefined)
    setLinksVersion((version) => version + 1)
  }, [agent, contactLinks, contact.issuer.id])

  // The newest witness record, for the trust section's one line about witnessing.
  const newestWitness = useMemo(
    () =>
      [...witnessRecords].sort((a, b) => String(b.issuanceDate ?? '').localeCompare(String(a.issuanceDate ?? '')))[0],
    [witnessRecords]
  )

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView style={styles.contentContainer} contentContainerStyle={styles.scrollContent}>
        {/* 1. Who they are: photo, name, and what is verified about them, every badge that holds. */}
        <View style={styles.identity}>
          <View style={styles.avatarCircle}>
            {displayPhoto ? (
              <Image
                testID={testIdWithKey('ContactAvatarImage')}
                style={styles.avatarImage}
                source={{ uri: displayPhoto }}
              />
            ) : (
              <Icon name="account-outline" size={40} color={ROW_ICON} />
            )}
          </View>
          <ThemedText style={styles.contactName} accessibilityRole="header">
            {displayName}
          </ThemedText>
          {displayOrganization ? (
            <ThemedText style={styles.organization} selectable={true}>
              {displayOrganization}
            </ThemedText>
          ) : null}
          {(witnessRecords.length > 0 || hasLocalityConfirmed || hwVerified || hwChecking) && (
            <View style={styles.chips}>
              {witnessRecords.length > 0 && (
                <View style={styles.chip} testID="WitnessedBadge">
                  <Icon name="check-decagram-outline" size={14} color={CHIP_ICON} />
                  <ThemedText style={styles.chipText}>{t('ContactDetails.BadgeVerified')}</ThemedText>
                </View>
              )}
              {hasLocalityConfirmed && (
                <View style={styles.chip} testID="LocalityConfirmedBadge">
                  <Icon name="map-marker-check-outline" size={14} color={CHIP_ICON} />
                  <ThemedText style={styles.chipText}>{t('ContactDetails.BadgeInPerson')}</ThemedText>
                </View>
              )}
              {hwVerified ? (
                <View style={styles.chip} testID="SecureExchangeBadge">
                  <Icon name="shield-check-outline" size={14} color={CHIP_ICON} />
                  <ThemedText style={styles.chipText}>{t('ContactDetails.BadgeSecureHardware')}</ThemedText>
                </View>
              ) : hwChecking ? (
                // The chip's own shape, so nothing shifts when it fills in: its words kept but not shown, as it does
                // not say "Secure hardware" before that is checked.
                <View style={styles.chip} testID="SecureExchangeChecking">
                  <Icon name="shield-outline" size={14} color="#BBBBBB" />
                  <ThemedText
                    style={[styles.chipText, { opacity: 0 }]}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {t('ContactDetails.BadgeSecureHardware')}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {/* Quick actions: Message, Sign again, Add a witness. */}
        <RelationshipUpgradeSection
          connectionId={connectionId}
          name={displayName}
          hardwareSigned={hwVerified}
          onMessage={messageConnectionId ? handleViewMessages : undefined}
        />

        {/* 2. How you know them: cards and witness records, newest first. */}
        <RelationshipLayers name={displayName} layers={layers} />

        {/* 3. Why you can trust this: each row only once the record behind it verifies on this phone. */}
        <View style={styles.section} testID={testIdWithKey('ContactTrust')}>
          <ThemedText style={styles.sectionLabel} accessibilityRole="header">
            {t('ContactDetails.TrustTitle')}
          </ThemedText>
          {newestWitness ? (
            <View style={styles.row} testID={testIdWithKey('ContactTrustWitnessed')}>
              <Icon name="check-decagram-outline" size={22} color={ROW_ICON} />
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle}>{t('ContactDetails.TrustWitnessed')}</ThemedText>
                <ThemedText style={styles.rowCaption}>
                  {[
                    newestWitness.witnessName ?? t('ContactDetails.TrustWitnessUnnamed'),
                    newestWitness.issuanceDate ? localDate(newestWitness.issuanceDate) : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              </View>
            </View>
          ) : null}
          {hasLocalityConfirmed ? (
            <View style={styles.row} testID={testIdWithKey('ContactTrustInPerson')}>
              <Icon name="map-marker-check-outline" size={22} color={ROW_ICON} />
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle}>{t('ContactDetails.TrustInPerson')}</ThemedText>
                <ThemedText style={styles.rowCaption}>{t('ContactDetails.TrustInPersonCaption')}</ThemedText>
              </View>
            </View>
          ) : null}
          {hwVerified ? (
            <View style={styles.row} testID={testIdWithKey('ContactTrustHardware')}>
              <Icon name="shield-check-outline" size={22} color={ROW_ICON} />
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle}>{t('Relationship.HardwareDone')}</ThemedText>
                <ThemedText style={styles.rowCaption}>{t('ContactDetails.TrustHardwareCaption')}</ThemedText>
              </View>
            </View>
          ) : null}
          {/* Nothing verified, and known so: said, not left blank (never while hardware is still being checked). */}
          {!newestWitness && !hwVerified && hardware.known ? (
            <View style={styles.row} testID={testIdWithKey('ContactTrustNone')}>
              <Icon name="information-outline" size={22} color={ROW_ICON} />
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle}>{t('ContactDetails.TrustNone')}</ThemedText>
                <ThemedText style={styles.rowCaption}>{t('ContactDetails.TrustNoneCaption')}</ThemedText>
              </View>
            </View>
          ) : null}
          <View style={styles.row}>
            <Icon name="key-outline" size={22} color={ROW_ICON} />
            <View style={styles.rowText}>
              <ThemedText style={styles.rowTitle}>{t('ContactDetails.TrustIdentifier')}</ThemedText>
              {/* The identifier, for whoever needs to compare it: not shown by default (#12). */}
              <DidDetails did={contact.issuer.id} testIdStem="ContactRelationship" />
            </View>
          </View>
          {/* Each witness record's own detail. WitnessSection is what the e2e looks for: a witness record shows. */}
          {witnessRecords.length > 0 ? (
            <View testID="WitnessSection">
              {witnessRecords.map((record, index) => (
                <View key={index} style={styles.witnessRecord} testID="WitnessRecord">
                  {record.event ? (
                    <>
                      <ThemedText style={styles.witnessValue}>{record.event}</ThemedText>
                      <ThemedText style={styles.witnessLabel}>Event</ThemedText>
                    </>
                  ) : null}
                  {record.locality && record.locality.outcome !== 'not-offered' ? (
                    <View style={styles.localityVerified}>
                      <Icon
                        name={record.locality.outcome === 'confirmed' ? 'check-circle' : 'information'}
                        size={16}
                        color={
                          record.locality.outcome === 'confirmed'
                            ? ColorPalette.semantic.success
                            : ColorPalette.grayscale.mediumGrey
                        }
                      />
                      <ThemedText style={styles.witnessValue}>
                        {record.locality.outcome === 'confirmed'
                          ? 'Confirmed'
                          : record.locality.reason === 'windowLost'
                            ? 'Interrupted'
                            : 'Declined'}
                        {record.locality.venue ? ` — ${record.locality.venue}` : ''}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* 4. Contact: whether it is one person's merged exchanges (with Separate beside it), what you share with
            them, and what their card says. */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionLabel} accessibilityRole="header">
            {t('ContactDetails.ContactTitle')}
          </ThemedText>
          {/* Same person? Another contact with the same name can be merged into this one, and separated again. */}
          <ContactMergeSection
            issuerId={contact.issuer.id}
            name={displayName}
            relationships={relationships}
            records={w3cCredentialRecords}
            links={contactLinks}
            connectionId={connectionId}
            onChanged={() => setLinksVersion((version) => version + 1)}
          />
          {sharedProfileId && (
            <View style={styles.row} testID="LinkedProfileCard">
              <View style={styles.linkedProfileAvatar}>
                {liveSharedProfile && formInputFromTemplate(liveSharedProfile).photo ? (
                  <Image
                    testID={testIdWithKey('LinkedProfileAvatarImage')}
                    style={styles.linkedProfileAvatarImage}
                    source={{ uri: formInputFromTemplate(liveSharedProfile).photo }}
                  />
                ) : (
                  <Icon name="account-outline" size={16} color={ROW_ICON} />
                )}
              </View>
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle} selectable={true}>
                  {liveSharedProfile
                    ? liveSharedProfile.label
                    : t('ContactDetails.LinkedProfileDeleted', { label: sharedProfileLabelSnapshot ?? '' })}
                </ThemedText>
                <ThemedText style={styles.rowCaption}>{t('ContactDetails.LinkedProfile')}</ThemedText>
              </View>
            </View>
          )}
          {displayEmail ? (
            <View style={styles.row}>
              <Icon name="email-outline" size={22} color={ROW_ICON} />
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle} selectable={true}>
                  {displayEmail}
                </ThemedText>
                <ThemedText style={styles.rowCaption}>{t('ContactDetails.Email')}</ThemedText>
              </View>
            </View>
          ) : null}
          <ContactDetailsFooter contact={contact} connectionId={connectionId} />
        </View>

        {/* 5. Hard to undo: last, and apart. */}
        <View style={styles.danger}>
          <TouchableOpacity
            onPress={handleRemoveContact}
            accessibilityLabel={t('ContactDetails.RemoveContact')}
            accessibilityRole="button"
            testID={testIdWithKey('ContactRemove')}
            style={styles.removeButton}
          >
            <ThemedText style={styles.removeButtonText}>{t('ContactDetails.RemoveContact')}</ThemedText>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <CommonRemoveModal
        usage={ModalUsage.ContactRemove}
        visible={isRemoveModalDisplayed && !merged}
        onSubmit={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />

      <SafeAreaModal visible={isRemoveModalDisplayed && merged} transparent animationType="slide">
        <View style={styles.sheetBack}>
          {isRemoveModalDisplayed && merged ? (
            <View style={styles.sheet} testID={testIdWithKey('ContactRemoveMerged')}>
              <ThemedText variant="headingThree">{t('ContactDetails.MergedRemoveTitle', removeWords)}</ThemedText>
              <ThemedText testID={testIdWithKey('ContactRemoveMergedBody')}>
                {t('ContactDetails.MergedRemoveBody', removeWords)}
              </ThemedText>
              <Button
                title={t('ContactDetails.MergedRemoveSeparate')}
                buttonType={ButtonType.Primary}
                onPress={() => void handleSeparateInstead()}
                testID={testIdWithKey('ContactRemoveMergedSeparate')}
              />
              <Button
                title={t('ContactDetails.MergedRemoveConfirm', removeWords)}
                buttonType={ButtonType.Secondary}
                onPress={() => void handleConfirmRemove()}
                testID={testIdWithKey('ContactRemoveMergedConfirm')}
              />
              <Button
                title={t('ContactDetails.MergeBack')}
                buttonType={ButtonType.Tertiary}
                onPress={handleCancelRemove}
                testID={testIdWithKey('ContactRemoveMergedBack')}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaModal>
    </SafeAreaView>
  )
}

export default ContactDetails
