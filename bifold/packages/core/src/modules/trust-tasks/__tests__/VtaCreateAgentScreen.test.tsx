/**
 * Create my agent (own_agent_subtask.md §1, §7), from the person's side: the
 * address first, then the owner code behind Face ID, then connect, then a
 * backup phone. What the person sees at each step, and the words when a step
 * does not happen.
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { TFunction } from 'i18next'
import { act, fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'
import { AppState, Share } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import QRCode from 'react-native-qrcode-svg'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { confirmOwner } from '../module/ownerConfirm'
import enCopy from '../../../localization/en/en.json'
import frCopy from '../../../localization/fr/fr.json'
import ptBrCopy from '../../../localization/pt-br/pt-br.json'
import { agentAddressScan } from '../module/agentAddressScan'
import { VtiRefusal } from '../module/vtiAgent'
import { deviceCodeScan } from '../module/deviceCodeScan'
import { AgentAlreadyOnPhone, vtaAgent } from '../module/vtaAgent'
import { DeviceActionRefused, DeviceCannotOwn } from '../module/vtaOwner'
import VtaCreateAgent, { GRANT_POLL_EVERY_MS, GRANT_POLL_WINDOW_MS, readyNameOf } from '../screens/VtaCreateAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockOpenScanner = jest.fn()
jest.mock('../screens/openScanner', () => ({ openScanner: (...a: unknown[]) => mockOpenScanner(...a) }))
jest.mock('../module/ownerConfirm', () => ({
  confirmOwner: jest.fn(),
  deviceCanOwn: jest.fn(async () => true),
  ownerLockKind: jest.fn(async () => 'fingerprint'),
}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
const VTA = 'did:webvh:QmAgent:agents.example:alice'
const id = (key: string) => testIdWithKey(key)

const show = () =>
  render(
    <BasicAppContext>
      <VtaCreateAgent />
    </BasicAppContext>
  )

beforeEach(() => {
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
  controller.set({ link: { kind: 'notLinked' } })
  jest.restoreAllMocks()
  ;(confirmOwner as jest.Mock).mockReset()
})

// Alberto, 10-05: "block it". The grant check refuses a community's own
// agent (CommunityAgentRefused); this screen says so, back on the address.
describe("create my agent: a community's own agent", () => {
  test('is said in words on the address step, where another address can be given', async () => {
    controller.set({
      link: { kind: 'showingKey', vtaDid: VTA, label: 'agents.example', did: 'did:key:z6MkOwner', checking: false },
    })
    jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
    const tree = show()
    await act(async () => {
      controller.set({ link: { kind: 'notLinked', lastError: { reason: 'communityAgent' } } })
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent(
      'VtaLink.FailedCommunityAgent VtaLink.FailedCommunityAgentCleanup'
    )
    expect(tree.getByTestId(id('AgentCreateAddressInput'))).toBeTruthy()
  })
})

// The one way to link by address (Alberto, 239): every failure of its own
// attempt is said, in the link screen's words, the original under Details.
describe('create my agent: a link that fails is said', () => {
  test('a key swap the agent refused, back on the address, with its own words under Details', async () => {
    controller.set({
      link: { kind: 'linking', vtaDid: VTA, label: VTA, step: 'rotating' },
    })
    const tree = show()
    await act(async () => {
      controller.set({
        link: { kind: 'notLinked', lastError: { reason: 'failed', swap: 'refused', detail: 'acl/update refused' } },
      })
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('VtaLink.SwapFailed.refused')
    expect(tree.getByTestId(id('AgentCreateAddressInput'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('AgentCreateErrorDetailsToggle')))
    expect(tree.getByTestId(id('AgentCreateErrorDetail'))).toHaveTextContent('acl/update refused')
  })

  test('an agent that refused the code says so', async () => {
    controller.set({
      link: { kind: 'showingKey', vtaDid: VTA, label: VTA, did: 'did:key:z6MkOwner', checking: false },
    })
    const tree = show()
    await act(async () => {
      controller.set({ link: { kind: 'notLinked', lastError: { reason: 'refused' } } })
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('VtaLink.FailedRefused')
  })

  test('an older failure, from before this screen, is not said on opening it', () => {
    controller.set({ link: { kind: 'notLinked', lastError: { reason: 'refused' } } })
    const tree = show()
    expect(tree.queryByTestId(id('AgentCreateError'))).toBeNull()
  })
})

describe('create my agent: the address comes first', () => {
  // IN-132: an agent this phone already has, entered by its address: said,
  // with a switch to it, and nothing made.
  test('an agent this phone already has is said so, with a switch to it', async () => {
    jest.spyOn(vtaAgent, 'startCreateAgent').mockRejectedValue(new AgentAlreadyOnPhone(VTA))
    const toIt = jest.spyOn(vtaAgent, 'switchToExisting').mockResolvedValue(undefined)
    const nav = useNavigation() as unknown as { reset: jest.Mock }
    nav.reset.mockClear()
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), VTA)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateAddressContinue')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('VtaLink.AlreadyOnPhone')
    fireEvent.press(tree.getByTestId(id('AgentCreateSwitchToExisting')))
    expect(toIt).toHaveBeenCalledWith(expect.anything(), VTA)
    expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: Screens.VtaAgent }] })
  })

  // "No code? Use your agent's address" (Alberto, 239): straight to the
  // address, without the introduction's Continue first.
  test('opened for an address, it starts at the address', () => {
    ;(useRoute as jest.Mock).mockReturnValue({ params: { byAddress: true } })
    const tree = show()
    expect(tree.queryByTestId(id('AgentCreateContinue'))).toBeNull()
    expect(tree.getByTestId(id('AgentCreateAddressInput'))).toBeTruthy()
    ;(useRoute as jest.Mock).mockReturnValue({ params: {} })
  })

  test('something that is not an agent address is refused in words, and nothing is made', async () => {
    const start = jest.spyOn(vtaAgent, 'startCreateAgent').mockResolvedValue(undefined)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), 'alice.example')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateAddressContinue')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.NotAnAddress')
    expect(start).not.toHaveBeenCalled()
  })

  test("an agent's address makes this phone's owner code; the link stores no host as its name", async () => {
    const start = jest.spyOn(vtaAgent, 'startCreateAgent').mockResolvedValue(undefined)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), `  ${VTA} `)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateAddressContinue')))
    })
    expect(start).toHaveBeenCalledWith({}, VTA, VTA)
  })

  test('return on the address field continues: the button may be under the keyboard', async () => {
    const start = jest.spyOn(vtaAgent, 'startCreateAgent').mockResolvedValue(undefined)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), VTA)
    await act(async () => {
      fireEvent(tree.getByTestId(id('AgentCreateAddressInput')), 'submitEditing')
    })
    expect(start).toHaveBeenCalledWith({}, VTA, VTA)
  })

  test('the steps sit in a view that lifts their buttons over the keyboard', () => {
    // (The mock draws keyboard-controller's view as a View: find it by its props.)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    const avoiding = tree.UNSAFE_getAllByType(KeyboardAvoidingView).find((v) => v.props.behavior === 'padding')
    expect(avoiding).toBeTruthy()
    expect(within(avoiding!).getByTestId(id('AgentCreateAddressInput'))).toBeTruthy()
    expect(within(avoiding!).getByTestId(id('AgentCreateAddressContinue'))).toBeTruthy()
  })

  // One way to link by address (Alberto, 239): a phone with no screen lock
  // cannot own the agent, so it is linked as a device, as an admin adds any
  // other, and is told why. No Face ID is asked: there is none to ask.
  test('a phone with no screen lock is linked as a device, told why, and asked for no Face ID', async () => {
    jest.spyOn(vtaAgent, 'startCreateAgent').mockRejectedValue(new DeviceCannotOwn())
    const manual = jest.spyOn(vtaAgent, 'startManualLink').mockImplementation(async () => {
      controller.set({
        link: { kind: 'showingKey', vtaDid: VTA, label: VTA, did: 'did:key:z6MkDevice', checking: false },
      })
    })
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), VTA)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateAddressContinue')))
    })
    expect(manual).toHaveBeenCalledWith(expect.anything(), VTA, VTA)
    expect(tree.queryByTestId(id('AgentCreateError'))).toBeNull()
    expect(tree.getByTestId(id('AgentCreateAsDevice'))).toHaveTextContent('CreateAgent.AsDeviceBody')
    expect(tree.queryByTestId(id('AgentCreateOwnerBody'))).toBeNull()
  })
})

/**
 * The address step scans too (228: "now the scanning QR code part isn't
 * here"). A host's page shows either the agent's address as a QR, which
 * fills the field, or its automatic-connection QR, which goes to that flow.
 */
