/**
 * The app's registrations shadow bifold's defaults because the app registers
 * into a child of bifold's container and resolves from that child
 * (container-compose.ts). If the app resolved from bifold's container, or its
 * registration went to the parent, everything would still run and every other
 * test would pass, but bifold's defaults would win. For message pickup that
 * silently means the polling restart on every return to the foreground. So
 * this goes through the same function App.tsx uses, and checks both sides: the
 * app's lifecycle from the composed container, and bifold's default from a
 * bare one. (The order of the two init() calls does not matter: a run with
 * bifold's init() last still passes.)
 */
import { defaultMessagePickupLifecycle, MainContainer, TOKENS } from '@bifold/core'
import path from 'path'
import { container } from 'tsyringe'

import { composeContainers } from '../container-compose'
import BCLogger from '../src/utils/logger'

// Stubs, each off the registration path under test. If you add one, say why here:
// - react-native-webview: a registered screen imports it, and its native module isn't in jest;
// - the app logger: AppContainer.init() starts its event listeners, which jest's logger mock lacks;
// - i18next's addResourceBundle (below): the VRC module registers its translations into a bare mock.
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('../src/utils/logger', () => {
  const log = jest.fn()
  return {
    __esModule: true,
    default: { startEventListeners: jest.fn(), info: log, warn: log, error: log, debug: log, trace: log },
  }
})

const fakeAgent = () => {
  const recipient = {
    stopMessagePickup: jest.fn(async () => undefined),
    initiateMessagePickup: jest.fn(async () => undefined),
  }
  return { agent: { modules: { didcomm: { mediationRecipient: recipient } } } as any, recipient }
}

// AppContainer.init() also registers the VRC module's translations through bifold's own copy of i18next, which is
// a bare mock in jest: give that copy (resolved from bifold core, as its register.ts resolves it) the one call.
// The directory app/jest.config.js maps @bifold/core into.
const bifoldCoreDir = path.resolve(__dirname, '../../bifold/packages/core')
for (const from of [__dirname, bifoldCoreDir]) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- the copy that directory resolves
  const i18nModule = require(require.resolve('i18next', { paths: [from] }))
  const i18n = i18nModule.default ?? i18nModule
  i18n.addResourceBundle ??= jest.fn()
}

describe('container composition', () => {
  it("the composed container gives the app's pickup lifecycle, not bifold's default", async () => {
    const { app, bifold } = composeContainers(((key: string) => key) as any, jest.fn(), jest.fn())
    const lifecycle = app.resolve(TOKENS.UTIL_MESSAGE_PICKUP)
    expect(lifecycle).not.toBe(defaultMessagePickupLifecycle)
    // And it went into the app's own child container: bifold's still gives the default. Without this, a
    // registration that landed on the parent would pass the line above (resolution falls through to it).
    expect(bifold.resolve(TOKENS.UTIL_MESSAGE_PICKUP)).toBe(defaultMessagePickupLifecycle)
    // Bifold's container has the app's logger (#650): without one, MainContainer's this.log?.info start-up lines,
    // the Askar scan shim's result among them, are silently skipped. (This replaces #650's regex guard over App.tsx,
    // which no longer builds the container itself.)
    expect((bifold as unknown as { log?: unknown }).log).toBe(BCLogger)

    // Behaviour, not just identity: the app's foreground does nothing (useBCAgentSetup restarts
    // pickup itself); bifold's default would stop and restart polling here.
    const { agent, recipient } = fakeAgent()
    await lifecycle.onForeground(agent)
    expect(recipient.stopMessagePickup).not.toHaveBeenCalled()
    expect(recipient.initiateMessagePickup).not.toHaveBeenCalled()
  }, 60_000)

  it("a bare bifold container gives bifold's default (the control)", async () => {
    const bare = new MainContainer(container.createChildContainer()).init()
    const lifecycle = bare.resolve(TOKENS.UTIL_MESSAGE_PICKUP)
    expect(lifecycle).toBe(defaultMessagePickupLifecycle)

    const { agent, recipient } = fakeAgent()
    await lifecycle.onForeground(agent)
    expect(recipient.stopMessagePickup).toHaveBeenCalled()
    expect(recipient.initiateMessagePickup).toHaveBeenCalled()
  }, 60_000)
})
