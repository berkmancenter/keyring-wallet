import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

/** One of the owner's personas, as the connect shows it: by its display name, which is data, not a word (§7.7). */
export type ActingAsPersona = { did: string; name: string }

export interface ActingAsRowProps {
  personas: ActingAsPersona[]
  /** The chosen persona's DID; undefined until the person picks one (nothing is pre-selected). */
  selected?: string
  onSelect: (did: string) => void
  /**
   * Whether the connect asks; by default, with more than one persona. The connect form passes its own flag, which stays
   * on once it has asked, so the row does not disappear when the list shrinks mid-connect.
   */
  ask?: boolean
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#D9D9DE', paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 8, gap: 12 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  label: { flex: 1, fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.text },
  chosen: { fontFamily: 'SourceSans3-Regular', fontSize: 17, color: AGENT_COLORS.muted },
  name: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 17, color: AGENT_COLORS.text },
})

/**
 * "Acting as" (finding 18, §7.7; canvas frame 58): which of the owner's personas the agent acts for. Drawn only while
 * the connect asks (by default, with more than one persona): a row labelled "Acting as" with the chosen persona's
 * display name (none before a choice), and an inline list of radio rows, one per persona, the chosen one checked.
 * Nothing is pre-selected: the connect asks rather than guesses. While nothing is chosen the list is open, so the
 * question is not behind a tap; after a choice it stays however the person leaves it, and it opens again if the
 * choice is lost.
 */
const ActingAsRow: React.FC<ActingAsRowProps> = ({ personas, selected, onSelect, ask = personas.length > 1 }) => {
  const { t } = useTranslation()
  const chosen = personas.find((p) => p.did === selected)
  const [open, setOpen] = useState(chosen === undefined)
  const [shownDid, setShownDid] = useState(chosen?.did)
  if (shownDid !== chosen?.did) {
    setShownDid(chosen?.did)
    if (chosen === undefined) setOpen(true)
  }

  if (!ask) return null

  const label = t('ConnectedAgents.ActingAs')

  return (
    <View style={styles.box}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => setOpen(!open)}
        testID={testIdWithKey('ActingAsRow')}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={chosen ? `${label}, ${chosen.name}` : label}
      >
        <Icon name="account-outline" size={26} color={AGENT_COLORS.primary} />
        <ThemedText style={styles.label}>{label}</ThemedText>
        {chosen ? <ThemedText style={styles.chosen}>{chosen.name}</ThemedText> : null}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={24} color={AGENT_COLORS.muted} />
      </TouchableOpacity>
      {open
        ? personas.map((persona) => {
            const checked = persona.did === chosen?.did
            return (
              <TouchableOpacity
                key={persona.did}
                style={[styles.row, styles.rule]}
                onPress={() => onSelect(persona.did)}
                testID={testIdWithKey('ActingAsOption')}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                accessibilityLabel={persona.name}
              >
                <Icon name={checked ? 'radiobox-marked' : 'radiobox-blank'} size={28} color={AGENT_COLORS.primary} />
                <ThemedText style={styles.name}>{persona.name}</ThemedText>
              </TouchableOpacity>
            )
          })
        : null}
    </View>
  )
}

export default ActingAsRow
