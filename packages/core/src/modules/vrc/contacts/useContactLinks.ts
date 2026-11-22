import { useAgent } from '@bifold/react-hooks'
import { useEffect, useState } from 'react'

import { ContactLinks, NO_CONTACT_LINKS, loadContactLinks, sameContactLinks } from './contactLinks'

/**
 * The contact links on this phone, read on mount and again whenever `refresh` changes (the Contacts list passes its
 * focus, so a merge or a separation made on another screen shows on return). Until the first read, no links: each
 * relationship is its own contact. A failed re-read keeps the last links read, so a passing storage error never splits
 * a merged contact back into rows. A re-read that finds the same links keeps the same map, so returning to a list
 * neither regroups it nor verifies its contacts again.
 */
export function useContactLinks(refresh?: unknown): ContactLinks {
  const { agent } = useAgent()
  const [links, setLinks] = useState<ContactLinks>(NO_CONTACT_LINKS)

  useEffect(() => {
    let cancelled = false
    loadContactLinks(agent)
      .then((loaded) => {
        if (!cancelled) setLinks((previous) => (sameContactLinks(previous, loaded) ? previous : loaded))
      })
      .catch((error: unknown) => {
        agent?.config?.logger?.warn(
          `[VRC:Contacts] could not read contact links: ${(error as Error)?.message ?? error}`
        )
      })
    return () => {
      cancelled = true
    }
  }, [agent, refresh])

  return links
}
