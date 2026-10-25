/**
 * Each scan of a sign-in code is its own screen. With REAL navigators in the
 * app's shape (a root stack, the tabs, the real My Agent stack) and the real
 * sign-in screen against fake steps: a second code scanned while a finished
 * sign-in is on screen opens a new sign-in for that code. Before, the code
 * was held in a module-level value and the route had no id, so the second
 * scan landed on the first one's screen, which still showed the first one's
 * result.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import MyAgentStack from '../../../navigators/MyAgentStack'
import { Screens, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import type { ClaimedSignIn } from '../module/oobSignIn'
import type { ProvedSignIn, SignInSteps } from '../module/signInSteps'
import type { ClaimedVta } from '../module/vtaClaim'
import type { VtaClaimSteps } from '../module/vtaClaimSteps'
import { myAgentLinkParams, routeKeyringAgentLink, type MyAgentDestination } from '../module/vtiLinks'
import { SignInIds } from '../screens/SignIn.ids'
import { VtaClaimIds } from '../screens/VtaClaim.ids'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/triggerLink', () => ({
  ...jest.requireActual('../module/triggerLink'),
  triggerLinkSignInEnabled: () => true,
}))

// The stack's other screens, as nothing: only the sign-in screen is under test.
jest.mock('../screens/MyAgent', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtiCommunity', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtiInvited', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtiJoin', () => ({ __esModule: true, default: () => null }))
jest.mock('../../vrc/screens/EditRCard', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaAgentHome', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaRequests', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaCreateAgent', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaDevices', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaAskMe', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaAgentSettings', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaNewPhoneOffer', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtaLink', () => ({
  ...jest.requireActual('../screens/VtaLink'),
  __esModule: true,
  default: () => null,
}))
jest.mock('../screens/VtiHiddenVetter', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtiHiddenVetting', () => ({ __esModule: true, default: () => null }))
jest.mock('../screens/VtiVetting', () => ({ __esModule: true, default: () => null }))
// The real setup screen too, with fake steps.
let mockClaimSteps: VtaClaimSteps
jest.mock('../screens/VtaClaim', () => {
  const actual = jest.requireActual('../screens/VtaClaim')
  const ReactActual = jest.requireActual('react')
  return {
    ...actual,
    __esModule: true,
    default: (props: object) => ReactActual.createElement(actual.default, { ...props, steps: mockClaimSteps }),
  }
})
// The real sign-in screen, with fake steps in place of the agent's.
let mockSteps: SignInSteps
jest.mock('../screens/SignIn', () => {
  const actual = jest.requireActual('../screens/SignIn')
  const ReactActual = jest.requireActual('react')
  return {
    ...actual,
    __esModule: true,
    default: (props: object) => ReactActual.createElement(actual.default, { ...props, steps: mockSteps }),
  }
})

const id = (key: string) => testIdWithKey(key)
const NOW = 1_800_000_000
const FIRST = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:first-vtc'
const SECOND = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:second-vtc'
const codeFor = (vtc: string) =>
  `https://link.trustoverip.org/t#_from=${vtc}&_id=XOcGXOQTCHb5iz4T2JD2RQ&_exp=${NOW + 300}&_type=/vti/flow/sign-in/0.1`

const claimed = {
  requestId: 'XOcGXOQTCHb5iz4T2JD2RQ',
  vtcDid: FIRST,
  base: 'https://vtc.example.org',
  portalOrigin: 'https://portal.example.org',
  decisionDeadline: NOW + 120,
  keyA: { did: 'did:key:z6MkA', verificationMethod: 'did:key:z6MkA#z6MkA', sign: jest.fn() },
  answer: {},
} as unknown as ClaimedSignIn
const proved: ProvedSignIn = {
  claimed,
  step2: {},
  sessionKey: {},
  requester: { browser: 'Firefox 131', os: 'macOS', location: 'Boston, US', sameNetwork: true },
  identifiedAs: 'Alberto',
  persona: { did: 'did:webvh:QmP:host:persona', entryId: 'entry-1' },
  version: '0.2',
}

const Root = createStackNavigator()
const Tabs = createBottomTabNavigator()
const TabStack = () => (
  <Tabs.Navigator screenOptions={{ unmountOnBlur: true }}>
    <Tabs.Screen name={TabStacks.MyAgentStack} component={MyAgentStack} />
  </Tabs.Navigator>
)
const App = ({ navRef }: { navRef: React.RefObject<any> }) => (
  <BasicAppContext>
    <NavigationContainer ref={navRef}>
      <Root.Navigator>
        <Root.Screen name="TabStack" component={TabStack} />
      </Root.Navigator>
    </NavigationContainer>
  </BasicAppContext>
)

/** The focused route, all the way down. */
const focused = (state: any): { name: string; params?: { link?: string } } => {
  const route = state.routes[state.index ?? 0]
  return route.state ? focused(route.state) : route
}
/** A scan, as the scanner and TabStack.tsx navigate it. */
const scan = (navRef: React.RefObject<any>, code: string) =>
  act(async () => {
    await routeKeyringAgentLink(code, {} as never, (destination: MyAgentDestination) =>
      navRef.current.navigate('TabStack', { screen: TabStacks.MyAgentStack, params: myAgentLinkParams(destination) })
    )
  })
