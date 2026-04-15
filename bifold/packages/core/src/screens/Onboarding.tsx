import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { Ref, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Animated, BackHandler, FlatList, StyleSheet, TouchableOpacity, View, ViewStyle, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../components/buttons/Button'
import IconButton, { ButtonLocation } from '../components/buttons/IconButton'
import { Pagination } from '../components/misc/Pagination'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { OnboardingStackParams } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'

export interface OnboardingStyleSheet {
  container: ViewStyle
  carouselContainer: ViewStyle
  pagerContainer: ViewStyle
  pagerDot: ViewStyle
  pagerDotActive: ViewStyle
  pagerDotInactive: ViewStyle
  pagerPosition: ViewStyle
  pagerNavigationButton: ViewStyle
}

const CARD_MARGIN = 20
const ARROW_HIT_AREA = 64
const ARROW_ICON_SIZE = 56
const ARROW_COLOR = '#AAAAAA'

interface OnboardingProps {
  pages: Array<Element>
  nextButtonText: string
  previousButtonText: string
  style: OnboardingStyleSheet
  disableSkip?: boolean
  onComplete?: () => void
  completeButtonText?: string
}

const Onboarding: React.FC<OnboardingProps> = ({
  pages,
  style,
  disableSkip = false,
  onComplete,
  completeButtonText,
}) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const flatList: Ref<FlatList> = useRef(null)
  const scrollX = useRef(new Animated.Value(0)).current
  const { t } = useTranslation()
  const navigation = useNavigation<StackNavigationProp<OnboardingStackParams>>()
  const [, dispatch] = useStore()
  const { width } = useWindowDimensions()

  const cardWidth = width - 2 * CARD_MARGIN
  const scrollScale = width / cardWidth
  const scaledScrollX = Animated.multiply(scrollX, scrollScale)

  const onViewableItemsChangedRef = useRef(({ viewableItems }: any) => {
    if (!viewableItems[0]) {
      return
    }
    setActiveIndex(viewableItems[0].index)
  })

  const viewabilityConfigRef = useRef({
    viewAreaCoveragePercentThreshold: 60,
  })

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: false,
  })

  const next = useCallback(() => {
    if (activeIndex + 1 < pages.length) {
      flatList?.current?.scrollToIndex({
        index: activeIndex + 1,
        animated: true,
      })
    }
  }, [activeIndex, pages, flatList])

  const previous = useCallback(() => {
    if (activeIndex !== 0) {
      flatList?.current?.scrollToIndex({
        index: activeIndex - 1,
        animated: true,
      })
    }
  }, [activeIndex, flatList])

  const renderItem = useCallback(
    ({ item, index }: { item: Element; index: number }) => (
      <View key={index} style={[{ width: cardWidth }, style.carouselContainer]}>
        {item as React.ReactNode}
      </View>
    ),
    [cardWidth, style.carouselContainer]
  )

  const onSkipTouched = useCallback(() => {
    dispatch({
      type: DispatchAction.DID_COMPLETE_TUTORIAL,
    })
  }, [dispatch])

  useEffect(() => {
    !disableSkip &&
      navigation.setOptions({
        headerRight: () => (
          <IconButton
            buttonLocation={ButtonLocation.Right}
            accessibilityLabel={t('Onboarding.SkipA11y')}
            testID={testIdWithKey('Skip')}
            onPress={onSkipTouched}
            icon="chevron-right"
            text={t('Global.Skip')}
          />
        ),
      })

    if (!disableSkip && activeIndex + 1 === pages.length) {
      navigation.setOptions({
        headerRight: () => false,
      })
    }
  }, [disableSkip, navigation, t, onSkipTouched, activeIndex, pages])

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        BackHandler.exitApp()
        return true
      }

      BackHandler.addEventListener('hardwareBackPress', onBackPress)
      return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress)
    }, [])
  )

  const isFirst = activeIndex === 0
  const isLast = activeIndex === pages.length - 1

  return (
    <SafeAreaView style={[style.container, localStyles.safeArea]} edges={['left', 'right', 'bottom']}>
      <View style={localStyles.cardWrapper}>
        <View style={localStyles.card}>
          <FlatList
            ref={flatList}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ width: cardWidth, flex: 1 }}
            data={pages}
            renderItem={renderItem}
            viewabilityConfig={viewabilityConfigRef.current}
            onViewableItemsChanged={onViewableItemsChangedRef.current}
            onScroll={onScroll}
            scrollEventThrottle={16}
          />

          {!isFirst && (
            <TouchableOpacity
              accessible={true}
              accessibilityLabel={t('Global.Back')}
              accessibilityRole={'button'}
              testID={testIdWithKey('Back')}
              onPress={previous}
              style={[localStyles.arrowOverlay, localStyles.leftArrow]}
            >
              <Icon name="chevron-left" size={ARROW_ICON_SIZE} color={ARROW_COLOR} />
            </TouchableOpacity>
          )}

          {!isLast && (
            <TouchableOpacity
              accessible={true}
              accessibilityLabel={t('Global.Next')}
              accessibilityRole={'button'}
              testID={testIdWithKey('Next')}
              onPress={next}
              style={[localStyles.arrowOverlay, localStyles.rightArrow]}
            >
              <Icon name="chevron-right" size={ARROW_ICON_SIZE} color={ARROW_COLOR} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Pagination
        pages={pages}
        activeIndex={activeIndex}
        scrollX={scaledScrollX as unknown as Animated.Value}
        style={style}
      />

      {onComplete && (
        <View style={localStyles.buttonContainer}>
          <View style={localStyles.buttonInner}>
            <Button
              title={completeButtonText ?? t('Global.GetStarted')}
              accessibilityLabel={completeButtonText ?? t('Global.GetStarted')}
              testID={testIdWithKey('GetStarted')}
              onPress={onComplete}
              buttonType={ButtonType.Primary}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  )
}

const localStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    alignItems: 'stretch',
  },
  cardWrapper: {
    flex: 1,
    paddingHorizontal: CARD_MARGIN,
    paddingTop: 28,
    paddingBottom: 20,
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(170,170,170,0.4)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  arrowOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: ARROW_HIT_AREA,
    zIndex: 10,
  },
  leftArrow: {
    left: 2,
  },
  rightArrow: {
    right: 2,
  },
  buttonContainer: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 16,
  },
  buttonInner: {
    width: '42%',
    minWidth: 148,
  },
})

export default Onboarding
