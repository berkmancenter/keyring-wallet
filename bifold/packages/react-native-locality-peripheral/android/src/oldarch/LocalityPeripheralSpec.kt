package com.localityperipheral

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap

abstract class LocalityPeripheralSpec internal constructor(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  abstract fun isSupported(promise: Promise)
  abstract fun respondToSensor(params: ReadableMap, promise: Promise)
  abstract fun stopAdvertising(promise: Promise)
}
