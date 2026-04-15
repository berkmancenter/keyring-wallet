import React from 'react'
import { ToastShowParams } from 'react-native-toast-message'

import BaseToast, { ToastType } from './BaseToast'
import MessageNotificationToast from './MessageNotificationToast'

export const Config = {
  success: (props: ToastShowParams) => (
    <BaseToast title={props?.text1} body={props?.text2} toastType={ToastType.Success} />
  ),
  warn: (props: ToastShowParams) => (
    <BaseToast title={props?.text1} body={props?.text2} toastType={ToastType.Warn} onPress={props?.onPress} />
  ),
  error: (props: ToastShowParams) => (
    <BaseToast title={props?.text1} body={props?.text2} toastType={ToastType.Error} onPress={props?.onPress} />
  ),
  info: (props: ToastShowParams) => (
    <BaseToast title={props?.text1} body={props?.text2} toastType={ToastType.Info} onPress={props?.onPress} />
  ),
  message: (params: any) => (
    <MessageNotificationToast
      text1={params?.text1}
      text2={params?.text2}
      onPress={params?.onPress}
      props={params?.props}
    />
  ),
}

export default Config
