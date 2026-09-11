/**
 * A bottom-sheet presentation of the same payload `TrustTaskApprovalCard`
 * renders (via the shared `TrustTaskFields`) — for a caller that wants more
 * room than an inline card embedded in a footer/list allows. Same visual
 * chrome as `RelationshipProposalModal` (this repo's other Trust-Task
 * consent surface, in `modules/vrc/components/`): a slide-up sheet over a
 * dim overlay, SafeAreaView-bottomed, scrollable so a long free-text field
 * value never gets clipped regardless of device height.
 *
 * Same "not a navigator route" stance as `TrustTaskApprovalCard` itself
 * (see that file's own comment on why): a profile mounts this wherever and
 * whenever it wants the fuller presentation instead of the compact card —
 * nothing here assumes navigation context, it's just a component that
 * happens to render via React Native's `Modal`.
 *
 * Shares `TrustTaskApprove`/`TrustTaskDeny`/`TrustTaskApprovalTitle` and the
 * container's own `TrustTaskApprovalCard` testID with the card component —
 * from an e2e perspective "is there an approval surface on screen, and can
 * it be answered" is the same question regardless of which presentation is
 * mounted.
 *
 * @module screens/TrustTaskApprovalModal
 */

import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../components/buttons/Button'
import SafeAreaModal from '../components/modals/SafeAreaModal'
import { ThemedText } from '../components/texts/ThemedText'
import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'
import { ITrustTaskDisplayRegistry, TrustTaskDisplayResult } from '../types/trust-task-display'

import { TrustTaskFields } from './TrustTaskApprovalCard'

export interface TrustTaskApprovalModalProps {
  typeUri: string
  document: Record<string, unknown>
  /** Fallback summary text, used when no display handler matches `typeUri`. */
  summary: string
  counterpartyLabel: string
  displayRegistry?: ITrustTaskDisplayRegistry
  onApprove: () => void
  onDeny: () => void
}

const TrustTaskApprovalModal: React.FC<TrustTaskApprovalModalProps> = ({
  typeUri,
  document,
  summary,
  counterpartyLabel,
  displayRegistry,
  onApprove,
  onDeny,
}) => {
  const { ColorPalette, TextTheme } = useTheme()

  const display: TrustTaskDisplayResult = displayRegistry?.getDisplayInfo(typeUri, document) ?? {
    title: 'Approval request',
    fields: [],
    approveLabel: 'Global.Accept',
    denyLabel: 'Global.Decline',
  }

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    safeAreaView: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
      maxHeight: '85%',
    },
    scrollContent: {
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 24,
    },
    title: {
      marginBottom: 4,
    },
    counterparty: {
      ...TextTheme.labelSubtitle,
      color: ColorPalette.brand.text,
      marginBottom: 20,
    },
    actions: {
      flexDirection: 'row',
      marginTop: 12,
      gap: 12,
    },
    actionButton: {
      flex: 1,
    },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']} testID={testIdWithKey('TrustTaskApprovalCard')}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <ThemedText variant="headingThree" style={styles.title} testID={testIdWithKey('TrustTaskApprovalTitle')}>
              {display.title}
            </ThemedText>
            <ThemedText style={styles.counterparty}>{counterpartyLabel}</ThemedText>
            <TrustTaskFields fields={display.fields} summary={summary} />
            <View style={styles.actions}>
              <View style={styles.actionButton}>
                <Button
                  title="Deny"
                  accessibilityLabel="Deny"
                  testID={testIdWithKey('TrustTaskDeny')}
                  buttonType={ButtonType.Secondary}
                  onPress={onDeny}
                />
              </View>
              <View style={styles.actionButton}>
                <Button
                  title="Approve"
                  accessibilityLabel="Approve"
                  testID={testIdWithKey('TrustTaskApprove')}
                  buttonType={ButtonType.Primary}
                  onPress={onApprove}
                />
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default TrustTaskApprovalModal
