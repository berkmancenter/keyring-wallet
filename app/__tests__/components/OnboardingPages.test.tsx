import { useTheme } from '@bifold/core'
import { render } from '@testing-library/react-native'
import React from 'react'

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
    // In order, as the carousel shows them.
    const all = tree.root.findAll((n) => typeof n.props.children === 'string' && headings.includes(n.props.children))
    const order = [...new Set(all.map((n) => n.props.children as string))]
    expect(order).toEqual(headings)
  })
})
