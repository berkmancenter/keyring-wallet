/**
 * An identity on the sign-in screens: one block, on the choice and again on the review, so the person reads the same
 * thing in both places. It is named by the agent that holds it, which is what tells two identities of one community
 * apart, with whether that is this phone's agent, the role, and when it joined.
 *
 * Only what this phone records is said (`identitiesWithStanding`): an identity made elsewhere has no role or date here,
 * and none is guessed.
 *
 * @module trust-tasks/screens/SignInIdentity
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import type { PersonaSignInIdentity } from '../module/signInSteps'

import { roleWords } from './communityCardDisplay'
import { localDate } from './localTime'

/** A persona with no name, by its DID's last part (a did:webvh path names it), never the whole DID on a picker row. */
export const shortPersonaDid = (did: string): string => {
  const last = did.split(':').pop() || did
  return last.length > 24 ? `${last.slice(0, 20)}…` : last
}

/** The name a phone gives an identity when a join names none, from the time it was made (VtaClient `ensurePersona`). */
const GENERATED_LABEL = /^keyring-[0-9a-z]{8}$/

/** The identity's name: its agent, with a label someone chose when it has one. */
export function identityName(identity: PersonaSignInIdentity): string {
  const label = identity.label?.trim()
  const chosen = label && !GENERATED_LABEL.test(label) ? label : undefined
  // Made elsewhere with no label: two on one agent would read the same.
  const name = chosen ?? (identity.source === 'agent' ? shortPersonaDid(identity.did) : undefined)
  return name ? `${name} · ${identity.agentName}` : identity.agentName
}

/** The line under the name, and whether it warns that this identity will likely not sign in. */
export function identityLine(identity: PersonaSignInIdentity, t: TFunction): { words: string; warns: boolean } {
  if (identity.agentSilent) return { words: t('SignIn.Failure.agentUnreachable'), warns: true }
  if (identity.endedAt) {
    return { words: t('VtaLink.CardMembershipEnded', { date: localDate(identity.endedAt) }), warns: true }
  }
  if (identity.memberSince) {
    return { words: t('MyAgent.MemberSince', { date: localDate(identity.memberSince) }), warns: false }
  }
  return {
    words: t(identity.source === 'thisPhone' ? 'SignIn.ChooseFromPhone' : 'SignIn.ChooseFromAgent'),
    warns: false,
  }
}

const whereHeld = (identity: PersonaSignInIdentity, t: TFunction): string =>
  t(identity.current ? 'SignIn.ThisPhonesAgent' : 'SignIn.AnotherAgent')

/** The block as one spoken label, for the row that holds it. */
export function identityLabel(identity: PersonaSignInIdentity, t: TFunction): string {
  const role = identity.role ? [roleWords(identity.role, t)] : []
  return [identityName(identity), whereHeld(identity, t), ...role, identityLine(identity, t).words].join(', ')
}

export interface SignInIdentityBlockProps {
  identity: PersonaSignInIdentity
  /** On the agent's chip: what the tests and the e2e drivers read it by. */
  agentTestID?: string
  /** Without the line under the name: the review keeps it behind Details. */
  short?: boolean
}

export const SignInIdentityBlock: React.FC<SignInIdentityBlockProps> = ({ identity, agentTestID, short = false }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { primary } = ColorPalette.brand
  const { mediumGrey } = ColorPalette.grayscale
  const line = identityLine(identity, t)
  const styles = StyleSheet.create({
    block: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    mark: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2,
      borderColor: identity.current ? primary : mediumGrey,
      backgroundColor: identity.current ? primary : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    words: { flex: 1, gap: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: primary },
    heldHere: { backgroundColor: primary },
    heldThere: { borderColor: mediumGrey },
    chipOnPrimary: { color: ColorPalette.grayscale.white, fontSize: 13 },
    chipWords: { color: primary, fontSize: 13 },
    chipThere: { color: ColorPalette.grayscale.darkGrey, fontSize: 13 },
    line: { flexDirection: 'row', gap: 6 },
    lineWords: { flex: 1 },
    muted: { color: mediumGrey },
  })
  return (
    <View style={styles.block}>
      <View style={styles.mark}>
        <Icon
          name={identity.current ? 'cellphone' : 'server'}
          size={24}
          color={identity.current ? ColorPalette.grayscale.white : mediumGrey}
        />
      </View>
      <View style={styles.words}>
        <ThemedText variant="bold">{identityName(identity)}</ThemedText>
        <View style={styles.chips}>
          <View style={[styles.chip, identity.current ? styles.heldHere : styles.heldThere]}>
            <ThemedText style={identity.current ? styles.chipOnPrimary : styles.chipThere} testID={agentTestID}>
              {whereHeld(identity, t)}
            </ThemedText>
          </View>
          {identity.role ? (
            <View style={styles.chip}>
              <ThemedText style={styles.chipWords}>{roleWords(identity.role, t)}</ThemedText>
            </View>
          ) : null}
        </View>
        {short ? null : (
          <View style={styles.line}>
            {line.warns ? <Icon name="alert-outline" size={18} color={ColorPalette.notification.warnIcon} /> : null}
            <ThemedText
              variant={line.warns ? 'bold' : undefined}
              style={[styles.lineWords, line.warns ? {} : styles.muted]}
            >
              {line.words}
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  )
}
