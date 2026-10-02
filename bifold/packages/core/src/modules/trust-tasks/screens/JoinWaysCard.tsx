/**
 * JoinWaysCard — a 0.3 community's ways in, worded (see joinWays.ts for what
 * is shown and why). One block per way, in the community's order: what it
 * needs, what follows meeting it, and which one this phone can use now.
 *
 * @module trust-tasks/screens/JoinWaysCard
 */
import React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import { claimWords } from './claimWords'
import type { JoinCard, JoinNeed } from './joinWays'

type WaysCard = Extract<JoinCard, { mode: 'ways' }>

/** A credential type in words: the ones the app knows, else its own name. */
const typeWords = (types: string[], t: TFunction) =>
  types.map((type) => (type === 'MembershipCredential' ? (t('Join.Ways.TypeMembership') as string) : type)).join(', ')

/** One need as its lines: vetting says the statements, then each claim checked. */
function needLines(need: JoinNeed, community: string, t: TFunction): string[] {
  const named = { community, interpolation: { escapeValue: false } }
  switch (need.kind) {
    case 'invitation':
      return [t('Join.Ways.NeedsInvitation', named) as string]
    case 'credential': {
      const key =
        need.issuers === 'community'
          ? 'Join.Ways.NeedsCredentialCommunity'
          : need.issuers === 'recognised'
            ? 'Join.Ways.NeedsCredentialRecognised'
            : need.issuers === 'any'
              ? 'Join.Ways.NeedsCredentialAny'
              : // Whose credentials count could not be read: the way is marked unusable.
                'Join.Ways.NeedsCredential'
      return [t(key, { ...named, type: typeWords(need.types, t) }) as string]
    }
    case 'vetting':
      return [
        t('Join.AsksStatements', { count: need.statements }) as string,
        ...need.claims.map((c) => (c === 'name.legal' ? (t('Join.AsksLegalName') as string) : claimWords(c, t))),
      ]
    default:
      return [t('Join.Ways.NeedsNothing') as string]
  }
}

export const JoinWaysCard: React.FC<{ card: WaysCard; community: string }> = ({ card, community }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
    way: { gap: 4 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const named = { community, interpolation: { escapeValue: false } }
  return (
    <View style={styles.card} testID={testIdWithKey('JoinWays')}>
      {card.several ? (
        <ThemedText testID={testIdWithKey('JoinWaysSeveral')}>{t('Join.Ways.Several')}</ThemedText>
      ) : null}
      {card.rows.map((row) => (
        <View key={row.id} style={styles.way} testID={testIdWithKey(`JoinWay_${row.id}`)}>
          {row.needs
            .flatMap((need) => needLines(need, community, t))
            .map((line) => (
              <ThemedText key={line} variant={row.suggested ? 'bold' : undefined}>
                {'• '}
                {line}
              </ThemedText>
            ))}
          {row.follows ? (
            <ThemedText style={styles.muted} testID={testIdWithKey(`JoinWayFollows_${row.id}`)}>
              {t(row.follows === 'automatic' ? 'Join.Ways.FollowsAutomatic' : 'Join.Ways.FollowsReview')}
            </ThemedText>
          ) : null}
          {row.cannotUse ? <ThemedText style={styles.muted}>{t('Join.Ways.CannotUse')}</ThemedText> : null}
          {row.credentialNotYet ? (
            <ThemedText style={styles.muted}>{t('Join.Ways.CredentialNotYet')}</ThemedText>
          ) : null}
          {row.suggested ? (
            <ThemedText testID={testIdWithKey('JoinWaySuggested')}>{t('Join.Ways.Suggested')}</ThemedText>
          ) : null}
        </View>
      ))}
      {card.missing.length ? (
        <View style={styles.way} testID={testIdWithKey('JoinWaysMissing')}>
          <ThemedText>{t('Join.Ways.MissingInvitation', named)}</ThemedText>
        </View>
      ) : null}
    </View>
  )
}
