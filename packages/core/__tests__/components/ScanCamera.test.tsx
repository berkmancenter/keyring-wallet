/**
 * The scan screen's camera comes back on when the screen is in view again: Scan stays mounted under the screen a scan
 * opens, and coming Back to it used to find the camera off for good (a blank box, nothing said). Until its first frame
 * the camera's area is dark with the spinner, not the screen's light grey; one that hasn't started after a few seconds
 * says so there, in plain words. And the camera says in the app's log what decides the picture, so a blank box in a
 * tester's report says why: the device and format, on or off and why, each camera step, any camera error, and no
 * picture after a few seconds.
 */
import { act, render, screen } from '@testing-library/react-native'
import React from 'react'
import { AppState } from 'react-native'
import { useCameraDevice } from 'react-native-vision-camera'

import ScanCamera, { SCAN_PREVIEW_WAIT_MS } from '../../src/components/misc/ScanCamera'
import { TOKENS } from '../../src/container-api'
import { MockLogger } from '../../src/testing/MockLogger'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../__mocks__/@react-navigation/native'),
  useIsFocused: () => mockFocused,
}))
jest.mock('react-native-orientation-locker', () => require('../../__mocks__/custom/react-native-orientation-locker'))
const FORMAT = { videoWidth: 3840, videoHeight: 2160, photoWidth: 8064, photoHeight: 6048, minFps: 1, maxFps: 30 }
const mockDevice = () => ({
  id: 'com.apple.avfoundation.avcapturedevice.built-in_video:7',
  position: 'back',
  physicalDevices: ['wide-angle-camera', 'ultra-wide-angle-camera'],
  supportsFocus: true,
})
jest.mock('react-native-vision-camera', () => ({
  useCameraDevice: jest.fn(() => mockDevice()),
  useCameraFormat: jest.fn(() => FORMAT),
  useCodeScanner: jest.fn((config) => config),
  Camera: 'Camera',
}))

