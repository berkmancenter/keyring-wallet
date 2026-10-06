import { useTheme } from '@bifold/core'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Linking } from 'react-native'

import { pages } from '../../src/components/OnboardingPages'
import { BasicAppContext } from '../../__mocks__/helpers/app'

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

  // Alberto (10-07): a light aside under the agent slide.
  test('the agent slide says, lightly, that it is not that kind of agent', () => {
    const tree = render(
      <BasicAppContext>
        <Slides />
      </BasicAppContext>
    )
    expect(tree.getByTestId('OnboardingAgentDisclaimer')).toHaveTextContent('Onboarding.AgentDisclaimer')
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
