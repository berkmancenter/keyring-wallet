/**
 * The state card Credentials shows, if any (SEDI/KERI holder card): the Guardian card this phone holds (the Developer
 * action "Hold the test Guardian card (K0)" puts it there), checked on this phone.
 *
 * The held record is read each time Credentials comes into focus (one record query), so a card held from Developer
 * settings is there on return. The chain check is not: it runs once per card and inputs (checkKeyOf), never on a
 * render or a focus that changed neither, so drawing the Wallet stays cheap. (A remount, a new Credentials screen,
 * starts with no answer and checks again.)
 *
 * The check can fetch the state's published record over the network (checkGuardianEvidenceResolving), so it runs in an
 * effect, and until it answers the card says it is checking (never "Checks out"). An answer is dropped when it comes
 * back after the card unmounted, after its inputs moved, or after "State card (demo)" went off. One that comes back
 * while Credentials is merely out of focus (another tab on top, the card still mounted) is kept, and shows on return:
 * focus is not among the check's inputs.
 * When the card can't be checked at all (state-verified approvers off, no root trusted), that is known at once and
 * nothing runs.
 *
 * Nothing at all with "State card (demo)" off, its remote off or the SEDI/KERI one included, read at each render.
 *
 * @module sedi/holder/useHeldStateCard
 */
import { useAgent } from '@bifold/react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { heldGuardianEvidence, type GuardianEvidence } from '../../trust-tasks/guardianEvidence'
import { localClock, localDate } from '../../trust-tasks/screens/localTime'

import {
  checkHeldCard,
  checkKeyOf,
  heldCardUncheckable,
  stateCardView,
  type HeldCheck,
  type StateCardView,
} from './stateCard'
import { isStateCardEnabled } from './stateCardFlag'

const LOG_PREFIX = '[SEDI:StateCard]'
const PENDING: HeldCheck = { checked: 'pending' }

/** `focused`: whether Credentials is on screen (the list's own useIsFocused), so the held card is read on return. */
export function useHeldStateCard(focused: boolean): StateCardView | undefined {
  const { agent } = useAgent()
  const { t } = useTranslation()
  const [held, setHeld] = useState<GuardianEvidence | undefined>(undefined)
  const [answer, setAnswer] = useState<{ key: string; check: HeldCheck } | undefined>(undefined)
  const on = isStateCardEnabled()
  const key = on && held ? checkKeyOf(held) : undefined
  const uncheckable = on && held ? heldCardUncheckable() : undefined
  // The card as last read, for the check to use: a fresh read of the same card on focus is a new object, and must not
  // restart a check whose key (the card's SAID among its inputs) has not moved.
  const heldNow = useRef(held)
  heldNow.current = held
  const canCheck = !!key && !uncheckable

  useEffect(() => {
    if (!focused || !agent || !on) return
    let live = true
    heldGuardianEvidence(agent)
      .then((evidence) => {
        if (live) setHeld(evidence)
      })
      .catch((e: unknown) =>
        agent.config?.logger?.warn(`${LOG_PREFIX} could not read the held card: ${(e as Error)?.message ?? e}`)
      )
    return () => {
      live = false
    }
  }, [focused, agent, on])

  useEffect(() => {
    const card = heldNow.current
    // Runs when what the check reads moves (key), the switch flips, or the card becomes checkable: never on a render
    // or a focus that changed none of them, so a check runs once per card and inputs.
    if (!on || !card || !key || !canCheck) return
    let live = true
    const warn = (message: string) => agent?.config?.logger?.warn(`${LOG_PREFIX} ${message}`)
    checkHeldCard(card, new Date(), warn)
      .then((check) => {
        // Dropped when the card unmounted or what the check read moved (this effect was cleaned up), or when the
        // switch went off before the answer, even with no render since. Kept when Credentials is only out of focus.
        // An answer kept for an older key is never shown: the view takes an answer only for the key it renders.
        if (!live || !isStateCardEnabled()) return
        setAnswer({ key, check })
      })
      .catch((e: unknown) => warn(`the check stopped on an error: ${(e as Error)?.message ?? e}`))
    return () => {
      live = false
    }
  }, [on, key, canCheck, agent])

  if (!on || !held || !key) return undefined
  const check = uncheckable ?? (answer?.key === key ? answer.check : PENDING)
  return stateCardView(held, check, t, localDate, localClock)
}
