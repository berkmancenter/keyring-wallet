import React from 'react'
import { View } from 'react-native'
import { Composer, InputToolbar, Send } from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

export const renderInputToolbar = (props: any, _theme: any) => (
  <InputToolbar
    {...props}
    containerStyle={{
      backgroundColor: '#F5F5F5', // Match chat background
      borderTopWidth: 0,
      paddingHorizontal: 12,
      paddingVertical: 8,
    }}
    primaryStyle={{
      backgroundColor: 'white',
      borderRadius: 24,
      borderWidth: 1,
      borderColor: '#E0E0E0',
      paddingHorizontal: 4,
      marginHorizontal: 0,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
      alignItems: 'center',
    }}
  />
)

export const renderComposer = (props: any, theme: any, placeholder: string, disabled?: boolean) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
    <Icon
      name="message-text-outline"
      size={22}
      color="#888888"
      style={{ marginLeft: 12, marginRight: 4 }}
    />
  {/*
    * Everything the TextInput needs goes through textInputProps, MERGED into
    * what gifted-chat passed down — never replacing it.
    *
    * gifted-chat v3's Composer destructures only ({ text, textInputProps }).
    * Top-level textInputStyle / placeholder / placeholderTextColor props are
    * v2 API and are silently ignored, and textInputProps carries two separate
    * things we must not drop:
    *
    *  - onChangeText and the input ref, the only path back to the controlled
    *    value={text}. Replacing the object left a controlled input with no
    *    change handler, so every keystroke reverted to '' and the keyboard
    *    re-asserted sentence capitalisation on the emptied field.
    *  - style, which Composer applies LAST and so is the only way to beat its
    *    own scheme-dependent default. That default is
    *    textInput_dark: { color: '#fff' }, and the toolbar above hardcodes a
    *    white background, so in dark mode the text was white on white —
    *    invisible but present (device 2026-08-26).
    */}
  <Composer
    {...props}
    textInputProps={{
      ...props.textInputProps,
      accessibilityLabel: '',
      maxFontSizeMultiplier: 1.2,
      editable: !disabled,
      placeholder,
      placeholderTextColor: '#888888',
      style: [
        {
          ...theme.inputText,
          marginLeft: 4,
          marginRight: 8,
          paddingTop: 8,
          paddingBottom: 8,
          lineHeight: 20,
          marginTop: 2,
          marginBottom: 2,
        },
        props.textInputProps?.style,
      ],
    }}
  />
  </View>
)

export const renderSend = (props: any, theme: any) => (
  <Send
    {...props}
    alwaysShowSend={true}
    disabled={!props.text}
    containerStyle={{
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 4,
      marginBottom: 0,
      height: 44,
      width: 44,
    }}
  >
    <View
      style={{
        backgroundColor: props.text ? theme.sendEnabled : '#E0E0E0',
        borderRadius: 20,
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Icon name="send" size={20} color="white" style={{ marginLeft: 2 }} />
    </View>
  </Send>
)