describe('create my agent: the address can be scanned', () => {
  afterEach(() => agentAddressScan.cancel())

  // IN-125: a scan that reads the address goes straight on, with no Continue to press.
  test('Scan opens the scanner for an address; a scanned address fills the field and goes straight on', async () => {
    mockOpenScanner.mockClear()
    const start = jest.spyOn(vtaAgent, 'startCreateAgent').mockResolvedValue(undefined)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.press(tree.getByTestId(id('AgentCreateScanAddress')))
    expect(mockOpenScanner).toHaveBeenCalled()
    await act(async () => {
      expect(agentAddressScan.claim(VTA)).toEqual({ taken: true })
    })
    expect(tree.getByTestId(id('AgentCreateAddressInput')).props.value).toBe(VTA)
    expect(start).toHaveBeenCalledWith({}, VTA, VTA)
  })

  test('the step says the address can be scanned as well as pasted, in every language', () => {
    for (const [words, scan] of [
      [enCopy, /scan/i],
      [frCopy, /scannez/i],
      [ptBrCopy, /escaneie/i],
    ] as const) {
      expect(words.CreateAgent.AddressBody).toMatch(scan)
    }
  })

  // The host's page shows a code to scan (its connection QR) as well as the
  // address: a person holding only the code met "It starts with did:webvh:".
  test('the step says the hosting service shows a code or the address, naming no provider', () => {
    for (const [words, code] of [
      [enCopy, /\bcode\b/i],
      [frCopy, /\bcode\b/i],
      [ptBrCopy, /código/i],
    ] as const) {
      expect(words.CreateAgent.AddressBody).toMatch(code)
      expect(words.CreateAgent.AddressBody).toContain('did:webvh:')
      expect(words.CreateAgent.AddressBody).not.toMatch(/farm/i)
    }
  })

  test("a host's automatic-connection QR goes to that flow, asking the person there", () => {
    const scanHost = jest.spyOn(vtaAgent, 'scanHostOffer')
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.press(tree.getByTestId(id('AgentCreateScanAddress')))
    const callback = 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/callback/r.S'
    act(() => {
      expect(agentAddressScan.claim(JSON.stringify({ vta_did: VTA, callback_url: callback }))).toEqual({ taken: true })
    })
    expect(scanHost).toHaveBeenCalledWith({ vtaDid: VTA, callbackUrl: callback, host: 'vtafarm-api.ic3.dev' })
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtaLink)
  })
})

