/**
 * VTI-Q14: "List me in the community's public member directory?" — asked,
 * off unless turned on, and honest that only the admin can undo it later.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React, { useState } from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import { testIdWithKey } from '../../../utils/testable'
import { communityTarget } from '../module/vtiCommunityLink'
import { DirectoryConsent } from '../screens/DirectoryConsent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const community = 'did:webvh:QmCommunity:vtc.example.org'

const Harness: React.FC<{ onChange: (v: boolean) => void }> = ({ onChange }) => {
  const [value, setValue] = useState(false)
  return (
    <DirectoryConsent
      communityDid={community}
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange(v)
      }}
    />
  )
}

describe('directory consent', () => {
  beforeEach(() => communityTarget.clear())

  it('is off until the person turns it on, and says what they can do later', () => {
    const onChange = jest.fn()
    const tree = render(
      <BasicAppContext>
        <Harness onChange={onChange} />
      </BasicAppContext>
    )
    const toggle = tree.getByTestId(testIdWithKey('DirectoryConsentSwitch'))
    expect(toggle.props.value).toBe(false)
    expect(tree.getByTestId(testIdWithKey('DirectoryConsentNote'))).toHaveTextContent('Registry.Note')

    fireEvent(toggle, 'valueChange', true)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(tree.getByTestId(testIdWithKey('DirectoryConsentSwitch')).props.value).toBe(true)
  })

  it('names the community, and tells the person what they can do later: ask the admin', () => {
    expect(en.Registry.ListMe).toContain('{{community}}')
    expect(en.Registry.Note).toMatch(/can't change this in Keyring later/)
    expect(en.Registry.Note).toMatch(/ask the community's admin/)
  })
})