let onAppState: ((state: string) => void) | undefined
let logger: MockLogger
beforeEach(() => {
  jest.useFakeTimers()
  ;(useCameraDevice as jest.Mock).mockImplementation(() => mockDevice())
  mockFocused = true
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const scanner = (handleCodeScan: (value: string) => Promise<void>) => (
  <BasicAppContext
    configure={(c) => {
      logger = new MockLogger()
      c.container.registerInstance(TOKENS.UTIL_LOGGER, logger)
    }}
  >
    <ScanCamera handleCodeScan={handleCodeScan} />
  </BasicAppContext>
)

const cameraOf = (tree: ReturnType<typeof render>) => tree.UNSAFE_root.findByType('Camera' as never).props
const scan = (tree: ReturnType<typeof render>, value: string) =>
  act(() => cameraOf(tree).codeScanner.onCodeScanned([{ value }]))
const lines = (level: 'info' | 'warn' | 'error') => logger[level].mock.calls.map(([line]) => String(line))
const lastInfo = () => lines('info').slice(-1)[0]

describe('the scan camera', () => {
  test('a scan turns it off; Back to the screen turns it on, and the next code scans', async () => {
    const handle = jest.fn(async () => undefined)
    const tree = render(scanner(handle))
    expect(cameraOf(tree).isActive).toBe(true)
    await scan(tree, 'first')
    expect(handle).toHaveBeenCalledTimes(1)
    expect(cameraOf(tree).isActive).toBe(false)

    // The scan opened the next screen over Scan, which stays mounted; then Back.
    mockFocused = false
    tree.rerender(scanner(handle))
    mockFocused = true
    tree.rerender(scanner(handle))
    expect(cameraOf(tree).isActive).toBe(true)
    await scan(tree, 'second')
    expect(handle).toHaveBeenCalledTimes(2)
  })

  test('control: with the screen never left, it stays off after a scan and a second code does nothing', async () => {
    const handle = jest.fn(async () => undefined)
    const tree = render(scanner(handle))
    await scan(tree, 'first')
    tree.rerender(scanner(handle))
    expect(cameraOf(tree).isActive).toBe(false)
    await scan(tree, 'second')
    expect(handle).toHaveBeenCalledTimes(1)
  })

  test('off while the screen is out of view or the app is in the background, and the log says which', async () => {
    const tree = render(scanner(jest.fn(async () => undefined)))
    mockFocused = false
    tree.rerender(scanner(jest.fn(async () => undefined)))
    expect(cameraOf(tree).isActive).toBe(false)
    expect(lastInfo()).toMatch(/off \(screen not in view\)$/)
    mockFocused = true
    tree.rerender(scanner(jest.fn(async () => undefined)))
    await act(async () => onAppState?.('background'))
    expect(cameraOf(tree).isActive).toBe(false)
    expect(lastInfo()).toMatch(/off \(app not active\)$/)
    await act(async () => onAppState?.('active'))
    expect(cameraOf(tree).isActive).toBe(true)
  })

  test("the log names the device, its lenses and the format, and each of the camera's steps and errors", async () => {
    const tree = render(scanner(jest.fn(async () => undefined)))
    expect(lines('info')[0]).toBe(
      '[Scan] camera: device back com.apple.avfoundation.avcapturedevice.built-in_video:7 ' +
        '(wide-angle-camera+ultra-wide-angle-camera), format video 3840x2160 photo 8064x6048 1-30 fps, on'
    )
    const camera = cameraOf(tree)
    await act(async () => {
      camera.onInitialized()
      camera.onStarted()
      camera.onPreviewStarted()
      camera.onError({ code: 'session/camera-has-been-disconnected', message: 'The camera was disconnected' })
    })
    expect(lines('info')).toEqual(
      expect.arrayContaining(['[Scan] camera initialized', '[Scan] camera started', '[Scan] camera preview started'])
    )
    expect(lines('error')).toEqual([
      '[Scan] camera error session/camera-has-been-disconnected: The camera was disconnected',
    ])
  })

  test('until the first frame: a dark box with the spinner, gone once the picture starts', async () => {
    const tree = render(scanner(jest.fn(async () => undefined)))
    expect(screen.getByTestId(testIdWithKey('ScanCameraWaiting'))).toBeTruthy()
    expect(screen.getByLabelText('Scan.CameraStarting')).toBeTruthy()
    await act(async () => cameraOf(tree).onPreviewStarted())
    expect(screen.queryByTestId(testIdWithKey('ScanCameraWaiting'))).toBeNull()
    // The picture stops (the camera turned off): the dark box is back, without the spinner.
    await act(async () => cameraOf(tree).onPreviewStopped())
    expect(screen.getByTestId(testIdWithKey('ScanCameraWaiting'))).toBeTruthy()
  })

  test('no picture a few seconds after it is on: plain words where the picture would be, and a log line', async () => {
    const tree = render(scanner(jest.fn(async () => undefined)))
    await act(async () => cameraOf(tree).onInitialized())
    await act(async () => void jest.advanceTimersByTime(SCAN_PREVIEW_WAIT_MS - 1))
    expect(screen.queryByTestId(testIdWithKey('ScanCameraNotStarting'))).toBeNull()
    await act(async () => void jest.advanceTimersByTime(1))
    expect(screen.getByTestId(testIdWithKey('ScanCameraNotStarting'))).toHaveTextContent('Scan.CameraNotStarting')
    expect(screen.queryByLabelText('Scan.CameraStarting')).toBeNull()
    expect(lines('warn')).toEqual([
      `[Scan] camera: no picture ${SCAN_PREVIEW_WAIT_MS} ms after it was turned on ` +
        '(device found, initialized yes, started no)',
    ])
    // A late first frame takes the words away.
    await act(async () => cameraOf(tree).onPreviewStarted())
    expect(screen.queryByTestId(testIdWithKey('ScanCameraNotStarting'))).toBeNull()
  })

  test('no camera found at all: the same dark box and, after a few seconds, the same words', async () => {
    ;(useCameraDevice as jest.Mock).mockImplementation(() => undefined)
    render(scanner(jest.fn(async () => undefined)))
    expect(lines('info')[0]).toMatch(/^\[Scan\] camera: device none found, /)
    expect(screen.getByTestId(testIdWithKey('ScanCameraWaiting'))).toBeTruthy()
    await act(async () => void jest.advanceTimersByTime(SCAN_PREVIEW_WAIT_MS))
    expect(screen.getByTestId(testIdWithKey('ScanCameraNotStarting'))).toBeTruthy()
    expect(lines('warn')[0]).toContain('device none found')
  })

  test('control: a picture in time says nothing in words or in the log', async () => {
    const tree = render(scanner(jest.fn(async () => undefined)))
    await act(async () => cameraOf(tree).onPreviewStarted())
    await act(async () => void jest.advanceTimersByTime(SCAN_PREVIEW_WAIT_MS * 2))
    expect(lines('warn')).toEqual([])
    expect(screen.queryByTestId(testIdWithKey('ScanCameraNotStarting'))).toBeNull()
  })
})
