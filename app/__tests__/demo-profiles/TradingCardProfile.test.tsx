import { Container, ContainerProvider, MainContainer, TOKENS, initLanguages, testIdWithKey } from '@bifold/core'
import { BrandingOverlay } from '@bifold/oca'
import { render } from '@testing-library/react-native'
import React from 'react'
import { container as rootContainer } from 'tsyringe'

import { installedDemoProfiles } from '@/demo-profiles'
import TradingCard from '@/demo-profiles/trading-card/TradingCard'
import { RCARD_TEMPLATE_ID } from '@/demo-profiles/trading-card/ocaBundles'
import { tradingCardProfile } from '@/demo-profiles/trading-card/TradingCardProfile'
import { localization } from '@/localization'

beforeAll(() => {
  initLanguages(localization)
})

const buildContainer = (profileInstalled: boolean): Container => {
  const container = new MainContainer(rootContainer.createChildContainer()).init()
  if (profileInstalled) {
    tradingCardProfile.register(container.container)
  }
  return container
}

/** One exchanged R-Card, as the contacts screen hands it to the card component. */
const ALICE = {
  issuer: {
    id: 'did:peer:alice',
    name: 'Alice Smith',
    organization: 'Acme Corp',
    photo: 'data:image/jpeg;base64,/9j/alice',
  },
  hasWitnessCredentials: false,
  hasHardwareAttestation: false,
}

const renderResolvedCard = (
  container: Container,
  contact: typeof ALICE,
  { hardwareVerified = false }: { hardwareVerified?: boolean } = {}
) => {
  const Card = container.resolve(TOKENS.COMPONENT_CONTACT_CARD)
  return render(
    <ContainerProvider value={container}>
      <Card contact={contact} hardwareVerified={hardwareVerified} onPress={jest.fn()} />
    </ContainerProvider>
  )
}

describe('the trading-card demo profile', () => {
  it('is installed in this build', () => {
    // The point of the profile shape: one binary carries every demo, so the
    // installed list is what a picker would offer.
    expect(installedDemoProfiles.map((profile) => profile.id)).toContain('trading-card')
  })

  it('takes over how an exchanged R-Card is drawn', () => {
    expect(buildContainer(true).resolve(TOKENS.COMPONENT_CONTACT_CARD)).toBe(TradingCard)
  })

  it('leaves the app alone until it is installed', () => {
    // Registration is additive: without the profile the app still resolves its
    // own contact card, so installing a demo cannot break the shipping wallet.
    const card = buildContainer(false).resolve(TOKENS.COMPONENT_CONTACT_CARD)

    expect(card).toBeDefined()
    expect(card).not.toBe(TradingCard)
  })

  it('renders the R-Card photo, name and organisation as a card', async () => {
    const { findByText, findByTestId, getByText } = renderResolvedCard(buildContainer(true), ALICE)

    // Branding resolution is async; waiting on it means the assertions below
    // see the settled card rather than its first frame.
    await findByText('Collector Card')
    const photo = await findByTestId(testIdWithKey('ContactAvatarImage'))
    expect(photo.props.source).toEqual({ uri: ALICE.issuer.photo })
    expect(getByText('Alice Smith')).toBeTruthy()
    expect(getByText('Acme Corp')).toBeTruthy()
  })

  it('takes its set name from the OCA bundle shipped inside the app', async () => {
    // No OCA_URL, no hosting, no network: the bundle is a plain object handed
    // to DefaultOCABundleResolver, and this is it arriving on screen.
    const { findByText } = renderResolvedCard(buildContainer(true), ALICE)

    expect(await findByText('Collector Card')).toBeTruthy()
  })

  it('still draws a card when the running app has no bundle for the R-Card', async () => {
    // A profile can be installed into an app whose OCA resolver is Keyring's
    // remote one. The card must degrade to its own colours rather than vanish.
    const container = buildContainer(false)
    const { findByText, getByText } = render(
      <ContainerProvider value={container}>
        <TradingCard contact={ALICE} hardwareVerified={false} onPress={jest.fn()} />
      </ContainerProvider>
    )

    expect(await findByText('Alice Smith')).toBeTruthy()
    expect(getByText('Trading Card')).toBeTruthy()
  })

  it('grades a card by what the exchange proved', async () => {
    const witnessed = { ...ALICE, hasWitnessCredentials: true }
    const container = buildContainer(true)

    const plain = renderResolvedCard(container, ALICE)
    await plain.findByText('Collector Card')
    expect(plain.getByText('COMMON')).toBeTruthy()

    const holo = renderResolvedCard(container, witnessed, { hardwareVerified: true })
    await holo.findByText('Collector Card')
    expect(holo.getByText('HOLO RARE')).toBeTruthy()
  })

  it('resolves its branding for the R-Card template with no network', async () => {
    const resolver = buildContainer(true).resolve(TOKENS.UTIL_OCA_RESOLVER)

    const bundle = await resolver.resolve({ identifiers: { templateId: RCARD_TEMPLATE_ID } })

    expect((bundle?.brandingOverlay as BrandingOverlay | undefined)?.primaryBackgroundColor).toBe('#2B1B4A')
  })

  it('does not claim an identifier it has no branding for', async () => {
    const resolver = buildContainer(true).resolve(TOKENS.UTIL_OCA_RESOLVER)

    await expect(resolver.resolve({ identifiers: { templateId: 'some-other-template' } })).resolves.toBeUndefined()
  })
})
