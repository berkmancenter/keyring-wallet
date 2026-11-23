import { useIsFocused } from '@react-navigation/native'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Vibration,
  View,
  useWindowDimensions,
  Pressable,
  GestureResponderEvent,
  Animated,
} from 'react-native'
import { OrientationType, useOrientationChange } from 'react-native-orientation-locker'
import {
  Camera,
  CameraRuntimeError,
  Code,
  useCameraDevice,
  useCameraFormat,
  useCodeScanner,
} from 'react-native-vision-camera'

import { useTranslation } from 'react-i18next'

import { TOKENS, useServices } from '../../container-api'
import { QrCodeScanError } from '../../types/error'
import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'

export interface ScanCameraProps {
  handleCodeScan: (value: string) => Promise<void>
  error?: QrCodeScanError | null
  enableCameraOnError?: boolean
  torchActive?: boolean
}

/**
 * With the camera on, no first frame by then says so: in words where the picture would be, and in the log, naming
 * which of the camera's steps came.
 */
export const SCAN_PREVIEW_WAIT_MS = 5000

const styles = StyleSheet.create({
  waiting: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  waitingText: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
  focusIndicator: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
})

const ScanCamera: React.FC<ScanCameraProps> = ({ handleCodeScan, error, enableCameraOnError, torchActive }) => {
  const [orientation, setOrientation] = useState(OrientationType.PORTRAIT)
  const [cameraActive, setCameraActive] = useState(true)
  const orientationDegrees: { [key: string]: string } = {
    [OrientationType.PORTRAIT]: '0deg',
    [OrientationType['LANDSCAPE-LEFT']]: '270deg',
    [OrientationType['PORTRAIT-UPSIDEDOWN']]: '180deg',
    [OrientationType['LANDSCAPE-RIGHT']]: '90deg',
  }
  const [invalidQrCodes, setInvalidQrCodes] = useState(new Set<string>())
  const hasFiredRef = useRef(false)
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null)
  const focusOpacity = useRef(new Animated.Value(0)).current
  const focusScale = useRef(new Animated.Value(1)).current
  const device = useCameraDevice('back')
  const screenAspectRatio = useWindowDimensions().scale
  const format = useCameraFormat(device, [
    { fps: 20 },
    { videoAspectRatio: screenAspectRatio },
    { videoResolution: 'max' },
    { photoAspectRatio: screenAspectRatio },
    { photoResolution: 'max' },
  ])
  const camera = useRef<Camera>(null)
  const { t } = useTranslation()
  const [logger] = useServices([TOKENS.UTIL_LOGGER])
  const focused = useIsFocused()
  // Not yet known ('unknown', or none in tests) counts as active: the change events say when it isn't.
  const [appActive, setAppActive] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  )
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'))
    return () => sub.remove()
  }, [])
  // Back on this screen after a scan moved on (the screen stays mounted under the next one): the camera is on again
  // and the next code scans. It used to stay off until an error, a blank box with nothing said.
  const wasFocused = useRef(focused)
  useEffect(() => {
    if (focused && !wasFocused.current) {
      hasFiredRef.current = false
      setCameraActive(true)
    }
    wasFocused.current = focused
  }, [focused])
  const isActive = cameraActive && focused && appActive

  // One line each time what decides the preview changes, and one per camera step, so a report says why a box is
  // blank: no camera found, the camera off, or a session the system never started.
  const steps = useRef({ initialized: false, started: false })
  // Until the first frame, a dark box with the spinner, not the screen's light grey behind the cut-out; a camera that
  // hasn't started after a few seconds says so there, in words.
  const [preview, setPreview] = useState(false)
  const [slow, setSlow] = useState(false)
  // As words, so a new object for the same camera or format (each render, in tests) neither logs again nor restarts
  // the wait below.
  const lens = device ? `${device.position} ${device.id} (${device.physicalDevices.join('+')})` : 'none found'
  const size = format
    ? `format video ${format.videoWidth}x${format.videoHeight} photo ${format.photoWidth}x${format.photoHeight} ${format.minFps}-${format.maxFps} fps`
    : 'no format'
  const off = [!cameraActive && 'a code was scanned', !focused && 'screen not in view', !appActive && 'app not active']
    .filter(Boolean)
    .join(', ')
  useEffect(() => {
    logger.info(`[Scan] camera: device ${lens}, ${size}, ${off ? `off (${off})` : 'on'}`)
  }, [logger, lens, size, off])
  const found = !!device
  useEffect(() => {
    setSlow(false)
    if (!isActive || preview) return
    const timer = setTimeout(() => {
      const { initialized, started } = steps.current
      setSlow(true)
      logger.warn(
        `[Scan] camera: no picture ${SCAN_PREVIEW_WAIT_MS} ms after it was turned on (device ${
          found ? 'found' : 'none found'
        }, initialized ${initialized ? 'yes' : 'no'}, started ${started ? 'yes' : 'no'})`
      )
    }, SCAN_PREVIEW_WAIT_MS)
    return () => clearTimeout(timer)
  }, [logger, found, isActive, preview])

  const step = useCallback(
    (name: 'initialized' | 'started' | 'stopped' | 'preview started' | 'preview stopped') => {
      if (name === 'initialized') steps.current.initialized = true
      if (name === 'started') steps.current.started = true
      if (name === 'stopped') steps.current.started = false
      if (name === 'preview started') setPreview(true)
      if (name === 'preview stopped') setPreview(false)
      logger.info(`[Scan] camera ${name}`)
    },
    [logger]
  )
  const onCameraError = useCallback(
    (e: CameraRuntimeError) => logger.error(`[Scan] camera error ${e.code}: ${e.message}`),
    [logger]
  )

  useOrientationChange((orientationType) => {
    setOrientation(orientationType)
  })

  const onCodeScanned = useCallback(
    (codes: Code[]) => {
      const value = codes[0].value
      if (!value || invalidQrCodes.has(value)) {
        return
      }

      if (error?.data === value) {
        setInvalidQrCodes((prev) => new Set([...prev, value]))
        if (enableCameraOnError) {
          hasFiredRef.current = false
          return setCameraActive(true)
        }
      }

      if (hasFiredRef.current) {
        return
      }
      if (cameraActive) {
        hasFiredRef.current = true
        Vibration.vibrate()
        handleCodeScan(value)
        return setCameraActive(false)
      }
    },
    [invalidQrCodes, error, enableCameraOnError, cameraActive, handleCodeScan]
  )

  const drawFocusTap = async (point: { x: number; y: number }): Promise<void> => {
    // Draw a focus tap indicator on the camera preview
    setFocusPoint(point)

    focusOpacity.setValue(1)
    focusScale.setValue(1.5)

    Animated.parallel([
      Animated.timing(focusOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(focusScale, {
        toValue: 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setFocusPoint(null)
    })
  }

  const focus = useCallback((point: { x: number; y: number }) => {
    const c = camera.current
    if (c) {
      c.focus(point)
    }
  }, [])

  const handleFocusTap = (e: GestureResponderEvent): void => {
    if (!device?.supportsFocus) {
      return
    }
    const { locationX: x, locationY: y } = e.nativeEvent
    const tapPoint = { x, y }
    drawFocusTap(tapPoint)
    focus(tapPoint)
  }

  useEffect(() => {
    if (error?.data && enableCameraOnError) {
      hasFiredRef.current = false
      setCameraActive(true)
    }
  }, [error, enableCameraOnError])

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: onCodeScanned,
  })

  return (
    <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: orientationDegrees[orientation] ?? '0deg' }] }]}>
      {device && (
        <>
          <Camera
            ref={camera}
            style={StyleSheet.absoluteFillObject}
            device={device}
            torch={torchActive ? 'on' : 'off'}
            isActive={isActive}
            codeScanner={codeScanner}
            format={format}
            onInitialized={() => step('initialized')}
            onStarted={() => step('started')}
            onStopped={() => step('stopped')}
            onPreviewStarted={() => step('preview started')}
            onPreviewStopped={() => step('preview stopped')}
            onError={onCameraError}
          />
          <Pressable
            accessible={false}
            testID={testIdWithKey('ScanCameraTapArea')}
            style={StyleSheet.absoluteFill}
            onPressIn={(e) => {
              handleFocusTap(e)
            }}
          />
          {focusPoint && (
            <Animated.View
              testID={testIdWithKey('FocusIndicator')}
              style={[
                styles.focusIndicator,
                {
                  left: focusPoint.x - 40,
                  top: focusPoint.y - 40,
                  opacity: focusOpacity,
                  transform: [{ scale: focusScale }],
                },
              ]}
            />
          )}
        </>
      )}
      {!preview && (
        <View style={styles.waiting} pointerEvents="none" testID={testIdWithKey('ScanCameraWaiting')}>
          {isActive && slow ? (
            <ThemedText style={styles.waitingText} testID={testIdWithKey('ScanCameraNotStarting')}>
              {t('Scan.CameraNotStarting')}
            </ThemedText>
          ) : isActive ? (
            <ActivityIndicator size="large" color="#FFFFFF" accessibilityLabel={t('Scan.CameraStarting')} />
          ) : null}
        </View>
      )}
    </View>
  )
}

export default ScanCamera