describe('the owner code is handed out only after Face ID', () => {
  const showingKey = () =>
    controller.set({
      link: { kind: 'showingKey', vtaDid: VTA, label: 'agents.example', did: 'did:key:z6MkOwner', checking: false },
    })

  test('cancelling Face ID says nothing and copies nothing', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: false, reason: 'cancelled' })
    const copy = jest.spyOn(Clipboard, 'setString')
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    expect(copy).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id('AgentCreateError'))).toBeNull()
  })

  test('a failed Face ID is said in words', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: false, reason: 'failed' })
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.NotConfirmed')
  })

  test('confirmed, the code is copied; checking after that asks no second time', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: true })
    const copy = jest.spyOn(Clipboard, 'setString')
    const check = jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    expect(copy).toHaveBeenCalledWith('did:key:z6MkOwner')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateConnect')))
    })
    expect(confirmOwner).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalled()
  })

  test('Share sends the code inside a sentence, never the bare did:key (AirDrop took it for a link)', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: true })
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never)
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateShareCode')))
    })
    const sent = share.mock.calls[0][0] as { title?: string; message: string }
    expect(sent.message).not.toBe('did:key:z6MkOwner')
    expect(sent.message).toMatch(/^CreateAgent\.ShareCodeMessage\n\ndid:key:z6MkOwner\n$/)
    expect(sent.title).toBe('CreateAgent.ShareCodeTitle')
  })

  test('an agent that has not admitted the code yet says so beside Connect', () => {
    controller.set({
      link: { kind: 'showingKey', vtaDid: VTA, label: 'a', did: 'did:key:z6MkOwner', checking: false, notYet: true },
    })
    const tree = show()
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.NotAcceptedYet')
  })
})

