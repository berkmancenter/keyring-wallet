import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { useTheme } from '../../contexts/theme'
import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'

export interface EmptyListProps {
  message?: string
}

const EmptyList: React.FC<EmptyListProps> = ({ message }) => {
  const { t } = useTranslation()
  const { ListItems, Assets, ColorPalette } = useTheme()

  return (
    // Centred across the width, like the contacts tab: the icon sat against
    // the left edge while the message under it was centred, so the wallet's
    // empty state looked unlike every other tab (report #22).
    <View
      style={{
        paddingTop: 100,
        height: '100%',
        alignItems: 'center',
        backgroundColor: ColorPalette.brand.primaryBackground,
      }}
    >
      <Assets.svg.emptyWallet fill={ListItems.emptyList.color} height={100} />
      <ThemedText style={[ListItems.emptyList, { textAlign: 'center' }]} testID={testIdWithKey('NoneYet')}>
        {message || t('Global.NoneYet!')}
      </ThemedText>
    </View>
  )
}

export default EmptyList
