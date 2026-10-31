/**
 * The member's own names for the people in the room on screen, and the names those people wrote on their own
 * directory cards, given once by the room screen and read by every label that names someone: the chat, notes, files
 * and members. One read for the room, not one per row.
 *
 * @module rooms/components/memberWords
 */
import React, { createContext, useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'

import type { Identity } from '../types'

import { memberText } from './roomWords'

const NONE: ReadonlyMap<string, string> = new Map()
const Petnames = createContext<ReadonlyMap<string, string>>(NONE)
const DirectoryNames = createContext<ReadonlyMap<string, string>>(NONE)

/**
 * Gives the screen below it the member's names for this community's members, and the names members wrote on their
 * own directory cards, each by member DID.
 */
export const PetnamesProvider: React.FC<{
  names: ReadonlyMap<string, string>
  directoryNames?: ReadonlyMap<string, string>
  children: React.ReactNode
}> = ({ names, directoryNames, children }) => (
  <Petnames.Provider value={names}>
    <DirectoryNames.Provider value={directoryNames ?? NONE}>{children}</DirectoryNames.Provider>
  </Petnames.Provider>
)

/** The words for another member, with the member's own name for them, else their own name, when there is one. */
export const useMemberWords = (): ((identity: Identity) => string) => {
  const { t } = useTranslation()
  const names = useContext(Petnames)
  const directoryNames = useContext(DirectoryNames)
  return useCallback(
    (identity: Identity) => memberText(t, identity, names.get(identity.did), directoryNames.get(identity.did)),
    [t, names, directoryNames]
  )
}

/** The name this member wrote on their own directory card, if the room screen has it. */
export const useDirectoryName = (did?: string): string | undefined => {
  const directoryNames = useContext(DirectoryNames)
  return did ? directoryNames.get(did) : undefined
}
