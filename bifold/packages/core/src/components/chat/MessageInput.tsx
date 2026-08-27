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
  <Composer
    {...props}
    textInputStyle={{
      ...theme.inputText,
        marginLeft: 4,
        marginRight: 8,
        paddingTop: 8,
        paddingBottom: 8,
        lineHeight: 20,
        marginTop: 2,
        marginBottom: 2,
    }}
    placeholder={placeholder}
      placeholderTextColor="#888888"
    // MERGE, never replace. gifted-chat's TextInput is fully controlled
    // (value={text}), and the wiring that feeds that state back — onChangeText
    // and the input ref — is handed down inside textInputProps itself. An
    // object literal here lands after {...props} and so replaced it wholesale,
    // leaving a controlled input with no change handler: every keystroke was
    // reverted to '', and the keyboard re-asserted sentence capitalisation on
    // the now-empty field. The composer had been unusable for as long as this
    // has been here; it only became visible once the keyboard stopped covering
    // it (device trace 2026-08-26 — Composer text="" on every render, with no
    // remount).
    textInputProps={{
      ...props.textInputProps,
      accessibilityLabel: '',
      maxFontSizeMultiplier: 1.2,
      editable: !disabled,
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
