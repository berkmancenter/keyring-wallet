/**
 * The state card in Credentials (SEDI/KERI holder card): the Guardian card this phone holds, drawn as the wallet's
 * community pass (CommunityPass, unchanged) with the state's name, "Guardian of your contact", its dates, and a pill:
 * cream "Demo" for a card that checks out from a demo root, cream "Not checked" while it can't be checked here, red
 * for a refusal. Pressed, its details open over the Wallet (./StateCardDetails).
 *
 * Gated at render: with "State card (demo)" off it draws nothing, and the details close.
 *
 * @module sedi/holder/StateCardPass
 */
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { testIdWithKey } from '../../../utils/testable'
import CommunityPass from '../../trust-tasks/components/CommunityPass'
import type { CommunityBrand } from '../../trust-tasks/module/communityBrand'
import type { Known } from '../../trust-tasks/module/useCommunityBrand'
import type { PassFace } from '../../trust-tasks/screens/communityPass'

import StateCardDetails from './StateCardDetails'
import type { StateCardView } from './stateCard'
import { isStateCardEnabled } from './stateCardFlag'

/** A state's pass colour: a dark slate white text reads on, the same for every state until states publish a look. */
const STATE_COLOUR = '#34496A'

const monogramOf = (name: string): string =>
  name
    .split(/\s+/)
    // Words that start with a capital letter (one that has a lower case): "State of Utah" is SU.
    .filter((word) => word && word[0] !== word[0].toLowerCase())
    .map((word) => word[0])
    .join('')
    .slice(0, 2)

/** The pass face CommunityPass draws, from what the card says. */
export function stateCardFace(view: StateCardView): PassFace {
  return {
    communityDid: view.technical.root ?? '',
    title: view.title,
    agent: view.guardianOf,
    kind: view.kind,
    field: view.issued,
    secondField: view.validUntil,
    // The cream pill: "Demo" or "Not checked". A refusal goes in the red one (CommunityPass's status).
    lapsing: view.tone === 'problem' ? undefined : view.pill,
    accessibilityLabel: view.accessibilityLabel,
  }
}

export function stateCardBrand(view: StateCardView): Known<CommunityBrand> {
  return {
    known: true,
    value: { color: STATE_COLOUR, pattern: 'rings', monogram: monogramOf(view.title), fromAccent: false },
  }
}

export interface StateCardPassProps {
  view: StateCardView
}

export const StateCardPass: React.FC<StateCardPassProps> = ({ view }) => {
  const [open, setOpen] = useState(false)
  if (!isStateCardEnabled()) return null
  return (
    <View style={styles.slot} testID={testIdWithKey('StateCard')}>
      <CommunityPass
        face={stateCardFace(view)}
        brand={stateCardBrand(view)}
        front
        onPress={() => setOpen(true)}
        status={view.tone === 'problem' ? view.pill : undefined}
      />
      <SafeAreaModal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <StateCardDetails view={view} onClose={() => setOpen(false)} />
      </SafeAreaModal>
    </View>
  )
}

const styles = StyleSheet.create({
  slot: { marginHorizontal: 15, marginTop: 15 },
})

export default StateCardPass