const press = (tree: ReturnType<typeof render>, key: string) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(NOW * 1000)
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
  mockSteps = {
    community: jest.fn(async () => ({ member: true })),
    claim: jest.fn(async () => claimed),
    identifyAndProve: jest.fn(async () => proved),
    approve: jest.fn(async () => ({ status: 'approved' as const })),
    cancel: jest.fn(async () => ({ cancelled: true })),
  } as SignInSteps
})
afterEach(() => jest.useRealTimers())

test('a second code scanned over a finished sign-in opens its own sign-in, for that code', async () => {
  const navRef = React.createRef<any>()
  const tree = render(<App navRef={navRef} />)
  await act(async () => undefined)

  // The first code, signed in to the end.
  await scan(navRef, codeFor(FIRST))
  await press(tree, SignInIds.continue)
  await act(async () => {
    fireEvent.changeText(tree.getByTestId(id(SignInIds.numberInput)), '42')
  })
  await press(tree, SignInIds.numberContinue)
  await press(tree, SignInIds.approve)
  expect(tree.getByTestId(id(SignInIds.resultMessage))).toBeTruthy()

  // The second, over it.
  await scan(navRef, codeFor(SECOND))
  const top = focused(navRef.current.getRootState())
  expect(top.name).toBe(Screens.SignIn)
  expect(top.params?.link).toBe(codeFor(SECOND))
  // A new screen, at Confirm for the second community; the first one's result
  // stays on its own screen, beneath.
  const confirms = tree.getAllByTestId(id(SignInIds.confirm))
  expect(confirms).toHaveLength(1)
  const hosts = tree.getAllByTestId(id(SignInIds.host))
  expect(hosts).toHaveLength(1)
  expect(hosts[0]).toHaveTextContent(/second-vtc/)
  expect(mockSteps.community).toHaveBeenLastCalledWith(SECOND)
})

const FARM_ONE = 'did:webvh:QmFarmScid:first-farm.example.com'
const FARM_TWO = 'did:webvh:QmFarmScid:second-farm.example.com'
const setupCodeFor = (farm: string) =>
  `https://link.trustoverip.org/t#_from=${farm}&_id=q3Vt7mXo9LwA2bR5cJ8kNg&_exp=${NOW + 600}&_type=/vti/flow/vta-claim/0.1`

test('a second setup code scanned over a finished setup opens its own screen, for that code', async () => {
  mockClaimSteps = {
    canOwn: jest.fn(async () => true),
    confirmOwner: jest.fn(async () => ({ ok: true })),
    claim: jest.fn(async () => ({ farmDid: FARM_ONE, claimCheck: 'T5WZ42' }) as unknown as ClaimedVta),
    redeem: jest.fn(async () => ({ vtaDid: 'did:webvh:QmNew:dids.example.com:vta', operation: 'provisionVta' })),
    finish: jest.fn(async () => ({ kind: 'linked', vtaDid: 'did:webvh:QmNew:dids.example.com:vta' })),
  } as unknown as VtaClaimSteps
  const navRef = React.createRef<any>()
  const tree = render(<App navRef={navRef} />)
  await act(async () => undefined)

  await scan(navRef, setupCodeFor(FARM_ONE))
  await press(tree, VtaClaimIds.continue)
  expect(tree.getByTestId(id(VtaClaimIds.ready))).toBeTruthy()

  await scan(navRef, setupCodeFor(FARM_TWO))
  const top = focused(navRef.current.getRootState())
  expect(top.name).toBe(Screens.VtaClaim)
  expect(top.params?.link).toBe(setupCodeFor(FARM_TWO))
  const hosts = tree.getAllByTestId(id(VtaClaimIds.host))
  expect(hosts).toHaveLength(1)
  expect(hosts[0]).toHaveTextContent(/second-farm/)
})
