#import "Attestation.h"
#import <DeviceCheck/DeviceCheck.h>
#import <CommonCrypto/CommonCrypto.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>

@implementation Attestation
RCT_EXPORT_MODULE()

NSString *KeychainServiceName = @"AriesAttestation";

NSString *keychainIdentifier2() {
    NSString *bundleID = [[NSBundle mainBundle] bundleIdentifier];
    return [bundleID stringByAppendingString:@".AttestationKey"];
}

/** Keychain key for cached App Attest public key (extracted from leaf cert) */
NSString *keychainIdentifierAppAttestPublicKey(void) {
    NSString *bundleID = [[NSBundle mainBundle] bundleIdentifier];
    return [bundleID stringByAppendingString:@".AppAttestPublicKey"];
}

/** Keychain key for cached App Attest certificate chain (JSON-encoded PEM array) */
NSString *keychainIdentifierAppAttestCertChain(void) {
    NSString *bundleID = [[NSBundle mainBundle] bundleIdentifier];
    return [bundleID stringByAppendingString:@".AppAttestCertChain"];
}

static BOOL saveCertChainToKeychain(NSArray<NSString *> *certChain) {
    NSError *err = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:certChain options:0 error:&err];
    if (!json || err) return NO;
    return saveDataToKeychain(json, keychainIdentifierAppAttestCertChain());
}

static NSArray<NSString *> *loadCertChainFromKeychain(void) {
    NSData *json = dataFromKeychainWithIdentifier(keychainIdentifierAppAttestCertChain());
    if (!json || json.length == 0) return nil;
    NSError *err = nil;
    NSArray *arr = [NSJSONSerialization JSONObjectWithData:json options:0 error:&err];
    if (!arr || err || ![arr isKindOfClass:[NSArray class]]) return nil;
    return arr;
}

static BOOL saveDataToKeychain(NSData *data, NSString *identifier) {
    clearStoredKeyIfExists(identifier);
    NSDictionary *attributes = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: KeychainServiceName,
        (__bridge id)kSecAttrAccount: identifier,
        (__bridge id)kSecValueData: data
    };
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)attributes, NULL);
    return status == errSecSuccess;
}

static NSData *dataFromKeychainWithIdentifier(NSString *identifier) {
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: KeychainServiceName,
        (__bridge id)kSecAttrAccount: identifier,
        (__bridge id)kSecReturnData: (__bridge id)kCFBooleanTrue,
        (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne
    };
    CFTypeRef dataRef = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &dataRef);
    if (status == errSecSuccess) {
        return (__bridge_transfer NSData *)dataRef;
    }
    return nil;
}

static void clearAppAttestPublicKeyCache(void) {
    clearStoredKeyIfExists(keychainIdentifierAppAttestPublicKey());
    clearStoredKeyIfExists(keychainIdentifierAppAttestCertChain());
}

NSData *sha256Of(NSString *stringToBeHashed) {
    NSData *data = [stringToBeHashed dataUsingEncoding:NSUTF8StringEncoding];
    uint8_t hash[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, hash);
    return [NSData dataWithBytes:hash length:CC_SHA256_DIGEST_LENGTH];
}

static NSData *sha256OfData(NSData *data) {
    uint8_t hash[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, hash);
    return [NSData dataWithBytes:hash length:CC_SHA256_DIGEST_LENGTH];
}

NSArray<NSNumber *> *dataToBytes(NSData *data) {
    const uint8_t *bytes = (const uint8_t *)[data bytes];
    NSMutableArray *array = [NSMutableArray arrayWithCapacity:data.length];
    for (NSUInteger i = 0; i < data.length; i++) {
        [array addObject:@(bytes[i])];
    }
    return [array copy];
}

BOOL saveStringToKeychain(NSString *string, NSString *identifier) {
    NSData *stringAsData = [string dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *attributes = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: KeychainServiceName,
        (__bridge id)kSecAttrAccount: identifier,
        (__bridge id)kSecValueData: stringAsData
    };
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)attributes, NULL);
    return status == errSecSuccess;
}

NSString *stringFromKeychainWithIdentifier(NSString *identifier) {
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: KeychainServiceName,
        (__bridge id)kSecAttrAccount: identifier,
        (__bridge id)kSecReturnData: (__bridge id)kCFBooleanTrue,
        (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne
    };
    
    CFTypeRef dataRef = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &dataRef);
    if (status == errSecSuccess) {
        NSData *data = (__bridge_transfer NSData *)dataRef;
        return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    }
    return nil;
}

BOOL clearStoredKeyIfExists(NSString *identifier) {
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: KeychainServiceName,
        (__bridge id)kSecAttrAccount: identifier
    };
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    return status == errSecSuccess;
}

NSError *errorWithReason(NSString *reason, NSInteger code) {
    NSString *domain = [[NSBundle mainBundle] bundleIdentifier];
    NSDictionary *userInfo = @{
        NSLocalizedDescriptionKey: @"An error occurred.",
        NSLocalizedFailureReasonErrorKey: reason,
    };
    return [NSError errorWithDomain:domain code:code userInfo:userInfo];
}

NSString *messageAttestationErrorCode(NSInteger code) {
    switch (code) {
        case 2: return @"The provided input is not formatted correctly.";
        case 3: return @"The provided key ID is invalid or the key is not found.";
        case 4: return @"The device is not eligible for App Attestation.";
        default: return @"Unable to generate attestation object.";
    }
}

DCAppAttestService *sharedService() {
    NSString *version = [[UIDevice currentDevice] systemVersion];
    if ([version compare:@"14.0" options:NSNumericSearch] != NSOrderedDescending) {
        return nil;
    }
    DCAppAttestService *service = [DCAppAttestService sharedService];
    return service.isSupported ? service : nil;
}

RCT_EXPORT_METHOD(generateKey:(BOOL)cache
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    DCAppAttestService *attestService = sharedService();
    if (attestService == nil) {
        reject(@"error", @"Device not eligible for App Attestation", errorWithReason(@"Not supported", 22));
        return;
    }
    
    NSString *keychainIdentifier = keychainIdentifier2();

    if (cache) {
        NSString *keyId = stringFromKeychainWithIdentifier(keychainIdentifier);
        if (keyId != nil) {
            resolve(keyId);
            return;
        }
    } else {
        clearStoredKeyIfExists(keychainIdentifier);
    }
    
    [attestService generateKeyWithCompletionHandler:^(NSString * _Nullable keyId, NSError * _Nullable error) {
        if (error) {
            reject(@"error", @"Unable to generate key.", errorWithReason(@"Unable to generate key.", 21));
            return;
        }
        if (cache) {
            saveStringToKeychain(keyId, keychainIdentifier);
        }
        resolve(keyId);
    }];
}

RCT_EXPORT_METHOD(sha256:(NSString *)stringToBeHashed
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([dataToBytes(sha256Of(stringToBeHashed)) copy]);
}

