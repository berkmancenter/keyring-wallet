import { render } from '@testing-library/react-native'
import React from 'react'

import { ChatEvent } from '../../src/components/chat/ChatEvent'
import { Role } from '../../src/types/chat'
import { BasicAppContext } from '../helpers/app'

describe('ChatEvent', () => {
  const renderWithContext = (props: React.ComponentProps<typeof ChatEvent>) =>
    render(
      <BasicAppContext>
        <ChatEvent {...props} />
      </BasicAppContext>
    )

  test('empty string prefix renders inline with bold title (credential messages)', () => {
    const { getByText } = renderWithContext({
      role: Role.me,
      prefix: '',
      title: 'Brendan M',
      subtitle: ' has sent you their R card',
    })

    const titleElement = getByText('Brendan M')
    expect(titleElement).toBeTruthy()
    const styles = [titleElement.props.style].flat(Infinity)
    expect(styles.some((s: any) => s && s.fontWeight === 'bold')).toBe(true)
  })

  test('undefined prefix with title uses two-line layout (bold title, separate subtitle)', () => {
    const { getByText } = renderWithContext({
      role: Role.me,
      title: 'Your Relationship DID',
      subtitle: 'shared with Brendan M',
    })

    const titleElement = getByText('Your Relationship DID')
    expect(titleElement).toBeTruthy()

    const subtitleElement = getByText('shared with Brendan M')
    expect(subtitleElement).toBeTruthy()
    expect(titleElement !== subtitleElement).toBe(true)
  })

  test('non-empty prefix renders inline with bold title', () => {
    const { getByText } = renderWithContext({
      role: Role.them,
      prefix: 'You connected with: ',
      title: 'Alice',
    })

    const titleElement = getByText('Alice')
    expect(titleElement).toBeTruthy()
    const styles = [titleElement.props.style].flat(Infinity)
    expect(styles.some((s: any) => s && s.fontWeight === 'bold')).toBe(true)
  })

  test('legacy format renders userLabel and actionLabel', () => {
    const { getByText } = renderWithContext({
      role: Role.me,
      userLabel: 'You',
      actionLabel: 'sent a message',
    })

    expect(getByText('You')).toBeTruthy()
    expect(getByText('sent a message')).toBeTruthy()
  })

  test('title-only renders without subtitle element', () => {
    const { getByText, queryByText } = renderWithContext({
      role: Role.them,
      title: 'Credential offer received',
    })

    expect(getByText('Credential offer received')).toBeTruthy()
    expect(queryByText('undefined')).toBeNull()
  })
})
