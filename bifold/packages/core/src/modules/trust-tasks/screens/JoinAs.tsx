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

import React, { useCallback, useEffect, useRef, useState } from 'react'
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

/** The person's profiles as join options, the active one first. */
export function useJoinAsOptions(): { options: JoinAsOption[]; defaultId?: string } {
  const [store] = useStore()
  const profiles = store.rCard?.profiles ?? []
  const options = profiles
    .map((p) => {
      const form = formInputFromTemplate(p)
      const legalName = [form.firstName, form.lastName].filter(Boolean).join(' ').trim()
      return { id: p.id, seed: { legalName, profileLabel: form.label || undefined }, photo: form.photo }
    })
    .filter((o) => o.seed.legalName)
  const active = store.rCard?.activeProfileId
  const defaultId = options.find((o) => o.id === active)?.id ?? options[0]?.id
  return {
    options: [...options].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0)),
    defaultId,
  }
}

/**
 * The choice on a Join as step: the options, which is chosen, and creating a
 * new profile. Creating pushes the real profile editor; whatever profile
 * appears when the person comes back is chosen for them.
 */
export function useJoinAsChoice(navigation: unknown) {
  const { options, defaultId } = useJoinAsOptions()
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultId)
  const known = useRef<Set<string> | undefined>(undefined)

  useEffect(() => {
    if (known.current) {
      const created = options.find((o) => !known.current!.has(o.id))
      if (created) {
        known.current = undefined
        setSelectedId(created.id)
        return
      }
    }
    if (!selectedId && defaultId) setSelectedId(defaultId)
  }, [options, defaultId, selectedId])

  const createProfile = useCallback(() => {
    known.current = new Set(options.map((o) => o.id))
    const stack = navigation as { navigate: (name: string, params?: object) => void }
    stack.navigate(Screens.EditRCard)
  }, [navigation, options])

  return { options, selectedId, setSelectedId, createProfile, selected: options.find((o) => o.id === selectedId) }
}

export const JoinAs: React.FC<{
  community: string
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
        {t('Join.AsBody', { community, interpolation: { escapeValue: false } })}
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
              accessibilityLabel={o.seed.profileLabel ? `${o.seed.legalName}, ${o.seed.profileLabel}` : o.seed.legalName}
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