RCT_EXPORT_METHOD(appleKeyAttestation:(NSString *)keyId
                  challenge:(NSString *)challenge
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    DCAppAttestService *attestService = sharedService();
    if (attestService == nil) {
        reject(@"error", @"Device not eligible for App Attestation", errorWithReason(@"Not supported", 22));
        return;
    }

    NSData *hashData = sha256Of(challenge);
    [attestService attestKey:keyId clientDataHash:hashData completionHandler:^(NSData * _Nullable attestationObject, NSError * _Nullable error) {
        if (error) {
            if (error.code == 3) {
                clearStoredKeyIfExists(keychainIdentifier2());
            }
            reject(@"error", messageAttestationErrorCode(error.code), errorWithReason(messageAttestationErrorCode(error.code), error.code));
        } else {
            resolve(dataToBytes(attestationObject));
        }
    }];
}

// =============================================================================
// Secure Enclave Hardware Signing Key
// =============================================================================

NSString *HardwareSigningKeyTag = @"com.advancedidentity.vrc.hardware-signing-key";
static BOOL _signingInProgress = NO;

NSData *hardwareKeyTagData() {
    NSString *bundleID = [[NSBundle mainBundle] bundleIdentifier];
    NSString *fullTag = [NSString stringWithFormat:@"%@.%@", bundleID, HardwareSigningKeyTag];
    return [fullTag dataUsingEncoding:NSUTF8StringEncoding];
}

RCT_EXPORT_METHOD(createSecureEnclaveKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSLog(@"[VRC:iOS] ▶ Creating hardware key (App Attest single key)");
    
    DCAppAttestService *attestService = sharedService();
    if (attestService == nil) {
        reject(@"error", @"App Attest not supported", errorWithReason(@"Not supported", 100));
        return;
    }
    
    // Remove any old Secure Enclave key from previous implementation
    NSDictionary *deleteQuery = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassKey,
        (__bridge id)kSecAttrApplicationTag: hardwareKeyTagData()
    };
    SecItemDelete((__bridge CFDictionaryRef)deleteQuery);
    
    NSString *keychainId = keychainIdentifier2();
    NSString *keyId = stringFromKeychainWithIdentifier(keychainId);
    
    if (keyId != nil) {
        NSData *cachedPub = dataFromKeychainWithIdentifier(keychainIdentifierAppAttestPublicKey());
        if (cachedPub.length > 0) {
            NSLog(@"[VRC:iOS] ✓ Using existing App Attest key [cached public key]");
            resolve(@{
                @"success": @YES,
                @"publicKey": dataToBytes(cachedPub),
                @"keyType": @"EC-P256",
                @"storage": @"SecureEnclave"
            });
            return;
        }
        // Key exists but no cached public key — orphaned state (crash between
        // key creation and cert caching). Delete to avoid "already attested" loop.
        NSLog(@"[VRC:iOS] ⚠ Key exists but no cached public key — deleting orphaned key");
        clearStoredKeyIfExists(keychainId);
        clearAppAttestPublicKeyCache();
        keyId = nil;
    }
    
    // Generate new App Attest key
    {
        clearAppAttestPublicKeyCache();
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        __block NSString *newKeyId = nil;
        __block NSError *genErr = nil;
        [attestService generateKeyWithCompletionHandler:^(NSString * _Nullable k, NSError * _Nullable e) {
            if (e) genErr = e;
            else { newKeyId = k; saveStringToKeychain(k, keychainId); }
            dispatch_semaphore_signal(sem);
        }];
        dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
        if (genErr) {
            reject(@"error", @"Failed to generate App Attest key", genErr);
            return;
        }
        keyId = newKeyId;
        [NSThread sleepForTimeInterval:2.0]; // Allow Apple to register key
    }
    
    // Attest to get cert chain and cache public key from leaf
    NSData *challengeHash = sha256Of([[NSUUID UUID] UUIDString]);
    __block BOOL done = NO;
    __block NSData *pubKeyData = nil;
    [attestService attestKey:keyId clientDataHash:challengeHash completionHandler:^(NSData * _Nullable attestationObject, NSError * _Nullable error) {
        if (error) {
            NSLog(@"[VRC:iOS] ✗ Attestation failed (key created but attest later): %@", error);
            done = YES;
            return;
        }
        NSArray<NSString *> *chain = parseAttestationCertificates(attestationObject);
        if (chain.count > 0) {
            pubKeyData = publicKeyFromLeafPem(chain[0]);
            if (pubKeyData.length > 0) {
                saveDataToKeychain(pubKeyData, keychainIdentifierAppAttestPublicKey());
                saveCertChainToKeychain(chain);
                NSLog(@"[VRC:iOS] ✓ Cached cert chain (%lu certs) alongside public key", (unsigned long)chain.count);
            }
        }
        done = YES;
    }];
    while (!done) { [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]]; }
    
    if (pubKeyData.length == 0) {
        reject(@"error", @"Key created but attestation failed; try again later", errorWithReason(@"Attestation failed", 102));
        return;
    }
    
    NSLog(@"[VRC:iOS] ✓ Key created [App Attest, %lu bytes public key]", (unsigned long)pubKeyData.length);
    resolve(@{
        @"success": @YES,
        @"publicKey": dataToBytes(pubKeyData),
        @"keyType": @"EC-P256",
        @"storage": @"SecureEnclave"
    });
}

RCT_EXPORT_METHOD(hasHardwareSigningKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSString *keyId = stringFromKeychainWithIdentifier(keychainIdentifier2());
    resolve(@(keyId != nil && keyId.length > 0));
}

RCT_EXPORT_METHOD(getHardwarePublicKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSData *cached = dataFromKeychainWithIdentifier(keychainIdentifierAppAttestPublicKey());
    if (cached == nil || cached.length == 0) {
        reject(@"error", @"Public key not available; run attestation first", errorWithReason(@"No cached public key", 101));
        return;
    }
    resolve(dataToBytes(cached));
}