describe('setup ends at Ready; another device is added from My devices', () => {
  const linked = () =>
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: VTA,
        label: 'agents.example',
        linkedAt: '2026-09-25T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  const asAddDevice = () => (useRoute as jest.Mock).mockReturnValue({ params: { addDevice: true } })
  afterEach(() => (useRoute as jest.Mock).mockReturnValue({ params: {} }))

  // IN-50 (226, Galaxy S25+): on a tall phone with large text, heading + words
  // + a code as wide as the screen ran under the Next bar. The code's bottom
  // rows and one finder square were hidden, so no camera could read it.
  test('Add another device: the whole code fits in the space on screen, with a quiet zone around it', () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const tree = show()
    const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height } } })
    act(() => {
      fireEvent(tree.getByTestId(id('AgentCreateScroll')), 'layout', layout(420))
      fireEvent(tree.getByTestId(id('AgentBackupScanThisHeading')), 'layout', layout(70))
    })
    const code = tree.UNSAFE_getByType(QRCode).props as { size: number; quietZone?: number }
    const quiet = code.quietZone ?? 0
    expect(quiet).toBeGreaterThanOrEqual(16)
    // Screen padding 20 + card padding 16 on each side, the heading and the gap under it.
    expect(code.size + 2 * quiet).toBeLessThanOrEqual(420 - 2 * 20 - 2 * 16 - 70 - 8)
    // The words say the path that works, and nothing that contradicts it.
    expect(tree.getByTestId(id('AgentBackupAddressQr'))).toHaveTextContent(/CreateAgent\.BackupScanThisBody/)
  })

  test('once linked, setup goes straight to Ready: no backup step', () => {
    linked()
    const tree = show()
    expect(tree.getByTestId(id('AgentCreateReady'))).toBeTruthy()
    expect(tree.queryByTestId(id('AgentBackupAddressQr'))).toBeNull()
    expect(tree.getByTestId(id('AgentBackupNone'))).toHaveTextContent('CreateAgent.BackupLater')
  })

  // 238 gate, Android: Done popped back to the panel, which swapped itself for
  // the agent's page while the pop still animated, and the app was gone. Done
  // sets the stack to the agent's page instead, in one step.
  test("Done sets the stack to the agent's page, rather than going back", () => {
    linked()
    const nav = useNavigation() as unknown as { goBack: jest.Mock; reset: jest.Mock }
    nav.goBack.mockClear()
    nav.reset.mockClear()
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateDone')))
    expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: Screens.VtaAgent }] })
    expect(nav.goBack).not.toHaveBeenCalled()
  })

  // IN-123: a computer or another app (pnm) does not scan the agent's code;
  // the way to enter its code is said on the first step, not found after Next.
  test('a computer or another app: said on the first step, with "Enter its code" straight to the code', () => {
    linked()
    asAddDevice()
    const tree = show()
    expect(tree.getByTestId(id('AgentBackupOtherKinds'))).toHaveTextContent('CreateAgent.BackupOtherKinds')
    fireEvent.press(tree.getByTestId(id('AgentBackupEnterCode')))
    expect(tree.getByTestId(id('AgentBackupScanCode'))).toHaveTextContent(/CreateAgent\.BackupNowScanBody/)
    expect(tree.getByTestId(id('AgentBackupCodeInput'))).toBeTruthy()
  })

  const toBackupCode = async () => {
    const tree = show()
    expect(tree.getByTestId(id('AgentBackupAddressQr'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('AgentBackupNext')))
    fireEvent.changeText(tree.getByTestId(id('AgentBackupCodeInput')), 'did:key:z6MkBackup')
    return tree
  }

  // al-phone, 10-05: an add the agent refused (422) read as "didn't answer". A
  // refusal that arrives is said as one, with its code and its own words behind Details.
  test('a refusal from the agent is said as one, with its code and its words behind Details', async () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    jest
      .spyOn(vtaAgent, 'addBackupDevice')
      .mockRejectedValue(new VtiRefusal('validationFailed', 'payload member "authority" is not allowed'))
    const tree = await toBackupCode()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentBackupAdd')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.Device.refused')
    fireEvent.press(tree.getByTestId(id('AgentCreateErrorDetailsToggle')))
    expect(tree.getByTestId(id('AgentCreateErrorDetail'))).toHaveTextContent(/authority/)
  })

  // #30: the other phone now shows its code as a QR; this phone scans it.
  // IN-125: a scanned code is added straight away; the owner check (inside
  // addBackupDevice) is the only stop, with no Add to press.
  test('Scan its code: the scanned code is added straight away, named by its kind', async () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const add = jest
      .spyOn(vtaAgent, 'addBackupDevice')
      .mockResolvedValue({ did: 'did:key:z6MkNewPhone', role: 'admin', label: 'Computer', thisPhone: false })
    mockOpenScanner.mockClear()
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentBackupNext')))
    fireEvent.press(tree.getByTestId(id('AgentBackupScanButton')))
    expect(mockOpenScanner).toHaveBeenCalled()
    await act(async () => {
      deviceCodeScan.claim('did:key:z6MkNewPhone')
    })
    expect(add).toHaveBeenCalledWith({}, 'did:key:z6MkNewPhone', 'Devices.ShortComputer')
    deviceCodeScan.cancel()
  })

  // IN-126: one tap hands the agent's address to a computer (Universal Clipboard, AirDrop).
  test("the agent's address can be copied or shared from the first step", () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentBackupCopyAddress')))
    expect(tree.getByTestId(id('AgentBackupCopyAddress'))).toHaveTextContent('VtaLink.KeyCopied')
    expect(tree.getByTestId(id('AgentBackupShareAddress'))).toBeTruthy()
  })

  test("the agent's code can be shown as text, for an app with no camera", () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const tree = show()
    expect(tree.queryByTestId(id('AgentBackupAddressText'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('AgentBackupShowAsText')))
    expect(tree.getByTestId(id('AgentBackupAddressText'))).toHaveTextContent(VTA)
  })

  test("Add another device: the other phone's code is added, and it returns to My devices", async () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const add = jest
      .spyOn(vtaAgent, 'addBackupDevice')
      .mockResolvedValue({ did: 'did:key:z6MkBackup', role: 'admin', label: 'Backup phone', thisPhone: false })
    const navigation = useNavigation() as unknown as { goBack: jest.Mock }
    navigation.goBack.mockClear()
    const tree = await toBackupCode()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentBackupAdd')))
    })
    expect(add).toHaveBeenCalledWith({}, 'did:key:z6MkBackup', 'Devices.ShortComputer')
    expect(navigation.goBack).toHaveBeenCalled()
  })

  // IN-123: named when added, as My devices will show it: a plain default by
  // the kind of code, or the person's own name.
  test('the name typed for the device is the one the agent keeps', async () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const add = jest
      .spyOn(vtaAgent, 'addBackupDevice')
      .mockResolvedValue({ did: 'did:key:z6MkBackup', role: 'admin', label: 'Work laptop', thisPhone: false })
    const tree = await toBackupCode()
    // The field shows the default for a computer's code before anything is typed.
    expect(tree.getByTestId(id('DeviceNameInput')).props.value).toBe('Devices.ShortComputer')
    fireEvent.changeText(tree.getByTestId(id('DeviceNameInput')), 'Work laptop (pnm)')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentBackupAdd')))
    })
    expect(add).toHaveBeenCalledWith({}, 'did:key:z6MkBackup', 'Work laptop (pnm)')
  })

  // IN-52: the other phone's Share sends a sentence with the code on its own
  // line; pasted whole, it was refused as "That isn't a device code".
  test('a pasted message with the code in it adds the code, not the message', async () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const add = jest
      .spyOn(vtaAgent, 'addBackupDevice')
      .mockResolvedValue({ did: 'did:peer:2.Vz6MkOther', role: 'admin', label: 'Backup phone', thisPhone: false })
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentBackupNext')))
    fireEvent.changeText(
      tree.getByTestId(id('AgentBackupCodeInput')),
      'Add this code to agents.example so my phone can use it:\n\ndid:peer:2.Vz6MkOther\n'
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentBackupAdd')))
    })
    expect(add).toHaveBeenCalledWith({}, 'did:peer:2.Vz6MkOther', 'Devices.ShortPhone')
  })

  test('return on the code field adds the device: the button may be under the keyboard', async () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const add = jest
      .spyOn(vtaAgent, 'addBackupDevice')
      .mockResolvedValue({ did: 'did:key:z6MkBackup', role: 'admin', label: 'Backup phone', thisPhone: false })
    const tree = await toBackupCode()
    await act(async () => {
      fireEvent(tree.getByTestId(id('AgentBackupCodeInput')), 'submitEditing')
    })
    expect(add).toHaveBeenCalledWith({}, 'did:key:z6MkBackup', 'Devices.ShortComputer')
  })

  test('adding a device is titled "Add a device", not "Claim your agent"', () => {
    linked()
    asAddDevice()
    const navigation = useNavigation() as unknown as { setOptions: jest.Mock }
    navigation.setOptions.mockClear()
    show()
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Screens.AddDevice' })
  })

  test("claiming keeps the stack's own title", () => {
    const navigation = useNavigation() as unknown as { setOptions: jest.Mock }
    navigation.setOptions.mockClear()
    show()
    expect(navigation.setOptions).not.toHaveBeenCalledWith({ title: 'Screens.AddDevice' })
  })

  test("this phone's own code is refused in words, and the screen stays", async () => {
    linked()
    asAddDevice()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    jest.spyOn(vtaAgent, 'addBackupDevice').mockRejectedValue(new DeviceActionRefused('thisPhone'))
    const tree = await toBackupCode()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentBackupAdd')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.Device.thisPhone')
    expect(tree.getByTestId(id('AgentBackupScanCode'))).toBeTruthy()
  })

  test('every refusal a device action can give has words', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const copy = require('../../../localization/en/en.json')
    for (const reason of [
      'notLinked',
      'notADid',
      'thisPhone',
      'alreadyAdded',
      'notFound',
      'notPermitted',
      'accessRevoked',
      'stepUpRequired',
      'awaitingApproval',
      'noAnswer',
      'unreachable',
      'failed',
      'refused',
    ]) {
      expect(typeof copy.CreateAgent.Device[reason]).toBe('string')
    }
  })
})

