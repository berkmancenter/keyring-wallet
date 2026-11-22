import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { RenderProps, TourStep } from '../../../contexts/tour/tour-context'
import { TourBox } from '../../../components/tour/TourBox'

/**
 * Tour steps for the Contacts list screen
 * Step 0: General contacts overview (no spotlight)
 * Step 1: Spotlight on WitnessHeaderButton in the nav bar
 */
export const contactsTourSteps: TourStep[] = [
  {
    Render: (props: RenderProps) => {
      const { currentTour, currentStep, next, stop, previous } = props
      const { t } = useTranslation()
      const { ColorPalette, TextTheme } = useTheme()
      return (
        <TourBox
          title={t('Tour.ContactOffers')}
          hideLeft
          rightText={t('Tour.Next')}
          onRight={next}
          currentTour={currentTour}
          currentStep={currentStep}
          previous={previous}
          stop={stop}
          next={next}
          stepOn={1}
          stepsOutOf={2}
        >
          <Text
            style={{
              ...TextTheme.normal,
              color: ColorPalette.notification.infoText,
            }}
            allowFontScaling={false}
          >
            {t('Tour.ContactOffersDescription')}
          </Text>
        </TourBox>
      )
    },
  },
  {
    Render: (props: RenderProps) => {
      const { currentTour, currentStep, next, stop, previous } = props
      const { t } = useTranslation()
      const { ColorPalette, TextTheme } = useTheme()
      return (
        <TourBox
          title={t('Tour.WitnessIcon')}
          leftText={t('Tour.Back')}
          rightText={t('Tour.Done')}
          onLeft={previous}
          onRight={stop}
          currentTour={currentTour}
          currentStep={currentStep}
          previous={previous}
          stop={stop}
          next={next}
          stepOn={2}
          stepsOutOf={2}
        >
          <Text
            style={{
              ...TextTheme.normal,
              color: ColorPalette.notification.infoText,
            }}
            allowFontScaling={false}
          >
            {t('Tour.WitnessIconDescription')}
          </Text>
        </TourBox>
      )
    },
  },
]