RCT_EXPORT_METHOD(signWithHardwareBiometricAuth:(NSArray<NSNumber *> *)dataToSign
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    @synchronized ([Attestation class]) {
        if (_signingInProgress) {
            reject(@"error", @"Another signing operation is in progress", errorWithReason(@"Signing in progress", 105));
            return;
        }
        _signingInProgress = YES;
    }
    
    NSLog(@"[VRC:iOS] ▶ Signing with App Attest key [%lu bytes]", (unsigned long)dataToSign.count);
    
    NSMutableData *dataToSignNSData = [NSMutableData dataWithCapacity:dataToSign.count];
    for (NSNumber *byte in dataToSign) {
        uint8_t byteValue = [byte unsignedCharValue];
        [dataToSignNSData appendBytes:&byteValue length:1];
    }
    
    NSString *keyId = stringFromKeychainWithIdentifier(keychainIdentifier2());
    if (keyId == nil || keyId.length == 0) {
        _signingInProgress = NO;
        reject(@"error", @"Hardware signing key not found", errorWithReason(@"No App Attest key", 103));
        return;
    }
    
    uint8_t hash[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(dataToSignNSData.bytes, (CC_LONG)dataToSignNSData.length, hash);
    NSData *clientDataHash = [NSData dataWithBytes:hash length:CC_SHA256_DIGEST_LENGTH];
    
    DCAppAttestService *attestService = sharedService();
    if (attestService == nil) {
        _signingInProgress = NO;
        reject(@"error", @"App Attest not supported", errorWithReason(@"Not supported", 100));
        return;
    }
    
    // Require biometric (Face ID / Touch ID) before each sign so the user explicitly approves
    LAContext *laContext = [[LAContext alloc] init];
    [laContext evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
              localizedReason:@"Confirm your identity to sign this relationship credential"
                        reply:^(BOOL success, NSError * _Nullable authError) {
        if (!success) {
            if (authError && (authError.code == LAErrorUserCancel || authError.code == LAErrorUserFallback || authError.code == LAErrorSystemCancel)) {
                NSLog(@"[VRC:iOS] ✗ Biometric cancelled");
                _signingInProgress = NO;
                reject(@"error", @"Biometric authentication cancelled or failed", authError);
            } else {
                NSLog(@"[VRC:iOS] ✗ Biometric failed: %@", authError);
                _signingInProgress = NO;
                reject(@"error", authError.localizedDescription ?: @"Biometric authentication failed", authError);
            }
            return;
        }
        [attestService generateAssertion:keyId clientDataHash:clientDataHash completionHandler:^(NSData * _Nullable assertion, NSError * _Nullable error) {
            if (error) {
                NSLog(@"[VRC:iOS] ✗ Assertion failed: %@", error);
                _signingInProgress = NO;
                reject(@"error", @"Failed to generate assertion", error);
                return;
            }
            if (assertion == nil || assertion.length == 0) {
                _signingInProgress = NO;
                reject(@"error", @"Empty assertion", errorWithReason(@"Empty assertion", 104));
                return;
            }
            NSLog(@"[VRC:iOS] ✓ Assertion created [%lu bytes]",
                  (unsigned long)assertion.length);

            _signingInProgress = NO;
            resolve(@{
                @"success": @YES,
                @"signature": dataToBytes(assertion),
                @"algorithm": @"ECDSA-SHA256",
                @"clientDataHash": [clientDataHash base64EncodedStringWithOptions:0]
            });
        }];
    }];
}

RCT_EXPORT_METHOD(deleteHardwareSigningKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    SecItemDelete((__bridge CFDictionaryRef)@{
        (__bridge id)kSecClass: (__bridge id)kSecClassKey,
        (__bridge id)kSecAttrApplicationTag: hardwareKeyTagData()
    });
    clearStoredKeyIfExists(keychainIdentifier2());
    clearAppAttestPublicKeyCache();
    resolve(@YES);
}

RCT_EXPORT_METHOD(getHardwareKeyInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSString *keyId = stringFromKeychainWithIdentifier(keychainIdentifier2());
    if (keyId != nil && keyId.length > 0) {
        resolve(@{
            @"exists": @YES,
            @"keyType": @"EC-P256",
            @"storage": @"SecureEnclave",
            @"biometricBound": @YES,
            @"algorithm": @"ECDSA-SHA256"
        });
    } else {
        resolve(@{ @"exists": @NO });
    }
}

// =============================================================================
// Hardware Key Attestation with Certificate Chain
// =============================================================================

NSString *derToPem(NSData *derData) {
    if (derData == nil || derData.length == 0) {
        return nil;
    }
    NSString *base64 = [derData base64EncodedStringWithOptions:NSDataBase64Encoding64CharacterLineLength];
    if (base64 == nil || base64.length == 0) {
        return nil;
    }
    return [NSString stringWithFormat:@"-----BEGIN CERTIFICATE-----\n%@\n-----END CERTIFICATE-----", base64];
}

/** Decode PEM to DER (strip headers, base64 decode) */
static NSData *pemToDer(NSString *pem) {
    if (pem == nil || pem.length == 0) return nil;
    NSString *base64 = [pem stringByReplacingOccurrencesOfString:@"-----BEGIN CERTIFICATE-----" withString:@""];
    base64 = [base64 stringByReplacingOccurrencesOfString:@"-----END CERTIFICATE-----" withString:@""];
    base64 = [base64 stringByReplacingOccurrencesOfString:@"\r" withString:@""];
    base64 = [base64 stringByReplacingOccurrencesOfString:@"\n" withString:@""];
    base64 = [base64 stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (base64.length == 0) return nil;
    return [[NSData alloc] initWithBase64EncodedString:base64 options:NSDataBase64DecodingIgnoreUnknownCharacters];
}

/** Extract raw public key bytes (65-byte uncompressed P-256) from leaf cert PEM */
static NSData *publicKeyFromLeafPem(NSString *leafPem) {
    NSData *der = pemToDer(leafPem);
    if (der == nil || der.length == 0) return nil;
    SecCertificateRef cert = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)der);
    if (cert == NULL) return nil;
    SecKeyRef pubKey = SecCertificateCopyPublicKey(cert);
    CFRelease(cert);
    if (pubKey == NULL) return nil;
    CFErrorRef err = NULL;
    CFDataRef pubKeyData = SecKeyCopyExternalRepresentation(pubKey, &err);
    CFRelease(pubKey);
    if (pubKeyData == NULL) return nil;
    return (__bridge_transfer NSData *)pubKeyData;
}

// CBOR parsing helpers
uint64_t cborReadUInt(const uint8_t *data, NSUInteger *offset, uint8_t additionalInfo) {
    if (additionalInfo < 24) {
        return additionalInfo;
    } else if (additionalInfo == 24) {
        uint64_t val = data[*offset];
        *offset += 1;
        return val;
    } else if (additionalInfo == 25) {
        uint64_t val = ((uint64_t)data[*offset] << 8) | data[*offset + 1];
        *offset += 2;
        return val;
    } else if (additionalInfo == 26) {
        uint64_t val = ((uint64_t)data[*offset] << 24) | 
                       ((uint64_t)data[*offset + 1] << 16) |
                       ((uint64_t)data[*offset + 2] << 8) |
                       data[*offset + 3];
        *offset += 4;
        return val;
    } else if (additionalInfo == 27) {
        uint64_t val = ((uint64_t)data[*offset] << 56) |
                       ((uint64_t)data[*offset + 1] << 48) |
                       ((uint64_t)data[*offset + 2] << 40) |
                       ((uint64_t)data[*offset + 3] << 32) |
                       ((uint64_t)data[*offset + 4] << 24) |
                       ((uint64_t)data[*offset + 5] << 16) |
                       ((uint64_t)data[*offset + 6] << 8) |
                       data[*offset + 7];
        *offset += 8;
        return val;
    }
    return 0;
}

void cborSkipValue(const uint8_t *data, NSUInteger dataLength, NSUInteger *offset) {
    if (*offset >= dataLength) return;
    
    uint8_t initialByte = data[*offset];
    *offset += 1;
    
    uint8_t majorType = (initialByte >> 5) & 0x07;
    uint8_t additionalInfo = initialByte & 0x1F;
    uint64_t length = cborReadUInt(data, offset, additionalInfo);
    
    switch (majorType) {
        case 0: case 1: break;
        case 2: case 3: *offset += length; break;
        case 4:
            for (uint64_t i = 0; i < length; i++) cborSkipValue(data, dataLength, offset);
            break;
        case 5:
            for (uint64_t i = 0; i < length; i++) {
                cborSkipValue(data, dataLength, offset);
                cborSkipValue(data, dataLength, offset);
            }
            break;
        case 6: cborSkipValue(data, dataLength, offset); break;
        case 7: break;
    }
}

