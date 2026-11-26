require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-locality-peripheral"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = { "Keyring" => "https://github.com/berkmancenter/keyring-bifold" }

  # App Attest is iOS 14+, and without it this module can advertise but never
  # produce a signature the witness would accept — so 14.0 is the real floor,
  # not CoreBluetooth's much older one.
  s.platforms    = { :ios => "14.0" }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }
  s.requires_arc = true

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  # Exposes the React promise typedefs to the Swift side — see the header's
  # own comment for why this is load-bearing rather than cosmetic.
  s.public_header_files = "ios/LocalityPeripheralBridge.h"
  s.swift_version = "5.0"

  s.frameworks = "CoreBluetooth", "DeviceCheck", "LocalAuthentication", "CryptoKit"

  # Same arrangement as react-native-attestation's podspec: the new-arch
  # helper when it exists, a plain React-Core dependency otherwise. This
  # module is a legacy-style bridge module (RCT_EXTERN_MODULE) either way,
  # reaching the new architecture through RN's interop layer — the Android
  # side has real TurboModule codegen, iOS deliberately does not, because a
  # Swift TurboModule needs a C++ shim that buys nothing here.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
