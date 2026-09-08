import { t } from 'i18next'
import React from 'react'
import { Actions } from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

export const renderActions = (
  props: any,
  theme: any,
  actions?: { text: string; icon: React.FC; onPress: () => void }[]
) => {
  return actions ? (
    <Actions
      {...props}
      // v3 prop names. It took `containerStyle` and `optionTintColor` in v2 and
      // silently ignores both now — v3 reads wrapperStyle and
      // actionSheetOptionTintColor (see Actions.d.ts). Nothing errored; the
      // styling simply never applied.
      wrapperStyle={{
        width: 40,
        height: 40,
        marginBottom: 6,
        marginLeft: 20,
      }}
      icon={() => (
        <Icon
          name={'plus-box-outline'}
          size={40}
          color={theme.options}
          accessible={true}
          accessibilityLabel={t('Chat.Actions')}
          accessibilityRole="button"
        />
      )}
      actionSheetOptionTintColor={theme.optionsText}
    />
  ) : null
}
