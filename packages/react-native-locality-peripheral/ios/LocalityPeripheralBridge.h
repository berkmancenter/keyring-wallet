/**
 * The ObjC face of `LocalityPeripheral.swift`.
 *
 * This header exists for one reason beyond declaring the module: importing
 * `RCTBridgeModule.h` here is what puts React Native's promise typedefs
 * (`RCTPromiseResolveBlock` / `RCTPromiseRejectBlock`) in front of the Swift
 * side, which cannot see them otherwise — a pod gets no bridging header, so
 * the ObjC types Swift needs have to arrive through the pod's own public
 * headers. Same arrangement `react-native-vision-camera`'s `CameraBridge.h`
 * uses, which is the working precedent in this app for a Swift RN module.
 *
 * Keep this listed in the podspec's `public_header_files`.
 */
#import <React/RCTBridgeModule.h>