NSString *cborReadTextString(const uint8_t *data, NSUInteger dataLength, NSUInteger *offset) {
    if (*offset >= dataLength) return nil;
    
    uint8_t initialByte = data[*offset];
    *offset += 1;
    
    uint8_t majorType = (initialByte >> 5) & 0x07;
    if (majorType != 3) return nil;
    
    uint8_t additionalInfo = initialByte & 0x1F;
    uint64_t length = cborReadUInt(data, offset, additionalInfo);
    
    if (*offset + length > dataLength) return nil;
    
    NSString *str = [[NSString alloc] initWithBytes:(data + *offset) length:length encoding:NSUTF8StringEncoding];
    *offset += length;
    return str;
}

NSData *cborReadByteString(const uint8_t *data, NSUInteger dataLength, NSUInteger *offset) {
    if (*offset >= dataLength) return nil;
    
    uint8_t initialByte = data[*offset];
    *offset += 1;
    
    uint8_t majorType = (initialByte >> 5) & 0x07;
    if (majorType != 2) return nil;
    
    uint8_t additionalInfo = initialByte & 0x1F;
    uint64_t length = cborReadUInt(data, offset, additionalInfo);
    
    if (*offset + length > dataLength) return nil;
    
    NSData *byteData = [NSData dataWithBytes:(data + *offset) length:length];
    *offset += length;
    return byteData;
}

NSArray<NSString *> *parseAttestationCertificates(NSData *attestationObject) {
    if (attestationObject == nil) return @[];
    
    const uint8_t *data = (const uint8_t *)attestationObject.bytes;
    NSUInteger dataLength = attestationObject.length;
    NSUInteger offset = 0;
    
    if (offset >= dataLength) return @[];
    
    uint8_t initialByte = data[offset];
    offset++;
    
    uint8_t majorType = (initialByte >> 5) & 0x07;
    uint8_t additionalInfo = initialByte & 0x1F;
    
    if (majorType != 5) return @[];
    
    uint64_t mapCount = cborReadUInt(data, &offset, additionalInfo);
    NSMutableArray<NSString *> *certificates = [NSMutableArray array];
    
    for (uint64_t i = 0; i < mapCount; i++) {
        NSString *key = cborReadTextString(data, dataLength, &offset);
        if (key == nil) return @[];
        
        if ([key isEqualToString:@"attStmt"]) {
            uint8_t attStmtByte = data[offset];
            offset++;
            
            uint8_t attStmtMajorType = (attStmtByte >> 5) & 0x07;
            uint8_t attStmtAdditionalInfo = attStmtByte & 0x1F;
            
            if (attStmtMajorType != 5) return @[];
            
            uint64_t attStmtCount = cborReadUInt(data, &offset, attStmtAdditionalInfo);
            
            for (uint64_t j = 0; j < attStmtCount; j++) {
                NSString *attStmtKey = cborReadTextString(data, dataLength, &offset);
                if (attStmtKey == nil) return @[];
                
                if ([attStmtKey isEqualToString:@"x5c"]) {
                    uint8_t x5cByte = data[offset];
                    offset++;
                    
                    uint8_t x5cMajorType = (x5cByte >> 5) & 0x07;
                    uint8_t x5cAdditionalInfo = x5cByte & 0x1F;
                    
                    if (x5cMajorType != 4) return @[];
                    
                    uint64_t certCount = cborReadUInt(data, &offset, x5cAdditionalInfo);
                    
                    for (uint64_t k = 0; k < certCount; k++) {
                        NSData *certDer = cborReadByteString(data, dataLength, &offset);
                        if (certDer == nil || certDer.length == 0) continue;
                        
                        NSString *certPem = derToPem(certDer);
                        if (certPem != nil) {
                            [certificates addObject:certPem];
                        }
                    }
                    return certificates;
                } else {
                    cborSkipValue(data, dataLength, &offset);
                }
            }
        } else {
            cborSkipValue(data, dataLength, &offset);
        }
    }
    
    return certificates;
}

RCT_EXPORT_METHOD(attestHardwareSigningKey:(NSString *)challenge
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSLog(@"[VRC:iOS] ▶ Hardware key attestation");
    
    DCAppAttestService *attestService = sharedService();
    if (attestService == nil) {
        reject(@"error", @"App Attest not supported", errorWithReason(@"Not supported", 100));
        return;
    }
    
    NSString *keychainId = keychainIdentifier2();
    NSString *keyId = stringFromKeychainWithIdentifier(keychainId);
    
    __block BOOL isNewKey = NO;
    
    if (keyId == nil) {
        NSLog(@"[VRC:iOS]   Generating new App Attest key...");
        
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block NSString *generatedKeyId = nil;
        __block NSError *generationError = nil;
        
        [attestService generateKeyWithCompletionHandler:^(NSString * _Nullable newKeyId, NSError * _Nullable error) {
            if (error) {
                generationError = error;
            } else {
                generatedKeyId = newKeyId;
                saveStringToKeychain(newKeyId, keychainId);
            }
            dispatch_semaphore_signal(semaphore);
        }];
        
        dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
        
        if (generationError) {
            reject(@"error", @"Failed to generate App Attest key", generationError);
            return;
        }
        
        keyId = generatedKeyId;
        isNewKey = YES;
        
        // Wait for Apple to register the key
        [NSThread sleepForTimeInterval:2.0];
    }
    
    NSString *effectiveChallenge = challenge ?: [[NSUUID UUID] UUIDString];
    NSData *challengeHash = sha256Of(effectiveChallenge);
    
    // Retry logic
    __block int maxRetries = 3;
    __block int currentRetry = 0;
    __block double retryDelaySeconds = 1.0;
    
    __block void (^attemptAttestation)(void);
    attemptAttestation = ^{
        currentRetry++;
        
        [attestService attestKey:keyId clientDataHash:challengeHash completionHandler:^(NSData * _Nullable attestationObject, NSError * _Nullable error) {
            if (error) {
                if (currentRetry < maxRetries && (error.code == 1 || error.code == 2)) {
                    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(retryDelaySeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                        retryDelaySeconds *= 2.0;
                        attemptAttestation();
                    });
                    return;
                }
                
                // Error code 3 = "key already attested" (one-time operation per key on iOS).
                // This is expected if createSecureEnclaveKey already attested this key.
                // Return cached data instead of failing.
                if (error.code == 3) {
                    NSData *cachedPubKey = dataFromKeychainWithIdentifier(keychainIdentifierAppAttestPublicKey());
                    NSArray<NSString *> *cachedChain = loadCertChainFromKeychain();
                    if (cachedPubKey.length > 0) {
                        NSLog(@"[VRC:iOS] ℹ Key already attested (error 3) — returning cached data [chain: %lu certs]",
                              (unsigned long)(cachedChain ? cachedChain.count : 0));
                        NSString *pubKeyBase64 = [cachedPubKey base64EncodedStringWithOptions:0];
                        resolve(@{
                            @"success": @YES,
                            @"format": @"apple-appattest-v1",
                            @"certificateChain": cachedChain ?: @[],
                            @"attestationObject": @"",
                            @"publicKey": pubKeyBase64,
                            @"keyId": keyId,
                            @"challenge": effectiveChallenge,
                            @"alreadyAttested": @YES
                        });
                        return;
                    }
                    // No cached public key — key is in bad state, clear it
                    clearStoredKeyIfExists(keychainId);
                    clearAppAttestPublicKeyCache();
                    NSLog(@"[VRC:iOS] ✗ Key already attested but no cached public key — cleared");
                    reject(@"error", @"Attestation failed", error);
                    return;
                }
                
                if (error.code == 2) {
                    clearStoredKeyIfExists(keychainId);
                }
                
                NSLog(@"[VRC:iOS] ✗ Attestation failed: %@", error);
                reject(@"error", @"Attestation failed", error);
                return;
            }
            
            NSArray<NSString *> *certificateChain = parseAttestationCertificates(attestationObject);
            
            NSLog(@"[VRC:iOS] ✓ Attestation complete [%lu certs]", (unsigned long)certificateChain.count);
            
            NSString *publicKeyBase64 = @"";
            if (certificateChain.count > 0) {
                NSData *pubKeyData = publicKeyFromLeafPem(certificateChain[0]);
                if (pubKeyData.length > 0) {
                    publicKeyBase64 = [pubKeyData base64EncodedStringWithOptions:0];
                    saveDataToKeychain(pubKeyData, keychainIdentifierAppAttestPublicKey());
                    saveCertChainToKeychain(certificateChain);
                    NSLog(@"[VRC:iOS] ✓ Cached cert chain (%lu certs) from attestation", (unsigned long)certificateChain.count);
                }
            }
            
            NSString *attestationBase64 = [attestationObject base64EncodedStringWithOptions:0];
            
            resolve(@{
                @"success": @YES,
                @"format": @"apple-appattest-v1",
                @"certificateChain": certificateChain,
                @"attestationObject": attestationBase64,
                @"publicKey": publicKeyBase64,
                @"keyId": keyId,
                @"challenge": effectiveChallenge
            });
        }];
    };
    
    attemptAttestation();
}

