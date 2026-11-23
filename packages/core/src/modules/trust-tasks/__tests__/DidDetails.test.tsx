/**
 * A DID kept behind words (#12), and, where a person may need to give it to an
 * admin, said whose it is and offered to copy (IN-120).
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { DidDetails } from '../screens/DidDetails'

const DID = 'did:webvh:QmPersona:dids.example:p'
const id = (k: string) => testIdWithKey(k)
const show = (props: Partial<React.ComponentProps<typeof DidDetails>> = {}) =>
  render(
    <BasicAppContext>
      <DidDetails did={DID} testIdStem="Who" {...props} />
    </BasicAppContext>
  )

describe('DidDetails', () => {
  it('by default: "Details", the identifier once opened, no hint and no Copy', () => {
    const tree = show()
    expect(tree.getByTestId(id('WhoToggle'))).toHaveTextContent(/VtaLink\.Details/)
    expect(tree.queryByTestId(id('WhoDid'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('WhoToggle')))
    expect(tree.getByTestId(id('WhoDid'))).toHaveTextContent(DID)
    expect(tree.queryByTestId(id('WhoHint'))).toBeNull()
    expect(tree.queryByTestId(id('WhoCopy'))).toBeNull()
  })

  it('with a label, a hint and Copy: says whose it is, and copies exactly the identifier', () => {
    ;(Clipboard.setString as jest.Mock).mockClear()
    const tree = show({ label: 'Your identity here', hint: 'Who sees it', copy: true })
    expect(tree.getByTestId(id('WhoToggle'))).toHaveTextContent(/Your identity here/)
    expect(tree.queryByTestId(id('WhoCopy'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('WhoToggle')))
    expect(tree.getByTestId(id('WhoHint'))).toHaveTextContent('Who sees it')
    expect(tree.getByTestId(id('WhoCopy'))).toHaveTextContent(/VtaLink\.CopyKey/)
    fireEvent.press(tree.getByTestId(id('WhoCopy')))
    expect(Clipboard.setString).toHaveBeenCalledWith(DID)
    expect(tree.getByTestId(id('WhoCopy'))).toHaveTextContent(/VtaLink\.KeyCopied/)
  })
})
