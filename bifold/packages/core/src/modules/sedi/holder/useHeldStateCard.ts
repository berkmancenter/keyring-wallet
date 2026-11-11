/**
 * The state card Credentials shows, if any (SEDI/KERI holder card): the Guardian card this phone holds (the Developer
 * action "Hold the test Guardian card (K0)" puts it there), checked on this phone.
 *
 * The held record is read each time Credentials comes into focus (one record query), so a card held from Developer
 * settings is there on return. The chain check is not: it runs once per mount for a given card and switches
 * (checkKeyOf), never on a render or a focus that changed neither, so drawing the Wallet stays cheap.
 *
 * Nothing at all with "State card (demo)" off, its remote off or the SEDI/KERI one included, read at each render.
 *
 * @module sedi/holder/useHeldStateCard
 */
import { useAgent } from '@bifold/react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { heldGuardianEvidence, type GuardianEvidence } from '../../trust-tasks/guardianEvidence'
import { localDate } from '../../trust-tasks/screens/localTime'

import { checkHeldCard, checkKeyOf, stateCardView, type HeldCheck, type StateCardView } from './stateCard'
import { isStateCardEnabled } from './stateCardFlag'

const LOG_PREFIX = '[SEDI:StateCard]'

/** `focused`: whether Credentials is on screen (the list's own useIsFocused), so the held card is read on return. */
export function useHeldStateCard(focused: boolean): StateCardView | undefined {
  const { agent } = useAgent()
  const { t } = useTranslation()
  const [held, setHeld] = useState<GuardianEvidence | undefined>(undefined)
  const checked = useRef<{ key: string; check: HeldCheck } | undefined>(undefined)
  const on = isStateCardEnabled()

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

  if (!on || !held) return undefined
  const key = checkKeyOf(held)
  if (checked.current?.key !== key) {
    checked.current = {
      key,
      check: checkHeldCard(held, new Date(), (message) => agent?.config?.logger?.warn(`${LOG_PREFIX} ${message}`)),
    }
  }
  return stateCardView(held, checked.current.check, t, localDate)
}
