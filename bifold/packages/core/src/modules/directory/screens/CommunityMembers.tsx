/**
 * A community's members, as the community shows them to this member (parity plan §9.3 #3, at VTC 0.12): each one's
 * initials, name and role, a page at a time as the list scrolls. Members who show no name are folded into one line
 * at the end, as the member portal does. A name is what that member wrote about themselves, and the screen says so
 * once, above the list.
 *
 * The list lives only in this screen's state (`useCommunityMembers`): nothing here keeps a copy of who is in a
 * community. Reached from a member's community screen.
 *
 * @module directory/screens/CommunityMembers
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { initialsOf } from '../../../utils/initials'
import { testIdWithKey } from '../../../utils/testable'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import { directoryRetryable, directoryStatusText, memberRoleText } from '../components/directoryWords'
import type { MemberRow } from '../types'
import { useCommunityMembers, useDirectoryService } from '../useDirectory'

const CommunityMembers: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const communityDid = (useRoute()?.params as { communityDid?: string } | undefined)?.communityDid ?? ''
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const community = communityLabelOf(communityDid, t)
  const service = useDirectoryService()
  const members = useCommunityMembers(service, communityDid)
  const named = members.rows.filter((row) => row.name)
  const unnamed = members.rows.length - named.length
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 16 },
    // Flat rows, as the Messages list draws them: a hairline under the words, starting after the initials.
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
    disc: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    initials: { color: ColorPalette.grayscale.white, fontSize: 16 },
    words: {
      flex: 1,
      gap: 2,
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    lead: { color: ColorPalette.grayscale.mediumGrey, fontSize: 15, marginBottom: 8 },
    footer: { paddingVertical: 12, gap: 8 },
  })

  const loadMore = () => {
    if (members.more && !members.loading && !members.moreFailed) members.loadMore()
  }

  const row = ({ item }: { item: MemberRow }) => {
    const role = memberRoleText(t, item.role)
    const name = String(item.name)
    return (
      <Pressable
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={[name, role].filter(Boolean).join(', ')}
        onPress={() => go.navigate(Screens.CommunityMemberCard, { communityDid, entryId: item.entryId })}
        testID={testIdWithKey(`DirectoryMember_${item.entryId}`)}
      >
        <View style={styles.disc}>
          <ThemedText variant="bold" style={styles.initials} maxFontSizeMultiplier={1.5}>
            {initialsOf(name)}
          </ThemedText>
        </View>
        <View style={styles.words}>
          <ThemedText maxFontSizeMultiplier={1.5}>{name}</ThemedText>
          {role ? (
            <ThemedText variant="caption" style={styles.muted} maxFontSizeMultiplier={1.5}>
              {role}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
    )
  }

  const footer = (
    <View style={styles.footer}>
      {/* Counted over the pages read; while more remain, the line says it is a count so far. */}
      {unnamed > 0 ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('DirectoryMembersUnnamed')}>
          {t(members.more ? 'Directory.MembersNoNameSoFar' : 'Directory.MembersNoName', { count: unnamed })}
        </ThemedText>
      ) : null}
      {members.moreFailed ? (
        <View style={{ gap: 8 }}>
          <ThemedText testID={testIdWithKey('DirectoryMembersMoreFailed')}>
            {t('Directory.MembersMoreFailed')}
          </ThemedText>
          <Button
            title={t('Directory.TryAgain')}
            buttonType={ButtonType.Secondary}
            onPress={members.loadMore}
            testID={testIdWithKey('DirectoryMembersMoreAgain')}
          />
        </View>
      ) : members.loading && members.rows.length > 0 ? (
        <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey('DirectoryMembersLoadingMore')} />
      ) : null}
    </View>
  )

  const empty = () => {
    if (members.status)
      return (
        <View style={{ gap: 8 }}>
          <ThemedText testID={testIdWithKey('DirectoryMembersStatus')}>
            {directoryStatusText(t, members.status, community)}
          </ThemedText>
          {directoryRetryable(members.status) ? (
            <Button
              title={t('Directory.TryAgain')}
              buttonType={ButtonType.Secondary}
              onPress={members.reload}
              testID={testIdWithKey('DirectoryMembersReload')}
            />
          ) : null}
        </View>
      )
    if (members.loading || !service)
      return <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey('DirectoryMembersLoading')} />
    // Every member read so far shows no name: the folded line below says how many, and nothing more is said here.
    if (unnamed > 0) return null
    return <ThemedText testID={testIdWithKey('DirectoryMembersNone')}>{t('Directory.MembersNone')}</ThemedText>
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <FlatList
        data={named}
        keyExtractor={(item) => item.entryId}
        renderItem={row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          named.length > 0 ? (
            <ThemedText style={styles.lead} testID={testIdWithKey('DirectoryMembersOwnWords')}>
              {t('Directory.MembersOwnWords', { community, interpolation: { escapeValue: false } })}
            </ThemedText>
          ) : null
        }
        ListEmptyComponent={empty}
        ListFooterComponent={members.status ? null : footer}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        testID={testIdWithKey('DirectoryMembers')}
      />
    </SafeAreaView>
  )
}

export default CommunityMembers
