/**
 * Nothing RootStack mounts above the navigators may read a safe area.
 *
 * React Navigation's navigators wrap their screens in SafeAreaProviderCompat, so
 * anything rendered *under* a navigator can call useSafeAreaInsets(). The
 * components RootStack renders beside MainStack cannot: they sit above every
 * navigator, and nothing wraps that point in a SafeAreaProvider. A hook read
 * there throws "No safe area value available" on every render -- before any
 * early return, because hooks always run -- and the app dies at main-stack
 * mount. That is exactly what #937 did and #949 fixed.
 *
 * Two reasons this is a guard rather than a repeat of that fix's test:
 *
 *  1. `core/jestSetup.js` mocks react-native-safe-area-context with the
 *     library's own jest mock, which returns fixed insets and never throws, so
 *     no ordinary suite on any branch can see this class of defect. This file
 *     unmocks it and uses the real module.
 *  2. The source check below pins the SET of components in that position. A new
 *     provider or modal added beside MainStack fails this file until someone
 *     adds it to the mount rows, so the next one is caught by CI rather than by
 *     a phone.
 *
 * What it does NOT cover: anything under MainStack. That is not an omission --
 * those screens are inside the navigators, which supply a provider, so the hook
 * is legitimate there.
 */

jest.unmock('react-native-safe-area-context')

import { render } from '@testing-library/react-native'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { Modal } from 'react-native'

import { BasicAppContext } from '../helpers/app'

jest.mock('../../src/services/keychain', () => ({
  loadWalletKey: jest.fn().mockResolvedValue(true),
}))

// The one fake in this file, and it is named here rather than left to be found.
// ActivityProvider does `const { lockOutUser } = useAuth()` (contexts/activity.tsx:74),
// and AuthContext's default is null, so without an AuthProvider that destructure
// throws before any safe-area question arises. RootStack has AuthProvider above it
// (App.tsx:53), so supplying one is faithful; a minimal fake is used instead of the
// real provider because AuthProvider opens the store and starts an agent, none of
// which this file is about. Faking it costs no coverage of the defect being guarded:
// useAuth is a plain useContext (contexts/auth.tsx:322) and cannot throw the
// safe-area error.
jest.mock('../../src/contexts/auth', () => ({
  ...jest.requireActual('../../src/contexts/auth'),
  useAuth: () => ({ lockOutUser: jest.fn(), walletSecret: undefined }),
}))

import { ActivityProvider } from '../../src/contexts/activity'
import { BiometricConfirmationProvider } from '../../src/contexts/biometric-confirmation'
import ApproverOfferModal from '../../src/modules/trust-tasks/components/ApproverOfferModal'
import ConfirmItsYouModal from '../../src/modules/trust-tasks/components/ConfirmItsYouModal'
import CredentialExchangeQueryModal from '../../src/modules/trust-tasks/components/CredentialExchangeQueryModal'
import ContinuityCheckModal from '../../src/modules/vrc/components/ContinuityCheckModal'
import LateStepReadyModal from '../../src/modules/vrc/components/LateStepReadyModal'
import LocalityPreflightModal from '../../src/modules/vrc/components/LocalityPreflightModal'
import RelationshipProposalModal from '../../src/modules/vrc/components/RelationshipProposalModal'
import { roleOfferPromptStore } from '../../src/modules/trust-tasks/approverRole'
import { setTrustedApproversEnabled } from '../../src/modules/trust-tasks/module/trustedApproversFlag'
import { confirmPromptStore } from '../../src/modules/trust-tasks/confirmItsYou'
import { setConfirmItsYouEnabled } from '../../src/modules/trust-tasks/module/confirmItsYouFlag'

/**
 * Everything RootStack renders inside `if (shouldRenderMainStack && agent)`:
 * the provider chain and MainStack's siblings. MainStack itself is in the list
 * because it is in that position in the source; it is not mounted here, since
 * everything inside it is under a navigator and so has a provider.
 */
const ABOVE_THE_NAVIGATORS = [
  'ActivityProvider',
  'AgentProvider',
  'ApproverOfferModal',
  'BiometricConfirmationProvider',
  'ConfirmItsYouModal',
  'ContinuityCheckModal',
  'CredentialExchangeQueryModal',
  'LateStepReadyModal',
  'LocalityPreflightModal',
  'MainStack',
  'OpenIDCredentialRecordProvider',
  'RelationshipProposalModal',
  'VrcNameCacheProvider',
  'WitnessConnectionProvider',
]

