/**
 * App's dependency containers are built once per mount, not on every render (container-compose.ts useAppContainer).
 * Built in App's render body, a new pair came with each render, and App renders again on every launch: HotUpdater's
 * wrapper re-renders it when its update check finishes (a device showed two "Initializing Bifold container" lines per
 * cold start, the second 18 ms after "[ota] check finished"). Each rebuild handed every useServices consumer new
 * instances, re-ran MainContainer.init's start-up work, and left another of the logger's event listeners behind.
 */
import { renderHook } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import path from 'path'

import { useAppContainer } from '../container-compose'
import BCLogger from '../src/utils/logger'

// The same stubs as containerComposition.test.ts, for the same reasons (see there).
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('../src/utils/logger', () => {
  const log = jest.fn()
  return {
    __esModule: true,
    default: { startEventListeners: jest.fn(), info: log, warn: log, error: log, debug: log, trace: log },
  }
})
const bifoldCoreDir = path.resolve(__dirname, '../../bifold/packages/core')
for (const from of [__dirname, bifoldCoreDir]) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- the copy that directory resolves
  const i18nModule = require(require.resolve('i18next', { paths: [from] }))
  const i18n = i18nModule.default ?? i18nModule
  i18n.addResourceBundle ??= jest.fn()
}

const logger = BCLogger as unknown as { info: jest.Mock; startEventListeners: jest.Mock }
const inits = () => logger.info.mock.calls.filter(([line]) => line === 'Initializing Bifold container').length

beforeEach(() => jest.clearAllMocks())

describe('useAppContainer', () => {
  const navigate = jest.fn()
  const setSurveyVisible = jest.fn()
  const t = ((key: string) => key) as any

  it('builds the containers once, however often App renders with the same inputs', () => {
    const { result, rerender } = renderHook(
      (props: { t: any }) => useAppContainer(props.t, navigate, setSurveyVisible),
      {
        initialProps: { t },
      }
    )
    const first = result.current
    // A parent re-render with nothing changed, as HotUpdater's wrapper does when its update check finishes.
    rerender({ t })
    rerender({ t })
    expect(result.current).toBe(first)
    expect(inits()).toBe(1)
    expect(logger.startEventListeners).toHaveBeenCalledTimes(1)
  })

  it('builds new ones when the translation function changes (a language change)', () => {
    const { result, rerender } = renderHook(
      (props: { t: any }) => useAppContainer(props.t, navigate, setSurveyVisible),
      {
        initialProps: { t },
      }
    )
    const first = result.current
    rerender({ t: ((key: string) => key) as any })
    expect(result.current).not.toBe(first)
    expect(inits()).toBe(2)
  })
})

describe('App.tsx gets its container through useAppContainer', () => {
  const app = readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf8')
  // A direct call in App's render body is the per-render rebuild this replaced.
  const direct = /\b(composeAppContainer|composeContainers)\s*\(|new\s+(MainContainer|AppContainer)\s*\(/

  it('calls useAppContainer and builds no container itself', () => {
    expect(app).toMatch(/\buseAppContainer\s*\(/)
    expect(app).not.toMatch(direct)
  })

  it('the scan sees a direct build (control)', () => {
    expect('  const c = composeAppContainer(t, navigate, setSurveyVisible)').toMatch(direct)
    expect('  const b = new MainContainer(container.createChildContainer(), BCLogger).init()').toMatch(direct)
  })
})
