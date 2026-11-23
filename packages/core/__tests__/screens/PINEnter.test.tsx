import { render, fireEvent, waitFor, act } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { Keyboard } from 'react-native'

import { ContainerProvider } from '../../src/container-api'
import { MainContainer } from '../../src/container-impl'
import { AuthContext } from '../../src/contexts/auth'
import { StoreProvider, defaultState } from '../../src/contexts/store'
import reducer from '../../src/contexts/reducers/store'
import PINEnter from '../../src/screens/PINEnter'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'

// Create a stable reducer reference for testing
const stableReducer = reducer

describe('PINEnter Screen', () => {
  test('PIN Enter renders correctly', () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    expect(tree).toMatchSnapshot()
  })

  test('PIN Enter renders correctly when logged out message is present', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
            lockout: {
              displayNotification: true,
            },
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const textNotice = await tree.findByText('PINEnter.LockedOut')
    expect(textNotice).not.toBeNull()
    expect(tree).toMatchSnapshot()
  })

  test('PIN Enter button exists', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const EnterButton = await tree.getByTestId(testIdWithKey('Enter'))
    expect(EnterButton).not.toBeNull()
  })

  test('Forgot PIN link exists', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const forgotPinLink = await tree.getByTestId(testIdWithKey('ForgotPINLink'))
    expect(forgotPinLink).not.toBeNull()
  })

  test('Forgot PIN link displays popup modal on press', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const forgotPinLink = await tree.getByTestId(testIdWithKey('ForgotPINLink'))
    act(() => {
      forgotPinLink.props.onPress()
    })
    const popupModal = await tree.getByTestId(testIdWithKey('ForgotPINModalDescription'))
    expect(popupModal).not.toBeNull()
  })

  test('Forgot PIN modal is closed on close button press', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const forgotPinLink = await tree.getByTestId(testIdWithKey('ForgotPINLink'))
    act(() => {
      forgotPinLink.props.onPress()
    })
    const okayButton = await tree.getByLabelText('Global.Okay')
    act(() => {
      fireEvent.press(okayButton)
    })
    expect(tree.queryByTestId(testIdWithKey('ForgotPINModalDescription'))).toBeNull()
  })

  test('Vesion number is displayed', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const versionText = await tree.getByTestId(testIdWithKey('Version'))
    expect(versionText).not.toBeNull()
  })

  test('keyboard dismiss is called when pin input is filled', async () => {
    jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})

    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
          reducer={stableReducer}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const pinInput = tree.getByTestId(testIdWithKey('EnterPIN'))
    await act(async () => {
      fireEvent.changeText(pinInput, '123456') // minpinlength is 6
    })
    expect(Keyboard.dismiss).toHaveBeenCalled()
  })

  // IN-257: after a wrong PIN on the unlock screen the six dots stayed filled.
  test('a wrong PIN empties the field so the person can start over', async () => {
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValue(false),
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider initialState={{ ...defaultState }} reducer={stableReducer}>
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(testIdWithKey('EnterPIN')), '123456')
    })
    await waitFor(() => expect(mockAuthContext.checkWalletPIN).toHaveBeenCalledWith('123456'))
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('EnterPIN')).props.value).toBe(''))
  })

  // smoke's wrong-pin-clears (gate efficiency item 12), as a component test: a wrong PIN says so (inline, or in the
  // Incorrect PIN popup, whichever the build configures) and empties the field; the right PIN then unlocks.
  test('a wrong PIN is said and cleared, and the right one then unlocks', async () => {
    const setAuthenticatedMock = jest.fn()
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      setAuthenticated: setAuthenticatedMock,
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider initialState={{ ...defaultState }} reducer={stableReducer}>
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={setAuthenticatedMock} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(testIdWithKey('EnterPIN')), '111111')
    })
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('EnterPIN')).props.value).toBe(''))
    expect(tree.queryAllByText(/PINEnter\.IncorrectPIN/).length).toBeGreaterThan(0)
    expect(setAuthenticatedMock).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.changeText(tree.getByTestId(testIdWithKey('EnterPIN')), '123456')
    })
    await waitFor(() => expect(setAuthenticatedMock).toHaveBeenCalled())
    expect(mockAuthContext.checkWalletPIN).toHaveBeenNthCalledWith(1, '111111')
    expect(mockAuthContext.checkWalletPIN).toHaveBeenNthCalledWith(2, '123456')
  })

  test('pin is submitted when pin input is filled', async () => {
    const setAuthenticatedMock = jest.fn()
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValue(true),
      setAuthenticated: setAuthenticatedMock,
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
          reducer={stableReducer}
        >
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={mockAuthContext.setAuthenticated} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const pinInput = tree.getByTestId(testIdWithKey('EnterPIN'))
    await act(async () => {
      fireEvent.changeText(pinInput, '123456') // minpinlength is 6
    })
    await waitFor(() => {
      expect(setAuthenticatedMock).toHaveBeenCalled()
    })
  })

  test('Keyboard enter button submits PIN', async () => {
    const setAuthenticatedMock = jest.fn()
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValue(true),
      setAuthenticated: setAuthenticatedMock,
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={mockAuthContext.setAuthenticated} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const pinInput = tree.getByTestId(testIdWithKey('EnterPIN'))
    await act(async () => {
      fireEvent.changeText(pinInput, '12345') // only 5 characters so the pin isnt autosubmitted
    })

    await act(async () => {
      fireEvent(pinInput, 'submitEditing')
    })
    await waitFor(
      () => {
        // look for inline error message
        expect(tree.queryByText('PINCreate.PINTooShort')).not.toBeNull()
      },
      { timeout: 1000 }
    )
  })
})