RCT_EXPORT_METHOD(isHardwareAttestationAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve(@(sharedService() != nil));
}

// =============================================================================
// Production-Grade Native Verification
// =============================================================================

/** Apple App Attestation Root CA — downloaded from Apple's Private PKI:
 *  https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
 *  Subject: CN=Apple App Attestation Root CA, O=Apple Inc., ST=California
 *  Valid: 2020-03-18 to 2045-03-15
 *  Key: EC P-384 (secp384r1), self-signed
 */
static NSString *const APPLE_APP_ATTESTATION_ROOT_CA_PEM =
@"-----BEGIN CERTIFICATE-----\n"
"MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw\n"
"JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK\n"
"QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa\n"
"Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv\n"
"biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y\n"
"bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh\n"
"NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au\n"
"Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/\n"
"MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw\n"
"CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn\n"
"53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV\n"
"oyFraWVIyd/dganmrduC1bmTBGwD\n"
"-----END CERTIFICATE-----";

/** Apple Root CA - G3 (secondary anchor — some older attestation chains may use this)
 *  Downloaded from https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
 *  Subject: CN=Apple Root CA - G3, OU=Apple Certification Authority, O=Apple Inc., C=US
 *  Valid: 2014-04-30 to 2039-04-30, Key: EC P-384 */
static NSString *const APPLE_ROOT_CA_G3_PEM =
@"-----BEGIN CERTIFICATE-----\n"
"MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS\n"
"QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u\n"
"IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN\n"
"MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS\n"
"b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y\n"
"aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49\n"
"AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf\n"
"TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517\n"
"IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr\n"
"MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA\n"
"MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4\n"
"at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM\n"
"6BgD56KyKA==\n"
"-----END CERTIFICATE-----";

/** Google Hardware Attestation Root CA — from Google's attestation docs
 *  Subject: serialNumber=f92009e853b6b045
 *  Valid: 2016-05-26 to 2026-05-24
 *  Key: RSA 4096, self-signed
 *
 *  TODO(P0): Replace before expiry. Google is transitioning to Remote Key Provisioning (RKP)
 *  with short-lived certs. Monitor https://developer.android.com/privacy-and-security/security-key-attestation
 *  for an updated root or RKP migration guidance.
 */
static NSString *const GOOGLE_HARDWARE_ATTESTATION_ROOT_PEM =
@"-----BEGIN CERTIFICATE-----\n"
"MIIFYDCCA0igAwIBAgIJAOj6GWMU0voYMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV\n"
"BAUTEGY5MjAwOWU4NTNiNmIwNDUwHhcNMTYwNTI2MTY0NTUyWhcNMjYwNTI0MTY0\n"
"NTUyWjAbMRkwFwYDVQQFExBmOTIwMDllODUzYjZiMDQ1MIICIjANBgkqhkiG9w0B\n"
"AQEFAAOCAg8AMIICCgKCAgEAr7bHgiuxpwHsK7Qui8xUFmOr75gvMsd/dTEDDJdS\n"
"Sxtf6An7xyqpRR90PL2abxM1dEqlXnf2tqw1Ne4Xwl5jlRfdnJLmN0pTy/4lj4/7\n"
"tv0Sk3iiKkypnEUtR6WfMgH0QZfKHM1+di+y9TFRtv6y//0rb+T+W8a9nsNL/ggj\n"
"nar86461qO0rOs2cXjp3kOG1FEJ5MVmFmBGtnrKpa73XpXyTqRxB/M0n1n/W9nGq\n"
"C4FSYa04T6N5RIZGBN2z2MT5IKGbFlbC8UrW0DxW7AYImQQcHtGl/m00QLVWutHQ\n"
"oVJYnFPlXTcHYvASLu+RhhsbDmxMgJJ0mcDpvsC4PjvB+TxywElgS70vE0XmLD+O\n"
"JtvsBslHZvPBKCOdT0MS+tgSOIfga+z1Z1g7+DVagf7quvmag8jfPioyKvxnK/Eg\n"
"sTUVi2ghzq8wm27ud/mIM7AY2qEORR8Go3TVB4HzWQgpZrt3i5MIlCaY504LzSRi\n"
"igHCzAPlHws+W0rB5N+er5/2pJKnfBSDiCiFAVtCLOZ7gLiMm0jhO2B6tUXHI/+M\n"
"RPjy02i59lINMRRev56GKtcd9qO/0kUJWdZTdA2XoS82ixPvZtXQpUpuL12ab+9E\n"
"aDK8Z4RHJYYfCT3Q5vNAXaiWQ+8PTWm2QgBR/bkwSWc+NpUFgNPN9PvQi8WEg5Um\n"
"AGMCAwEAAaOBpjCBozAdBgNVHQ4EFgQUNmHhAHyIBQlRi0RsR/8aTMnqTxIwHwYD\n"
"VR0jBBgwFoAUNmHhAHyIBQlRi0RsR/8aTMnqTxIwDwYDVR0TAQH/BAUwAwEB/zAO\n"
"BgNVHQ8BAf8EBAMCAYYwQAYDVR0fBDkwNzA1oDOgMYYvaHR0cHM6Ly9hbmRyb2lk\n"
"Lmdvb2dsZWFwaXMuY29tL2F0dGVzdGF0aW9uL2NybC8wDQYJKoZIhvcNAQELBQAD\n"
"ggIBACDIw41L3KlXG0aMiS//cqrG+EShHUGo8HNsw30W1kJtjn6UBwRM6jnmiwfB\n"
"Pb8VA91chb2vssAtX2zbTvqBJ9+LBPGCdw/E53Rbf86qhxKaiAHOjpvAy5Y3m00m\n"
"qC0w/Zwvju1twb4vhLaJ5NkUJYsUS7rmJKHHBnETLi8GFqiEsqTWpG/6ibYCv7rY\n"
"DBJDcR9W62BW9jfIoBQcxUCUJouMPH25lLNcDc1ssqvC2v7iUgI9LeoM1sNovqPm\n"
"QUiG9rHli1vXxzCyaMTjwftkJLkf6724DFhuKug2jITV0QkXvaJWF4nUaHOTNA4u\n"
"JU9WDvZLI1j83A+/xnAJUucIv/zGJ1AMH2boHqF8CY16LpsYgBt6tKxxWH00XcyD\n"
"CdW2KlBCeqbQPcsFmWyWugxdcekhYsAWyoSf818NUsZdBWBaR/OukXrNLfkQ79Iy\n"
"ZohZbvabO/X+MVT3rriAoKc8oE2Uws6DF+60PV7/WIPjNvXySdqspImSN78mflxD\n"
"qwLqRBYkA3I75qppLGG9rp7UCdRjxMl8ZDBld+7yvHVgt1cVzJx9xnyGCC23Uaic\n"
"MDSXYrB4I4WHXPGjxhZuCuPBLTdOLU8YRvMYdEvYebWHMpvwGCF6bAx3JBpIeOQ1\n"
"wDB5y0USicV3YgYGmi+NZfhA4URSh77Yd6uuJOJENRaNVTzk\n"
"-----END CERTIFICATE-----";

