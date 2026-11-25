import { t } from 'i18next'
import React from 'react'
import { Actions } from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { testIdWithKey } from '../../utils/testable'
import { ChatIds } from './Chat.ids'
import { TAP_TARGET } from './MessageInput'

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
      // A plain "+" outside the field, in a full tap target (chat redesign C2): it was a boxed 40-point icon inside
      // the field (272). With an icon of our own, v3 never draws its wrapper, so wrapperStyle sizes nothing; the
      // touchable is sized by buttonStyle, over its own padding (10 + 26 + 4 by 7 + 26 + 7 = 40, measured on C2's
      // simulator check).
      buttonStyle={{ ...TAP_TARGET, padding: 0, paddingLeft: 0, paddingRight: 0, paddingVertical: 0 }}
      icon={() => (
        <Icon
          name={'plus'}
          size={26}
          color={'#4A4A4A'}
          accessible={true}
          accessibilityLabel={t('Chat.Actions')}
          accessibilityRole="button"
          testID={testIdWithKey(ChatIds.actionsButton)}
        />
      )}
      actionSheetOptionTintColor={theme.optionsText}
    />
  ) : null
}
