import { MainContainer, TOKENS, initLanguages } from '@bifold/core'
import { DefaultOCABundleResolver } from '@bifold/oca/build/legacy'
import { container as rootContainer } from 'tsyringe'

import { StarterContainer } from '@/demo-profiles/starter/StarterContainer'
import StarterHomeHeader from '@/demo-profiles/starter/StarterHomeHeader'
import { localization } from '@/localization'

// initializeVrcModule registers the VRC module's translations, so i18next has
// to exist first — exactly as App.tsx initialises it before building any
// container.
beforeAll(() => {
  initLanguages(localization)
})

// The starter container's whole purpose is to be copied and swapped in for
// AppContainer, so what is worth testing is that it is genuinely swappable:
// it satisfies the Container contract and its example registrations resolve.
// If this fails, the file a newcomer is told to copy does not work.
const buildStarter = () => {
  const bifoldContainer = new MainContainer(rootContainer.createChildContainer()).init()
  return new StarterContainer(bifoldContainer).init()
}

describe('StarterContainer', () => {
  it('resolves the component it overrode', () => {
    expect(buildStarter().resolve(TOKENS.COMPONENT_HOME_HEADER)).toBe(StarterHomeHeader)
  })

  it('resolves an OCA resolver that needs no network', () => {
    const resolver = buildStarter().resolve(TOKENS.UTIL_OCA_RESOLVER)

    expect(resolver).toBeInstanceOf(DefaultOCABundleResolver)
  })

  it('still resolves what core registered, since it is a child container', () => {
    // A token the starter never touches. Getting it back is what proves the
    // starter overrides core rather than replacing it — the reason a copy of
    // this file does not have to re-register the whole app.
    expect(buildStarter().resolve(TOKENS.SCREEN_ONBOARDING)).toBeDefined()
  })

  it('resolves several tokens at once, as the app does at startup', () => {
    const [header, resolver] = buildStarter().resolveAll([TOKENS.COMPONENT_HOME_HEADER, TOKENS.UTIL_OCA_RESOLVER])

    expect(header).toBe(StarterHomeHeader)
    expect(resolver).toBeInstanceOf(DefaultOCABundleResolver)
  })

  it('loads persisted state without a stored value present', async () => {
    // The LOAD_STATE example runs on every boot, including a first one where
    // nothing has been persisted. It must not throw or dispatch there.
    const dispatch = jest.fn()

    await buildStarter().resolve(TOKENS.LOAD_STATE)(dispatch)

    expect(dispatch).not.toHaveBeenCalled()
  })
})
