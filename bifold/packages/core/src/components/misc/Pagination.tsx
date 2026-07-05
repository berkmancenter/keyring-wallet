import React from 'react'
import { Animated, View } from 'react-native'
import { ScalingDot } from 'react-native-animated-pagination-dots'

interface IPaginationStyleSheet {
  pagerContainer: Record<string, any>
  pagerDot: Record<string, any>
  pagerDotActive: Record<string, any>
  pagerDotInactive: Record<string, any>
  pagerPosition: Record<string, any>
  pagerNavigationButton: Record<string, any>
}

interface IPaginationProps {
  pages: Array<Element>
  activeIndex: number
  scrollX: Animated.Value
  next?: () => void
  nextButtonText?: string
  previous?: () => void
  previousButtonText?: string
  style: IPaginationStyleSheet
}

export const Pagination: React.FC<IPaginationProps> = ({
  pages,
  scrollX,
  style,
}) => {
  return (
    <View style={[style.pagerContainer, { justifyContent: 'center' }]}>
      <ScalingDot
        data={pages}
        scrollX={scrollX}
        inActiveDotColor={style.pagerDotInactive.color}
        inActiveDotOpacity={1}
        activeDotColor={style.pagerDotActive.color}
        activeDotScale={1}
        dotStyle={style.pagerDot}
        containerStyle={style.pagerPosition}
      />
    </View>
  )
}