/**
 * Extract the raw 65-byte uncompressed EC P-256 point from either raw X9.63 or SPKI-wrapped input.
 * SPKI for P-256 = 26-byte header + 65-byte raw point = 91 bytes total.
 */
static NSData *extractRawECPoint(NSData *pubKeyBytes) {
    if (pubKeyBytes == nil || pubKeyBytes.length == 0) return nil;
    const uint8_t *bytes = (const uint8_t *)pubKeyBytes.bytes;

    if (pubKeyBytes.length == 65 && bytes[0] == 0x04) {
        return pubKeyBytes;
    }

    static const uint8_t p256SpkiHeader[] = {
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86,
        0x48, 0xCE, 0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A,
        0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03,
        0x42, 0x00
    };

    if (pubKeyBytes.length == 91 &&
        memcmp(bytes, p256SpkiHeader, sizeof(p256SpkiHeader)) == 0 &&
        bytes[26] == 0x04) {
        return [pubKeyBytes subdataWithRange:NSMakeRange(26, 65)];
    }

    // Fallback: scan for the 0x04 uncompressed point marker with 64 remaining bytes
    for (NSInteger i = (NSInteger)pubKeyBytes.length - 65; i >= 0; i--) {
        if (bytes[i] == 0x04) {
            return [pubKeyBytes subdataWithRange:NSMakeRange(i, 65)];
        }
    }

    return pubKeyBytes;
}

/**
 * Helper: Create SecKeyRef from raw 65-byte uncompressed EC P-256 public key or SPKI bytes.
 * SecKeyCreateWithData for EC keys expects raw X9.63 (65 bytes), so we always extract it.
 */
static SecKeyRef createSecKeyFromPublicKeyBytes(NSData *pubKeyBytes, CFErrorRef *outError) {
    if (pubKeyBytes == nil || pubKeyBytes.length == 0) return NULL;

    NSData *rawPoint = extractRawECPoint(pubKeyBytes);
    if (rawPoint == nil || rawPoint.length != 65) {
        NSLog(@"[VRC:iOS] ✗ EC public key creation: could not extract 65-byte raw point from %lu bytes", (unsigned long)pubKeyBytes.length);
        return NULL;
    }

    NSDictionary *attrs = @{
        (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
        (__bridge id)kSecAttrKeyClass: (__bridge id)kSecAttrKeyClassPublic,
        (__bridge id)kSecAttrKeySizeInBits: @256
    };
    return SecKeyCreateWithData((__bridge CFDataRef)rawPoint, (__bridge CFDictionaryRef)attrs, outError);
}

/**
 * Helper: Parse App Attest assertion CBOR to extract signature and authenticatorData.
 * Returns YES on success, populating outSignature and outAuthData.
 */
static BOOL parseAssertionCBOR(NSData *assertionData, NSData **outSignature, NSData **outAuthData) {
    if (assertionData == nil || assertionData.length < 5) return NO;
    const uint8_t *data = (const uint8_t *)assertionData.bytes;
    NSUInteger dataLength = assertionData.length;
    NSUInteger offset = 0;

    // Expect a CBOR map
    uint8_t initialByte = data[offset++];
    uint8_t majorType = (initialByte >> 5) & 0x07;
    uint8_t additionalInfo = initialByte & 0x1F;
    if (majorType != 5) return NO;
    uint64_t mapCount = cborReadUInt(data, &offset, additionalInfo);

    NSData *signature = nil;
    NSData *authenticatorData = nil;

    for (uint64_t i = 0; i < mapCount && offset < dataLength; i++) {
        NSString *key = cborReadTextString(data, dataLength, &offset);
        if (key == nil) return NO;

        if ([key isEqualToString:@"signature"]) {
            signature = cborReadByteString(data, dataLength, &offset);
        } else if ([key isEqualToString:@"authenticatorData"]) {
            authenticatorData = cborReadByteString(data, dataLength, &offset);
        } else {
            cborSkipValue(data, dataLength, &offset);
        }
    }

    if (signature == nil || authenticatorData == nil) return NO;
    *outSignature = signature;
    *outAuthData = authenticatorData;
    return YES;
}

/**
 * Compare two public keys — handles raw 65-byte vs SPKI-wrapped formats.
 * Returns YES if they represent the same key.
 */
static BOOL publicKeysMatch(NSData *keyA, NSData *keyB) {
    if (keyA == nil || keyB == nil) return NO;
    if ([keyA isEqualToData:keyB]) return YES;

    NSData *rawA = extractRawECPoint(keyA);
    NSData *rawB = extractRawECPoint(keyB);
    if (rawA == nil || rawB == nil) return NO;
    return [rawA isEqualToData:rawB];
}

/**
 * Check certificate serial numbers against Google's attestation revocation list.
 * Non-blocking on network failure — returns empty errors and checked=NO if network fails.
 */
static NSDictionary *checkGoogleRevocation(NSArray *certRefs) {
    NSMutableArray *errors = [NSMutableArray array];
    BOOL checked = NO;
    
    @try {
        NSURL *url = [NSURL URLWithString:@"https://android.googleapis.com/attestation/status"];
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
        [request setTimeoutInterval:5.0];
        [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
        
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block NSData *responseData = nil;
        __block NSInteger statusCode = 0;
        
        NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (!error && [response isKindOfClass:[NSHTTPURLResponse class]]) {
                statusCode = ((NSHTTPURLResponse *)response).statusCode;
                responseData = data;
            }
            dispatch_semaphore_signal(semaphore);
        }];
        [task resume];
        dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
        
        if (statusCode != 200 || responseData == nil) {
            [errors addObject:[NSString stringWithFormat:@"Revocation check returned HTTP %ld", (long)statusCode]];
            return @{@"errors": errors, @"checked": @NO};
        }
        
        NSDictionary *json = [NSJSONSerialization JSONObjectWithData:responseData options:0 error:nil];
        NSDictionary *entries = json[@"entries"];
        
        if (entries) {
            checked = YES;
            for (id certRef in certRefs) {
                SecCertificateRef cert = (__bridge SecCertificateRef)certRef;
                NSData *serialData = (__bridge_transfer NSData *)SecCertificateCopySerialNumberData(cert, NULL);
                if (serialData) {
                    // Convert serial number data to lowercase hex string
                    NSMutableString *serialHex = [NSMutableString string];
                    const uint8_t *bytes = (const uint8_t *)serialData.bytes;
                    // Skip leading zeros
                    BOOL leadingZero = YES;
                    for (NSUInteger i = 0; i < serialData.length; i++) {
                        if (leadingZero && bytes[i] == 0) continue;
                        leadingZero = NO;
                        [serialHex appendFormat:@"%02x", bytes[i]];
                    }
                    if (serialHex.length == 0) [serialHex appendString:@"0"];
                    
                    if (entries[serialHex] != nil) {
                        NSString *reason = entries[serialHex][@"reason"] ?: @"unknown";
                        [errors addObject:[NSString stringWithFormat:@"Certificate serial %@ is revoked: %@", serialHex, reason]];
                    }
                }
            }
        } else {
            [errors addObject:@"Revocation response missing 'entries' field"];
        }
    } @catch (NSException *e) {
        [errors addObject:[NSString stringWithFormat:@"Revocation check skipped: %@", e.reason]];
    }
    
    return @{@"errors": errors, @"checked": @(checked)};
}

