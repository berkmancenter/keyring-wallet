/**
 * The generic render/approve-deny surface R5 asks for: "a UI anywhere...
 * that renders an arbitrary incoming Trust Task's payload and lets a person
 * approve/deny it with a signed response" (2026-09-01-al.md §1). Built once,
 * here, so any registered task type rides it rather than each demo inventing
 * its own approval screen.
 *
 * Deliberately a CARD component, not a navigator screen/route: R5's scope
 * (docs/plans/reference-app-sdk-packaging/2026-09-03-bm.md) explicitly
 * defers "a full picker UI" to later work, and adding a new stack route
 * would mean touching the app's navigator — shared code a demo profile
 * shouldn't need to edit. A profile embeds this card wherever it wants the
 * prompt to surface (the Approver demo profile embeds it in a
 * `COMPONENT_HOME_HEADER` override); nothing about the card itself assumes
 * where it's mounted.
 *
 * Payload rendering is entirely data-driven: `ITrustTaskDisplayRegistry`
 * (mirroring `ICredentialDisplayRegistry`) extracts `Field[]` from the raw
 * document, and this component only knows how to lay out `Field[]` plus two
 * buttons — it has no knowledge of any specific task type's payload shape.
 *
 * @module screens/TrustTaskApprovalCard
 */

import { Attribute, Field } from '@bifold/oca/build/legacy'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'
import Button, { ButtonType } from '../components/buttons/Button'
import { ITrustTaskDisplayRegistry, TrustTaskDisplayResult } from '../types/trust-task-display'

export interface TrustTaskApprovalCardProps {
  typeUri: string
  document: Record<string, unknown>
  /** Fallback summary text, used when no display handler matches `typeUri` and the registry's own fallback fields (empty) would render nothing useful. */
  summary: string
  counterpartyLabel: string
  displayRegistry?: ITrustTaskDisplayRegistry
  onApprove: () => void
  onDeny: () => void
}

/** Render one Field's label/value pair. `Attribute` (the concrete subclass carrying a `.value`) is the only Field kind a Trust Task payload extractor should ever emit — a request payload has no AnonCreds predicate to satisfy. */
function fieldValue(field: Field): string {
  return field instanceof Attribute ? String(field.value ?? '') : ''
}

const TrustTaskApprovalCard: React.FC<TrustTaskApprovalCardProps> = ({
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
    container: {
      padding: 16,
      borderRadius: 8,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    title: {
      ...TextTheme.headingFour,
      color: ColorPalette.brand.text,
    },
    counterparty: {
      ...TextTheme.labelSubtitle,
      color: ColorPalette.brand.text,
      marginTop: 2,
      marginBottom: 8,
    },
    summary: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
      marginBottom: 8,
    },
    fieldRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    fieldLabel: {
      ...TextTheme.labelSubtitle,
      color: ColorPalette.brand.text,
    },
    fieldValue: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
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
    <View style={styles.container} testID={testIdWithKey('TrustTaskApprovalCard')}>
      <Text style={styles.title} testID={testIdWithKey('TrustTaskApprovalTitle')}>
        {display.title}
      </Text>
      <Text style={styles.counterparty}>{counterpartyLabel}</Text>
      {display.fields.length === 0 ? (
        <Text style={styles.summary} testID={testIdWithKey('TrustTaskApprovalSummary')}>
          {summary}
        </Text>
      ) : (
        display.fields.map((field) => (
          <View style={styles.fieldRow} key={field.name}>
            <Text style={styles.fieldLabel}>{field.label ?? field.name}</Text>
            <Text style={styles.fieldValue}>{fieldValue(field)}</Text>
          </View>
        ))
      )}
      <View style={styles.actions}>
        <View style={styles.actionButton}>
          <Button title="Deny" accessibilityLabel="Deny" testID={testIdWithKey('TrustTaskDeny')} buttonType={ButtonType.Secondary} onPress={onDeny} />
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
    </View>
  )
}

export default TrustTaskApprovalCard
