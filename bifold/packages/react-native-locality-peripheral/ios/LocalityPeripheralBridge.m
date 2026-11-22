#import "LocalityPeripheralBridge.h"

/**
 * Declares `LocalityPeripheral.swift`'s `@objc` surface to React Native.
 *
 * The selectors below must match the Swift `@objc(...)` annotations exactly —
 * a mismatch is not a compile error in either language, it is an
 * "unrecognized selector" crash the first time JS calls the method. The
 * three here mirror `NativeLocalityPeripheral.ts`'s `Spec` one for one.
 */
@interface RCT_EXTERN_MODULE (LocalityPeripheral, NSObject)

RCT_EXTERN_METHOD(isSupported
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(respondToSensor
                  : (NSDictionary *)params resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopAdvertising
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

@end