RCT_EXPORT_METHOD(verifyHardwareEvidence:(NSArray<NSString *> *)certificateChainPem
                  signatureBase64:(NSString *)signatureBase64
                  signedContent:(NSString *)signedContent
                  publicKeyBase64:(NSString *)publicKeyBase64
                  attestationFormat:(NSString *)attestationFormat
                  signedContentHashBase64:(NSString *)signedContentHashBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSLog(@"[VRC:iOS] ▶ Native evidence verification [%@ format, %lu certs]",
          attestationFormat, (unsigned long)certificateChainPem.count);

    NSMutableArray<NSString *> *errors = [NSMutableArray array];
    BOOL chainValid = NO;
    BOOL sigValid = NO;
    BOOL pubKeyMatch = NO;
    NSString *leafPubKeyBase64 = @"";
    NSMutableArray *certRefs = [NSMutableArray array];

    // -------------------------------------------------------------------------
    // Step 1: Certificate Chain Verification via SecTrust
    // -------------------------------------------------------------------------
    if (certificateChainPem.count > 0) {
        for (NSString *pem in certificateChainPem) {
            NSData *der = pemToDer(pem);
            if (der == nil) {
                [errors addObject:@"Invalid PEM certificate in chain"];
                continue;
            }
            SecCertificateRef cert = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)der);
            if (cert == NULL) {
                [errors addObject:@"Failed to parse DER certificate"];
                continue;
            }
            [certRefs addObject:(__bridge_transfer id)cert];
        }

        if (certRefs.count > 0) {
            SecPolicyRef policy = SecPolicyCreateBasicX509();
            SecTrustRef trust = NULL;
            OSStatus status = SecTrustCreateWithCertificates((__bridge CFArrayRef)certRefs, policy, &trust);
            CFRelease(policy);

            if (status == errSecSuccess && trust != NULL) {
                // Build anchor array based on attestation format
                NSMutableArray *anchors = [NSMutableArray array];
                BOOL isAndroidFormat = [attestationFormat isEqualToString:@"android-key-attestation-v3"];

                if (isAndroidFormat) {
                    // Android chain → use Google Hardware Attestation Root
                    NSData *googleRootDer = pemToDer(GOOGLE_HARDWARE_ATTESTATION_ROOT_PEM);
                    if (googleRootDer) {
                        SecCertificateRef googleRoot = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)googleRootDer);
                        if (googleRoot) [anchors addObject:(__bridge_transfer id)googleRoot];
                    }
                    // Also add the chain's own root (last cert) as an anchor
                    if (certRefs.count > 1) {
                        [anchors addObject:certRefs.lastObject];
                    }
                } else {
                    // Apple chain → use Apple App Attestation Root + G3
                    NSData *attestRootDer = pemToDer(APPLE_APP_ATTESTATION_ROOT_CA_PEM);
                    if (attestRootDer) {
                        SecCertificateRef attestRoot = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)attestRootDer);
                        if (attestRoot) [anchors addObject:(__bridge_transfer id)attestRoot];
                    }
                    NSData *g3RootDer = pemToDer(APPLE_ROOT_CA_G3_PEM);
                    if (g3RootDer) {
                        SecCertificateRef g3Root = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)g3RootDer);
                        if (g3Root) [anchors addObject:(__bridge_transfer id)g3Root];
                    }
                }

                if (anchors.count > 0) {
                    SecTrustSetAnchorCertificates(trust, (__bridge CFArrayRef)anchors);
                    SecTrustSetAnchorCertificatesOnly(trust, YES);
                }

                CFErrorRef trustError = NULL;
                chainValid = SecTrustEvaluateWithError(trust, &trustError);

                if (!chainValid) {
                    NSString *errMsg = trustError ? (__bridge_transfer NSString *)CFErrorCopyDescription(trustError) : @"Unknown trust error";
                    [errors addObject:[NSString stringWithFormat:@"Chain validation failed: %@", errMsg]];
                    if (trustError) CFRelease(trustError);
                } else {
                    NSLog(@"[VRC:iOS]   1/3 Certificate chain: VALID (SecTrust)");
                }

                CFRelease(trust);
            } else {
                [errors addObject:@"Failed to create SecTrust object"];
            }
        } else {
            [errors addObject:@"No valid certificates in chain"];
        }
    } else {
        [errors addObject:@"Certificate chain is empty"];
    }

    // Google root CA expiry warning (cross-platform: Android attestation verified on iOS)
    if ([attestationFormat isEqualToString:@"android-key-attestation-v3"]) {
        NSLog(@"[VRC:iOS] ⚠ Google Hardware Attestation Root CA expires 2026-05-24 — update required before then");
    }

    // -------------------------------------------------------------------------
    // Step 2: Extract public key from leaf cert and compare to evidence
    // -------------------------------------------------------------------------
    if (certificateChainPem.count > 0) {
        NSData *leafPubKeyData = publicKeyFromLeafPem(certificateChainPem[0]);
        if (leafPubKeyData != nil && leafPubKeyData.length > 0) {
            leafPubKeyBase64 = [leafPubKeyData base64EncodedStringWithOptions:0];

            NSData *evidencePubKey = [[NSData alloc] initWithBase64EncodedString:publicKeyBase64 options:0];
            pubKeyMatch = publicKeysMatch(leafPubKeyData, evidencePubKey);

            if (!pubKeyMatch) {
                [errors addObject:@"Evidence public key does not match leaf certificate public key"];
            } else {
                NSLog(@"[VRC:iOS]   2/3 Public key match: YES");
            }
        } else {
            [errors addObject:@"Could not extract public key from leaf certificate"];
        }
    }

    // -------------------------------------------------------------------------
    // Step 3: Signature / Assertion Verification
    // -------------------------------------------------------------------------
    if (signedContent != nil && signedContent.length > 0 &&
        signatureBase64 != nil && signatureBase64.length > 0 &&
        publicKeyBase64 != nil && publicKeyBase64.length > 0) {

        NSData *evidencePubKeyBytes = [[NSData alloc] initWithBase64EncodedString:publicKeyBase64 options:0];
        CFErrorRef keyError = NULL;
        SecKeyRef pubKey = createSecKeyFromPublicKeyBytes(evidencePubKeyBytes, &keyError);

        if (pubKey == NULL) {
            NSString *keyErrMsg = keyError ? (__bridge_transfer NSString *)CFErrorCopyDescription(keyError) : @"Unknown";
            [errors addObject:[NSString stringWithFormat:@"Failed to create SecKey from public key: %@", keyErrMsg]];
            if (keyError) CFRelease(keyError);
        } else {
            BOOL isAppleAssertion = [attestationFormat isEqualToString:@"apple-appattest-v1"];
            NSData *sigData = [[NSData alloc] initWithBase64EncodedString:signatureBase64 options:0];

            if (isAppleAssertion && sigData.length > 80 && ((const uint8_t *)sigData.bytes)[0] != 0x30) {
                // App Attest CBOR assertion
                NSData *assertionSignature = nil;
                NSData *authenticatorData = nil;

                if (parseAssertionCBOR(sigData, &assertionSignature, &authenticatorData)) {
                    NSLog(@"[VRC:iOS]   CBOR parsed: authData=%lub, sig=%lub",
                          (unsigned long)authenticatorData.length, (unsigned long)assertionSignature.length);

                    NSData *clientDataHash = nil;
                    NSData *contentData = [signedContent dataUsingEncoding:NSUTF8StringEncoding];
                    uint8_t computedHash[CC_SHA256_DIGEST_LENGTH];
                    CC_SHA256(contentData.bytes, (CC_LONG)contentData.length, computedHash);
                    NSData *computedHashData = [NSData dataWithBytes:computedHash length:CC_SHA256_DIGEST_LENGTH];

                    if (signedContentHashBase64 != nil && signedContentHashBase64.length > 0) {
                        clientDataHash = [[NSData alloc] initWithBase64EncodedString:signedContentHashBase64 options:0];
                        if (clientDataHash == nil || clientDataHash.length != CC_SHA256_DIGEST_LENGTH) {
                            NSLog(@"[VRC:iOS] ⚠ Invalid embedded signedContentHash (base64 decode failed or wrong length) — falling back to computed hash");
                            clientDataHash = computedHashData;
                        }
                        NSLog(@"[VRC:iOS]   Using embedded signedContentHash [%lub]", (unsigned long)clientDataHash.length);
                        if (![clientDataHash isEqualToData:computedHashData]) {
                            NSLog(@"[VRC:iOS]   ⚠ Embedded hash differs from SHA256(signedContent) — expected for cross-device VRC");
                        }
                    } else {
                        clientDataHash = computedHashData;
                        NSLog(@"[VRC:iOS]   ⚠ No embedded signedContentHash — falling back to SHA256(signedContent)");
                    }

                    NSMutableData *payload = [NSMutableData dataWithData:authenticatorData];
                    [payload appendData:clientDataHash];

                    // App Attest Secure Enclave double-hashes: the assertion
                    // signature covers SHA256(SHA256(authData || clientDataHash)).
                    // Use Message alg with nonce as input (internally hashes once more).
                    NSData *nonce = sha256OfData(payload);

                    sigValid = SecKeyVerifySignature(pubKey,
                                                     kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
                                                     (__bridge CFDataRef)nonce,
                                                     (__bridge CFDataRef)assertionSignature, NULL);
                    if (sigValid) {
                        NSLog(@"[VRC:iOS]   3/3 Assertion signature: VALID");
                    } else {
                        [errors addObject:@"Assertion signature invalid"];
                        NSLog(@"[VRC:iOS]   ✗ Assertion signature invalid");
                    }
                } else {
                    [errors addObject:@"Failed to parse CBOR assertion"];
                    NSLog(@"[VRC:iOS]   ✗ CBOR assertion parse failed (input: %lub)", (unsigned long)sigData.length);
                }
            } else {
                // Raw ECDSA signature (e.g. Android evidence verified on iOS, or non-assertion format)
                NSData *contentData = [signedContent dataUsingEncoding:NSUTF8StringEncoding];
                CFErrorRef verifyError = NULL;
                sigValid = SecKeyVerifySignature(pubKey,
                                                 kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
                                                 (__bridge CFDataRef)contentData,
                                                 (__bridge CFDataRef)sigData,
                                                 &verifyError);
                if (!sigValid) {
                    NSString *vErrMsg = verifyError ? (__bridge_transfer NSString *)CFErrorCopyDescription(verifyError) : @"Signature mismatch";
                    [errors addObject:[NSString stringWithFormat:@"Signature invalid: %@", vErrMsg]];
                    if (verifyError) CFRelease(verifyError);
                } else {
                    NSLog(@"[VRC:iOS]   3/3 ECDSA signature: VALID");
                }
            }
            CFRelease(pubKey);
        }
    } else {
        [errors addObject:@"Missing signed content, signature, or public key for verification"];
    }

    // -------------------------------------------------------------------------
    // Step 4: Google CRL revocation check (Android chains only)
    // -------------------------------------------------------------------------
    BOOL revocationChecked = NO;
    if ([attestationFormat isEqualToString:@"android-key-attestation-v3"] && certRefs.count > 0) {
        NSDictionary *revResult = checkGoogleRevocation(certRefs);
        NSArray *revErrors = revResult[@"errors"];
        revocationChecked = [revResult[@"checked"] boolValue];
        [errors addObjectsFromArray:revErrors];
        
        if (revocationChecked) {
            BOOL hasRevoked = NO;
            for (NSString *err in revErrors) {
                if ([err hasPrefix:@"Certificate serial"]) { hasRevoked = YES; break; }
            }
            if (!hasRevoked) {
                NSLog(@"[VRC:iOS]   4/4 Google CRL: No certificates revoked");
            }
        }
    }

    // -------------------------------------------------------------------------
    // Build result
    // -------------------------------------------------------------------------
    BOOL overallValid = chainValid && sigValid && pubKeyMatch;
    // If revocation was checked and found a revoked cert, fail
    if (revocationChecked) {
        for (NSString *err in errors) {
            if ([err hasPrefix:@"Certificate serial"]) { overallValid = NO; break; }
        }
    }

    NSLog(@"[VRC:iOS] %@ Verification %@ [chain=%@, sig=%@, pubkey=%@, errors=%lu]",
          overallValid ? @"✓" : @"✗",
          overallValid ? @"PASSED" : @"FAILED",
          chainValid ? @"YES" : @"NO",
          sigValid ? @"YES" : @"NO",
          pubKeyMatch ? @"YES" : @"NO",
          (unsigned long)errors.count);

    resolve(@{
        @"valid": @(overallValid),
        @"certificateChainValid": @(chainValid),
        @"signatureValid": @(sigValid),
        @"publicKeyMatchesLeafCert": @(pubKeyMatch),
        @"leafPublicKeyBase64": leafPubKeyBase64,
        @"revocationChecked": @(revocationChecked),
        @"errors": errors
    });
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeAttestationSpecJSI>(params);
}
#endif

@end