describe('the phone waits for the agent to admit the code, on its own', () => {
  const showingKey = () =>
    controller.set({
      link: { kind: 'showingKey', vtaDid: VTA, label: 'a', did: 'did:key:z6MkOwner', checking: false },
    })

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('nothing is checked before the code is handed out', async () => {
    showingKey()
    const check = jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
    show()
    await act(async () => {
      jest.advanceTimersByTime(GRANT_POLL_EVERY_MS * 3)
    })
    expect(check).not.toHaveBeenCalled()
  })

  test('after Copy it checks on the interval, and moves on once the agent admits the phone', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: true })
    const check = jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    expect(tree.getByTestId(id('AgentCreateWaiting'))).toBeTruthy()
    await act(async () => {
      jest.advanceTimersByTime(GRANT_POLL_EVERY_MS * 2)
    })
    expect(check).toHaveBeenCalledTimes(2)
    expect(confirmOwner).toHaveBeenCalledTimes(1)
    await act(async () => {
      controller.set({ link: { kind: 'linking', step: 'rotating', vtaDid: VTA, label: 'a' } })
    })
    expect(tree.getByTestId(id('AgentCreateProgress'))).toBeTruthy()
  })

  // IN-135: the window counts time in Keyring, not time asleep. A phone that
  // slept through a slow setup comes back still waiting, with what was left.
  test('time with the app in the background does not count against the window', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: true })
    jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
    const changes: ((next: string) => void)[] = []
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (next: string) => void) => {
      changes.push(handler)
      return { remove: () => undefined }
    }) as never)
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    await act(async () => {
      jest.advanceTimersByTime(4 * 60 * 1000)
    })
    await act(async () => changes.forEach((c) => c('background')))
    await act(async () => {
      jest.advanceTimersByTime(30 * 60 * 1000)
    })
    await act(async () => changes.forEach((c) => c('active')))
    await act(async () => {
      jest.advanceTimersByTime(4 * 60 * 1000)
    })
    // Eight minutes in the app: still waiting.
    expect(tree.getByTestId(id('AgentCreateWaiting'))).toBeTruthy()
    await act(async () => {
      jest.advanceTimersByTime(3 * 60 * 1000)
    })
    expect(tree.queryByTestId(id('AgentCreateWaiting'))).toBeNull()
  })

  test('after 10 minutes it stops and offers Check again, which waits another window', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: true })
    const check = jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    await act(async () => {
      jest.advanceTimersByTime(GRANT_POLL_WINDOW_MS + GRANT_POLL_EVERY_MS)
    })
    expect(tree.queryByTestId(id('AgentCreateWaiting'))).toBeNull()
    const calls = check.mock.calls.length
    await act(async () => {
      jest.advanceTimersByTime(GRANT_POLL_EVERY_MS * 3)
    })
    expect(check.mock.calls).toHaveLength(calls)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCheckAgain')))
    })
    expect(check.mock.calls).toHaveLength(calls + 1)
    expect(tree.getByTestId(id('AgentCreateWaiting'))).toBeTruthy()
  })
})

describe('"Your agent is ready" names the agent, never its host', () => {
  const t = ((key: string) => (key === 'VtaLink.YourAgentFallback' ? 'your agent' : key)) as unknown as TFunction

  test('by the name it gives itself, once read', () => {
    expect(readyNameOf(VTA, { [VTA]: { label: 'Alice agent', source: 'agentName' } }, t)).toBe('Alice agent')
  })

  test('before it gives one, plainly "Your agent": not the host, which is a provider\'s domain', () => {
    expect(readyNameOf(VTA, {}, t)).toBe('Your agent')
    expect(readyNameOf(VTA, undefined, t)).toBe('Your agent')
    expect(readyNameOf(undefined, { [VTA]: { label: 'Alice agent', source: 'agentName' } }, t)).toBe('Your agent')
  })
})