/** The JSX element names RootStack uses in its main-stack branch, deduplicated and sorted. */
const elementsInTheMainStackBranch = (): string[] => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/navigators/RootStack.tsx'), 'utf8')
  const opens = source.indexOf('if (shouldRenderMainStack && agent) {')
  const closes = source.indexOf('return <OnboardingStack', opens)
  expect(opens).toBeGreaterThan(-1)
  expect(closes).toBeGreaterThan(opens)
  const branch = source.slice(opens, closes)
  return [...new Set([...branch.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort()
}

describe('what RootStack mounts above the navigators', () => {
  it('is exactly the set this file knows about', () => {
    // If this fails because something was added beside MainStack, add it to
    // ABOVE_THE_NAVIGATORS *and* give it a mount row below. Deleting it from the
    // list alone restores the green and removes the guard.
    expect(elementsInTheMainStackBranch()).toEqual(ABOVE_THE_NAVIGATORS)
  })

  it('is tested against the real safe-area module, not the jest mock', () => {
    // Guards the guard. Under core/jestSetup.js's global mock every row below
    // would pass whatever the components did, because the mock never throws.
    // A plain require, NOT jest.requireMock: requireMock returns the mock
    // registry's entry by design, so it reports a mock whether or not
    // jest.unmock took effect and this could never fail.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useSafeAreaInsets } = require('react-native-safe-area-context')
    expect(jest.isMockFunction(useSafeAreaInsets)).toBe(false)
  })

  // One row each, rather than one row for all of them: a single row would say
  // only that something in the set throws, and the next person would have to
  // bisect it by hand.
  describe.each([
    ['RelationshipProposalModal', RelationshipProposalModal],
    ['LateStepReadyModal', LateStepReadyModal],
    ['ContinuityCheckModal', ContinuityCheckModal],
    ['LocalityPreflightModal', LocalityPreflightModal],
    ['CredentialExchangeQueryModal', CredentialExchangeQueryModal],
    ['ApproverOfferModal', ApproverOfferModal],
    ['ConfirmItsYouModal', ConfirmItsYouModal],
  ])('%s', (_name, Component) => {
    it('mounts with no safe-area provider in scope', () => {
      // BasicAppContext carries the container, the three agent-backed providers
      // and the network context, and -- as #949's test established -- no
      // SafeAreaProvider. So this is the position RootStack mounts it in.
      //
      // Deliberately NOT wrapped in BiometricConfirmationProvider, although
      // RootStack nests these inside it: that provider renders a modal of its
      // own, so a fault in THAT would fail all five of these rows as well as
      // its own, and six red rows would read as six findings instead of one.
      // None of these five uses the biometric context, so leaving it out costs
      // nothing and keeps each row about one component.
      expect(() =>
        render(
          <BasicAppContext>
            <ActivityProvider>
              <Component />
            </ActivityProvider>
          </BasicAppContext>
        )
      ).not.toThrow()
    })
  })

  it('mounts ApproverOfferModal SHOWING an offer with no safe-area provider in scope', () => {
    // Its row above renders nothing (the switch is off by default), so that row alone says nothing about the sheet.
    // Here the switch is on and an offer waits, so the sheet itself is what mounts.
    setTrustedApproversEnabled(true)
    roleOfferPromptStore.set({
      open: true,
      connectionId: 'conn-guard',
      asker: 'Sam',
      agentDid: 'did:webvh:agent.example',
      actions: ['shareCredential'],
      request: { payload: { challenge: 'x'.repeat(43) } },
      receivedAt: new Date().toISOString(),
    })
    try {
      const view = render(
        <BasicAppContext>
          <ActivityProvider>
            <ApproverOfferModal />
          </ActivityProvider>
        </BasicAppContext>
      )
      // The real safe-area module's provider renders no children under jest (it waits for native insets), so the
      // sheet's words are not reachable here; what is, is that the sheet's modal mounted (switched off, there is none).
      expect(view.UNSAFE_root.findAllByType(Modal).length).toBeGreaterThan(0)
    } finally {
      roleOfferPromptStore.clear()
      setTrustedApproversEnabled(false)
    }
  })

  it('mounts ConfirmItsYouModal SHOWING a request with no safe-area provider in scope', () => {
    // Its row above renders nothing (the switch is off by default). Here the switch is on and a request waits.
    setConfirmItsYouEnabled(true)
    confirmPromptStore.set({
      open: true,
      connectionId: 'conn-guard',
      asker: 'Sam',
      note: 'Is this you calling?',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      request: { payload: { challenge: 'x'.repeat(43) } },
      receivedAt: new Date().toISOString(),
    })
    try {
      const view = render(
        <BasicAppContext>
          <ActivityProvider>
            <ConfirmItsYouModal />
          </ActivityProvider>
        </BasicAppContext>
      )
      expect(view.UNSAFE_root.findAllByType(Modal).length).toBeGreaterThan(0)
    } finally {
      confirmPromptStore.clear()
      setConfirmItsYouEnabled(false)
    }
  })

  it('mounts the biometric provider and its sheet with no safe-area provider in scope', () => {
    // The provider renders BiometricConfirmationModal unconditionally, which is
    // how #937 put a hook read in this position in the first place.
    expect(() =>
      render(
        <BasicAppContext>
          <ActivityProvider>
            <BiometricConfirmationProvider>
              <></>
            </BiometricConfirmationProvider>
          </ActivityProvider>
        </BasicAppContext>
      )
    ).not.toThrow()
  })
})
