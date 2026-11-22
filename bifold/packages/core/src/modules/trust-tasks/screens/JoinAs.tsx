/**
 * "Who are you joining as?" — pick the profile a community's new identity
 * starts from, or create one right there (the profile editor, returning here
 * with it chosen). Every community gets its own identity; the chosen profile
 * only fills in its name, once (seed by copy — decided 2026-09-23, replacing a
 * live profile↔identity link). The active profile is chosen by default, so
 * most people just continue.
 *
 * Shared by both doors: I was invited (before the identity is sent to the
 * admin) and I want to join (before meeting a vetter).
 *
 * @module trust-tasks/screens/JoinAs
 */

import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useStore } from '../../../contexts/store'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { formInputFromTemplate } from '../../vrc/types/rcard'
import type { JoinSeed } from '../module/vtiJoinSeed'

export interface JoinAsOption {
  id: string
  seed: JoinSeed
  photo?: string
}

/**
 * The name to offer on vetting's legal-name step when nothing seeded it (opened
 * from a vetter's ticket, with no "Join as"): the active profile's, else none.
 * Offered, never filled in: a profile's name is how the person shows up, not
 * necessarily their legal name.
 */
export function offeredProfileName(
  seed: JoinSeed | undefined,
  options: JoinAsOption[],
  defaultId: string | undefined
): JoinSeed | undefined {
  if (seed?.legalName) return undefined
  return options.find((o) => o.id === defaultId)?.seed
}

/** The person's profiles as join options, the active one first. */
export function useJoinAsOptions(): { options: JoinAsOption[]; defaultId?: string } {
  const [store] = useStore()
  const profiles = store.rCard?.profiles
  const active = store.rCard?.activeProfileId
  // Built again only when the profiles or the active one change: a new list on every render re-ran
  // whatever depended on it.
  return useMemo(() => {
    const options = (profiles ?? [])
      .map((p) => {
        const form = formInputFromTemplate(p)
        const legalName = [form.firstName, form.lastName].filter(Boolean).join(' ').trim()
        return { id: p.id, seed: { legalName, profileLabel: form.label || undefined }, photo: form.photo }
      })
      .filter((o) => o.seed.legalName)
    const defaultId = options.find((o) => o.id === active)?.id ?? options[0]?.id
    return {
      options: [...options].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0)),
      defaultId,
    }
  }, [profiles, active])
}

/**
 * The choice on a Join as step: the options, which is chosen, and creating a
 * new profile. Creating pushes the real profile editor; whatever profile
 * appears when the person comes back is chosen for them.
 */
export function useJoinAsChoice(navigation: unknown) {
  const { options, defaultId } = useJoinAsOptions()
  // What the person did: the profile they picked, and the profiles there were when they went to create one.
  const [pick, setPick] = useState<{ id?: string; before?: Set<string> }>({})

  // Derived in render, never copied by an effect: a profile created since "new profile" was tapped, else the
  // one picked while it still exists (a deleted one left nothing chosen), else the default.
  const created = pick.before ? options.find((o) => !pick.before!.has(o.id)) : undefined
  const selectedId =
    created?.id ?? (pick.id && options.some((o) => o.id === pick.id) ? pick.id : undefined) ?? defaultId

  const setSelectedId = useCallback((id: string | undefined) => setPick({ id }), [])

  const createProfile = useCallback(() => {
    setPick((current) => ({ ...current, before: new Set(options.map((o) => o.id)) }))
    const stack = navigation as { navigate: (name: string, params?: object) => void }
    stack.navigate(Screens.EditRCard)
  }, [navigation, options])

  return { options, selectedId, setSelectedId, createProfile, selected: options.find((o) => o.id === selectedId) }
}

export const JoinAs: React.FC<{
  /** The community's own published name, or undefined when nothing has named it. */
  community?: string
  options: JoinAsOption[]
  selectedId?: string
  onSelect: (id: string) => void
  onCreate: () => void
}> = ({ community, options, selectedId, onSelect, onCreate }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = StyleSheet.create({
    option: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 8,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    chosen: { borderColor: ColorPalette.brand.primary },
    avatar: { width: 36, height: 36, borderRadius: 18 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  return (
    <View style={{ gap: 12 }} testID={testIdWithKey('JoinAs')}>
      <ThemedText>
        {/* A community that has published no name is not named by its host
            here either: the sentence simply stops naming it (report #16). */}
        {community ? t('Join.AsBody', { community, interpolation: { escapeValue: false } }) : t('Join.AsBodyUnnamed')}
      </ThemedText>
      {options.length === 0 ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('JoinAsNoProfile')}>
          {t('Join.AsNoProfile')}
        </ThemedText>
      ) : (
        options.map((o) => {
          const chosen = o.id === selectedId
          return (
            <Pressable
              key={o.id}
              style={[styles.option, chosen ? styles.chosen : undefined]}
              onPress={() => onSelect(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen }}
              accessibilityLabel={
                o.seed.profileLabel ? `${o.seed.legalName}, ${o.seed.profileLabel}` : o.seed.legalName
              }
              testID={testIdWithKey('JoinAsOption')}
            >
              {o.photo ? (
                <Image source={{ uri: o.photo }} style={styles.avatar} />
              ) : (
                <Icon name="account-circle" size={36} color={TextTheme.normal.color} />
              )}
              <View style={{ flex: 1 }}>
                <ThemedText variant="bold">{o.seed.legalName}</ThemedText>
                {o.seed.profileLabel ? (
                  <ThemedText style={styles.muted}>
                    {t('Join.ProfileLabel', { label: o.seed.profileLabel, interpolation: { escapeValue: false } })}
                  </ThemedText>
                ) : null}
              </View>
              <Icon
                name={chosen ? 'radiobox-marked' : 'radiobox-blank'}
                size={22}
                color={chosen ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              />
            </Pressable>
          )
        })
      )}
      <Pressable
        style={styles.option}
        onPress={onCreate}
        accessibilityRole="button"
        accessibilityHint={t('Join.CreateProfileHint')}
        testID={testIdWithKey('JoinAsCreateProfile')}
      >
        <Icon name="account-plus-outline" size={36} color={ColorPalette.brand.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{t('Join.CreateProfile')}</ThemedText>
          <ThemedText style={styles.muted}>{t('Join.CreateProfileHint')}</ThemedText>
        </View>
        <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
    </View>
  )
}
