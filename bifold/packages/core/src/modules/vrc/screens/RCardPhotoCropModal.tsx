import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Dimensions, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { CropRect, clampTranslation, coverScale, cropRectFromTransform } from '../utils/rcardCropMath'

export interface RCardPhotoCropModalProps {
  photoUri: string
  imageWidth: number
  imageHeight: number
  onCancel: () => void
  onConfirm: (crop: CropRect) => void
}

const MAX_ZOOM = 4

/** A square viewport, sized to fit comfortably within the screen width. */
const VIEWPORT_SIZE = Math.min(Dimensions.get('window').width - 80, 320)

/**
 * Lets the user pinch-zoom and pan a just-picked photo within a square
 * viewport before it's used as a profile photo — see
 * docs/plans/rcard-profile-picture-plan/2026-09-18-bam.md: this replaces the
 * OS picker's own `allowsEditing` crop UI (found to sometimes show a stale,
 * previously-cropped photo), and gives the user back the ability to choose
 * their framing that a silent auto-center-crop took away.
 *
 * First user of react-native-gesture-handler's Gesture API and of
 * react-native-reanimated in this package — both are already peer
 * dependencies with babel configured, but nothing here assumes a
 * GestureHandlerRootView exists higher in the tree, so one is rendered
 * locally around just this modal's content.
 */
const RCardPhotoCropModal: React.FC<RCardPhotoCropModalProps> = ({
  photoUri,
  imageWidth,
  imageHeight,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation()
  const baseScale = useMemo(() => coverScale(imageWidth, imageHeight, VIEWPORT_SIZE), [imageWidth, imageHeight])

  const zoom = useSharedValue(1)
  const savedZoom = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const savedTranslateX = useSharedValue(0)
  const savedTranslateY = useSharedValue(0)

  const panGesture = useMemo(
    () =>
      Gesture.Pan().onUpdate((event) => {
        'worklet'
        const clamped = clampTranslation(
          imageWidth,
          imageHeight,
          VIEWPORT_SIZE,
          baseScale * zoom.value,
          savedTranslateX.value + event.translationX,
          savedTranslateY.value + event.translationY
        )
        translateX.value = clamped.x
        translateY.value = clamped.y
      }).onEnd(() => {
        'worklet'
        savedTranslateX.value = translateX.value
        savedTranslateY.value = translateY.value
      }),
    [baseScale, imageHeight, imageWidth, savedTranslateX, savedTranslateY, translateX, translateY, zoom]
  )

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((event) => {
          'worklet'
          const nextZoom = Math.min(Math.max(savedZoom.value * event.scale, 1), MAX_ZOOM)
          zoom.value = nextZoom
          const clamped = clampTranslation(
            imageWidth,
            imageHeight,
            VIEWPORT_SIZE,
            baseScale * nextZoom,
            translateX.value,
            translateY.value
          )
          translateX.value = clamped.x
          translateY.value = clamped.y
        })
        .onEnd(() => {
          'worklet'
          savedZoom.value = zoom.value
          savedTranslateX.value = translateX.value
          savedTranslateY.value = translateY.value
        }),
    [baseScale, imageHeight, imageWidth, savedTranslateX, savedTranslateY, savedZoom, translateX, translateY, zoom]
  )

  const composedGesture = useMemo(() => Gesture.Simultaneous(panGesture, pinchGesture), [panGesture, pinchGesture])

  const imageStyle = useAnimatedStyle(() => ({
    width: imageWidth * baseScale,
    height: imageHeight * baseScale,
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: zoom.value }],
  }))

  const handleConfirm = () => {
    onConfirm(
      cropRectFromTransform(imageWidth, imageHeight, VIEWPORT_SIZE, baseScale * zoom.value, translateX.value, translateY.value)
    )
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.9)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        },
        title: {
          color: '#FFFFFF',
          fontSize: 18,
          fontWeight: '600',
          marginBottom: 16,
          textAlign: 'center',
        },
        viewport: {
          width: VIEWPORT_SIZE,
          height: VIEWPORT_SIZE,
          overflow: 'hidden',
          borderRadius: VIEWPORT_SIZE / 2,
          borderWidth: 2,
          borderColor: '#FFFFFF',
        },
        hint: {
          color: '#CCCCCC',
          fontSize: 13,
          marginTop: 16,
          textAlign: 'center',
        },
        actions: {
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 16,
          marginTop: 24,
          width: '100%',
        },
        actionButton: {
          flex: 1,
          maxWidth: 160,
        },
      }),
    []
  )

  return (
    <SafeAreaModal transparent animationType="fade" onRequestClose={onCancel}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <ThemedText style={styles.title}>{t('RCardOnboarding.Fields.CropTitle')}</ThemedText>
          <View style={styles.viewport}>
            <GestureDetector gesture={composedGesture}>
              <Animated.Image
                testID={testIdWithKey('RCardPhotoCropImage')}
                source={{ uri: photoUri }}
                style={imageStyle}
              />
            </GestureDetector>
          </View>
          <ThemedText style={styles.hint}>{t('RCardOnboarding.Fields.CropHint')}</ThemedText>
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button
                title={t('Global.Cancel')}
                buttonType={ButtonType.ModalSecondary}
                onPress={onCancel}
                accessibilityLabel={t('Global.Cancel')}
                testID={testIdWithKey('RCardPhotoCropCancel')}
              />
            </View>
            <View style={styles.actionButton}>
              <Button
                title={t('RCardOnboarding.Fields.CropConfirm')}
                buttonType={ButtonType.ModalPrimary}
                onPress={handleConfirm}
                accessibilityLabel={t('RCardOnboarding.Fields.CropConfirm')}
                testID={testIdWithKey('RCardPhotoCropConfirm')}
              />
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </SafeAreaModal>
  )
}

export default RCardPhotoCropModal
