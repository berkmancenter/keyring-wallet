import { useTheme } from '@bifold/core'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Linking } from 'react-native'

import { pages } from '../../src/components/OnboardingPages'
import { BasicAppContext } from '../../__mocks__/helpers/app'
import enCopy from '../../src/localization/en'
import frCopy from '../../src/localization/fr'
import ptBrCopy from '../../src/localization/pt-br'

/** The slides, rendered one after another, as the onboarding carousel shows them. */
const Slides: React.FC = () => {
  const { OnboardingTheme } = useTheme()
  const slides = pages(() => undefined, OnboardingTheme) as unknown as React.ReactElement[]
  return <>{slides.map((slide, i) => React.cloneElement(slide, { key: i }))}</>
}

describe('the first-run slides', () => {
  // Alberto (10-05): one about agents, as simple as the others, with its icon,
  // after "Create Trusted Connections".
  test('a slide about agents comes right after trusted connections', () => {
    const tree = render(
      <BasicAppContext>
        <Slides />
      </BasicAppContext>
    )
    const headings = [
      'Onboarding.WelcomeHeading',
      'Onboarding.CredentialsHeading',
      'Onboarding.ConnectionsHeading',
      'Onboarding.AgentHeading',
      'Onboarding.SecurityHeading',
    ]
    const at = headings.map((h) => tree.getByText(h))
    expect(at).toHaveLength(5)
    expect(tree.getByText('Onboarding.AgentParagraph')).toBeTruthy()
    // In order, as the carousel shows them (the query returns tree order).
    const order = tree.getAllByText(/^Onboarding\.[A-Za-z]+Heading$/).map((n) => n.props.children)
    expect(order).toEqual(headings)
  })

  // Alberto (10-07): the agent slide opens with a wink, "Not that kind of
  // agent", in each language's own words, not a literal translation.
  test('the agent slide says it is not that kind of agent, in every language', () => {
    expect(enCopy.Onboarding.AgentParagraph).toMatch(/^Not that kind of agent — /)
    expect(frCopy.Onboarding.AgentParagraph).toMatch(/^Rien d'un agent secret/)
    expect(ptBrCopy.Onboarding.AgentParagraph).toMatch(/^Nada de agente secreto/)
  })

  // Alberto (10-07): the agent slide's shield a little larger, the circle the same.
  test("the agent slide's glyph is larger than the others, in the same circle", () => {
    const tree = render(
      <BasicAppContext>
        <Slides />
      </BasicAppContext>
    )
    expect(tree.UNSAFE_getAllByProps({ name: 'shield-account-outline', size: 104 })).toHaveLength(1)
    expect(tree.UNSAFE_getAllByProps({ width: 88, height: 88 }).length).toBeGreaterThan(0)
  })

  // Alberto (10-07): the project's page at the Applied Technology Lab.
  test("the welcome slide's link opens the project's page", () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const tree = render(
      <BasicAppContext>
        <Slides />
      </BasicAppContext>
    )
    fireEvent.press(tree.getByText('Onboarding.LearnMoreLink'))
    expect(open).toHaveBeenCalledWith('https://www.appliedtechnologylab.org/projects#keyring')
    open.mockRestore()
  })
})
