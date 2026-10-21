/**
 * A community whose identity cannot sign in because of its agent, said where
 * the community is and by what the agent did: refused this phone, did not
 * answer, or is no longer linked to it. Read from the persona inbox's state
 * for that community, so it stays while the cause does and goes when the
 * identity signs in again.
 *
 * It used to be an app-wide toast, which landed on whatever screen was open
 * (over a contact's chat and its composer, IN-350) and said "didn't answer"
 * of an agent that had answered by refusing this phone.
 *
 * @module trust-tasks/screens/PersonaAgentNotice
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { usePersonaAgentState } from '../module/vtiPersonaInbox'

import { communityLabelOf } from './communityName'

const WORDS = {
  refused: {
    title: 'VtaLink.PersonaAgentRefusedTitle',
    body: 'VtaLink.PersonaAgentRefusedBody',
    line: 'VtaLink.PersonaAgentRefusedLine',
  },
  unreachable: {
    title: 'VtaLink.PersonaAgentUnreachableTitle',
    body: 'VtaLink.PersonaAgentUnreachableBody',
    line: 'VtaLink.PersonaAgentUnreachableLine',
  },
  notLinked: {
    title: 'VtaLink.PersonaAgentUnreachableTitle',
    body: 'VtaLink.PersonaAgentNotLinkedBody',
    line: 'VtaLink.PersonaAgentNotLinkedLine',
  },
} as const

export interface PersonaAgentNoticeProps {
  communityDid: string
  /** One line, for a community's row in a list; else the card with its way out. */
  compact?: boolean
  /** Where each of the three is put right: My Agent. */
  onOpenAgent?: () => void
}

export const PersonaAgentNotice: React.FC<PersonaAgentNoticeProps> = ({ communityDid, compact, onOpenAgent }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const state = usePersonaAgentState(communityDid)
  if (!state) return null
  const words = WORDS[state.kind] ?? WORDS.unreachable
  const styles = StyleSheet.create({
    card: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 8,
      borderLeftWidth: 4,
      borderLeftColor: ColorPalette.semantic.error,
      padding: 16,
      gap: 8,
    },
    line: { color: ColorPalette.semantic.error },
  })
  if (compact) {
    return (
      <ThemedText style={styles.line} testID={testIdWithKey('PersonaAgentNoticeLine')}>
        {t(words.line)}
      </ThemedText>
    )
  }
  const community = communityLabelOf(communityDid, t)
  return (
    <View style={styles.card} testID={testIdWithKey('PersonaAgentNotice')}>
      <ThemedText variant="bold" accessibilityRole="header">
        {t(words.title)}
      </ThemedText>
      <ThemedText>{t(words.body, { community, interpolation: { escapeValue: false } })}</ThemedText>
      {onOpenAgent ? (
        <Button
          title={t('VtaLink.PersonaAgentOpen')}
          buttonType={ButtonType.Secondary}
          onPress={onOpenAgent}
          testID={testIdWithKey('PersonaAgentNoticeOpen')}
        />
      ) : null}
    </View>
  )
}

export default PersonaAgentNotice
