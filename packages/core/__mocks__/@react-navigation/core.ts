const navigate = jest.fn()
const dispatch = jest.fn()
const replace = jest.fn()
const navigation = {
  __timestamp: process.hrtime(),
  navigate,
  replace,
  setOptions: jest.fn(),
  getParent: () => {
    return {
      navigate,
      dispatch,
      replace,
    }
  },
  getState: jest.fn(() => ({
    index: jest.fn(),
  })),
  goBack: jest.fn(),
  pop: jest.fn(),
  reset: jest.fn(),
  isFocused: () => true,
  dispatch,
}

const useNavigation = () => {
  return navigation
}

const useIsFocused = () => {
  return true
}

const CommonActions = {
  navigate: jest.fn(),
  reset: jest.fn(),
  goBack: jest.fn(),
}

// `createNavigatorFactory` lives HERE, not in @react-navigation/native — native
// only re-exports it. A test that mocks native with `...jest.requireActual(native)`
// gets the real native, whose inner require of this package still resolves to
// this mock; without this export, anything that then loads @react-navigation/stack
// (createStackNavigator calls it at module scope) dies with
// "createNavigatorFactory is not a function". The sibling native.ts mock already
// defines it; the two were inconsistent. Found via ContactDetails.test.tsx once
// it began importing container-impl (2026-09-12).
const createNavigatorFactory = jest.fn()

export { useNavigation, useIsFocused, CommonActions, createNavigatorFactory }
