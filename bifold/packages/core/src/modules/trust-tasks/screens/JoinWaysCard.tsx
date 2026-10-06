/**
 * JoinWaysCard — a 0.3 community's ways in, worded (see joinWays.ts for what
 * is shown and why). One block per way, in the community's order: what it
 * needs, what follows meeting it, and what the person can do about it now:
 * use it as the phone stands, or go and get vetted for it.
 *
 * @module trust-tasks/screens/JoinWaysCard
 */
import React, { useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, TextStyle, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import { claimWords } from './claimWords'
import type { JoinCannotUse, JoinCard, JoinNeed, JoinWayRow } from './joinWays'

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

const CANNOT_USE_KEY: Record<JoinCannotUse, string> = {
  incomplete: 'Join.Ways.CannotUseIncomplete',
  unreadable: 'Join.Ways.CannotUseUnreadable',
  changed: 'Join.Ways.CannotUseChanged',
}

/**
 * Why a way cannot be used, in the person's words, with the reader's own
 * fault under Details: worth something to the community's administrator,
 * never the sentence a person reads.
 */
const CannotUse: React.FC<{ row: JoinWayRow; community: string; muted: TextStyle }> = ({ row, community, muted }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const named = { community, interpolation: { escapeValue: false } }
  return (
    <>
      <ThemedText style={muted} testID={testIdWithKey(`JoinWayCannotUse_${row.id}`)}>
        {row.cannotUseBecause ? t(CANNOT_USE_KEY[row.cannotUseBecause], named) : t('Join.Ways.CannotUse')}
      </ThemedText>
      {row.cannotUseDetail ? (
        <Pressable
          onPress={() => setOpen((was) => !was)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          testID={testIdWithKey(`JoinWayDetailsToggle_${row.id}`)}
        >
          <ThemedText style={muted}>{t('Errors.ShowDetails')}</ThemedText>
        </Pressable>
      ) : null}
      {open && row.cannotUseDetail ? (
        <ThemedText style={muted} selectable testID={testIdWithKey(`JoinWayDetail_${row.id}`)}>
          {row.cannotUseDetail}
        </ThemedText>
      ) : null}
    </>
  )
}

export const JoinWaysCard: React.FC<{
  card: WaysCard
  community: string
  /**
   * A button for a way, shown under its lines. Used when the card offers two
   * things to do: each sits under the way it acts on, right below what follows
   * that way, rather than both under the whole list.
   */
  rowAction?: (row: JoinWayRow) => React.ReactNode
  /**
   * The ways shown for reading only, under where the person already stands (a
   * member, a request open, a removal): nothing says "use this now".
   */
  readOnly?: boolean
}> = ({ card, community, rowAction, readOnly = false }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
    way: { gap: 4 },
    action: { marginTop: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const named = { community, interpolation: { escapeValue: false } }
  // Only the ways this person can use are listed (Alberto, 238): a way
  // Keyring cannot read, or one asking for a credential it cannot present
  // yet, is one quiet line, the ways themselves under it for whoever wants
  // them. "There is more than one way in" and "You can use this one now"
  // said again what the list and its buttons show.
  const [othersOpen, setOthersOpen] = useState(false)
  const notYet = (row: JoinWayRow) => row.cannotUse || row.credentialNotYet
  const usable = card.rows.filter((row) => !notYet(row))
  const others = card.rows.filter(notYet)
  const wayView = (row: JoinWayRow, withAction: boolean) => (
    <View key={row.id} style={styles.way} testID={testIdWithKey(`JoinWay_${row.id}`)}>
      {row.needs
        .flatMap((need) => needLines(need, community, t))
        .map((line) => (
          <ThemedText key={line} variant={row.suggested || row.canStartVetting ? 'bold' : undefined}>
            {'• '}
            {line}
          </ThemedText>
        ))}
      {row.follows ? (
        <ThemedText style={styles.muted} testID={testIdWithKey(`JoinWayFollows_${row.id}`)}>
          {t(row.follows === 'automatic' ? 'Join.Ways.FollowsAutomatic' : 'Join.Ways.FollowsReview')}
        </ThemedText>
      ) : null}
      {row.cannotUse ? <CannotUse row={row} community={community} muted={styles.muted} /> : null}
      {row.credentialNotYet ? <ThemedText style={styles.muted}>{t('Join.Ways.CredentialNotYet')}</ThemedText> : null}
      {row.canStartVetting && !readOnly ? (
        <ThemedText testID={testIdWithKey(`JoinWayStart_${row.id}`)}>{t('Join.Ways.VettingToDo')}</ThemedText>
      ) : null}
      {withAction && rowAction?.(row) ? <View style={styles.action}>{rowAction(row)}</View> : null}
    </View>
  )
  return (
    <View style={styles.card} testID={testIdWithKey('JoinWays')}>
      {usable.map((row) => wayView(row, true))}
      {card.noneUsable ? (
        <ThemedText testID={testIdWithKey('JoinWaysNoneUsable')}>{t('Join.Ways.NoneUsable', named)}</ThemedText>
      ) : null}
      {card.missing.length ? (
        <View style={styles.way} testID={testIdWithKey('JoinWaysMissing')}>
          <ThemedText>{t('Join.Ways.MissingInvitation', named)}</ThemedText>
        </View>
      ) : null}
      {others.length && !card.noneUsable ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('JoinWaysOthers')}>
          {t('Join.Ways.OthersNotYet')}
        </ThemedText>
      ) : null}
      {others.length ? (
        <Pressable
          onPress={() => setOthersOpen((was) => !was)}
          accessibilityRole="button"
          accessibilityState={{ expanded: othersOpen }}
          testID={testIdWithKey('JoinWaysOthersToggle')}
        >
          <ThemedText style={styles.muted}>{t('Join.Ways.OthersShow')}</ThemedText>
        </Pressable>
      ) : null}
      {othersOpen ? others.map((row) => wayView(row, false)) : null}
    </View>
  )
}
