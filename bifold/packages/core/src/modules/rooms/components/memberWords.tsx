/**
 * The member's own names for the people in the room on screen, given once by the room screen and read by every
 * label that names someone: the chat, notes, files and members. One read for the room, not one per row.
 *
 * @module rooms/components/memberWords
 */
import React, { createContext, useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'

import type { Identity } from '../types'

import { memberText } from './roomWords'

const NONE: ReadonlyMap<string, string> = new Map()
const Petnames = createContext<ReadonlyMap<string, string>>(NONE)

/** Gives the screen below it the member's names for this community's members, by member DID. */
export const PetnamesProvider: React.FC<{ names: ReadonlyMap<string, string>; children: React.ReactNode }> = ({
  names,
  children,
}) => <Petnames.Provider value={names}>{children}</Petnames.Provider>

/** The words for another member, with the member's own name for them when there is one. */
export const useMemberWords = (): ((identity: Identity) => string) => {
  const { t } = useTranslation()
  const names = useContext(Petnames)
  return useCallback((identity: Identity) => memberText(t, identity, names.get(identity.did)), [t, names])
}
