#import "AppDelegate.h"

#import <WebRTCModuleOptions.h>
#import <Firebase.h>
#import <HotUpdater/HotUpdater.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import <React/RCTBridge.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>
#import <React/RCTLinkingManager.h>
#import <UserNotifications/UserNotifications.h>
#import "Orientation.h"

// The app's own link to the waiting approvals (bifold's APPROVALS_LINK).
static NSString *const KeyringApprovalsLink = @"keyring://vta/approvals";
// The app's own link to the Messages tab (bifold's MESSAGES_LINK).
static NSString *const KeyringMessagesLink = @"keyring://messages";

// Whether a notification is the push gateway's wake: an alert whose text is the
// app's own KEYRING_WAKE string (Localizable.strings). It carries no content.
static BOOL KeyringIsWakeNotification(NSDictionary *userInfo)
{
  id aps = userInfo[@"aps"];
  id alert = [aps isKindOfClass:[NSDictionary class]] ? aps[@"alert"] : nil;
  return [alert isKindOfClass:[NSDictionary class]] && [alert[@"loc-key"] isEqual:@"KEYRING_WAKE"];
}

// Whether a wake is for a message: its thread id is its own collapse id,
// starting keyring-msg- (gateway patch 0003). pushHandlers.ts tapKind reads
// the same on Android.
static BOOL KeyringIsMessageWake(NSDictionary *userInfo)
{
  id aps = userInfo[@"aps"];
  id thread = [aps isKindOfClass:[NSDictionary class]] ? aps[@"thread-id"] : nil;
  return [thread isKindOfClass:[NSString class]] && [thread hasPrefix:@"keyring-msg-"];
}

// Where a tapped wake leads: the Messages tab for a message wake, the
// approvals for every other wake.
static NSString *KeyringWakeLink(NSDictionary *userInfo)
{
  return KeyringIsMessageWake(userInfo) ? KeyringMessagesLink : KeyringApprovalsLink;
}

// --- Over-the-air update watchdog ------------------------------------------
//
// When an update crashes while its JavaScript loads, hot-updater 0.36.18 picks
// the previous bundle and asks React Native to reload into it. Under the New
// Architecture that reload fails ("AppRegistryBinding::startSurface failed.
// Global was not installed"), and the app sits on a black screen until the
// person force-quits it (docs/plans/release-cadence-and-testing-strategy/
// 2026-10-21-al.md). The next launch is fine: the bad bundle is rolled back and
// blocked. So when the first launch of a downloaded update shows nothing for
// KeyringOtaWatchdogSeconds, this closes the app (abort), and the person's next
// tap opens the previous bundle.
//
// It arms only for that trial launch (hot-updater's metadata says the staged
// bundle is pending verification and the loader chose it), and only in the
// foreground. A background launch (a push wake, a background fetch) never shows
// content, and closing it would kill a legitimate launch. It disarms when content
// appears or the app goes to the background. A store build without
// OTA_UPDATE_URL never has a downloaded bundle, so it never arms there.
//
// The threshold errs long on purpose, and that is not a slip to tidy up. Firing
// late costs a few more seconds of black screen after a bad update, which is
// rare. Firing early closes a healthy launch on a slow phone or a cold cache, on
// every such launch. A successful first launch of an update took about 2 s on an
// iPhone 16 (10-21); 20 s leaves room for older phones until one is measured.
static const NSTimeInterval KeyringOtaWatchdogSeconds = 20;

// The key hot-updater files this phone's downloaded update under. Its default,
// hotupdater_{fingerprint}_{appVersion}_{channel}_, has no build number, and
// every store build has the same version (0.2.0). So a store build with only
// JavaScript changes would find the previous build's update, launch it instead
// of its own bundle, and the server would offer neither an update nor a
// rollback (the update is older than this build). With the build number in the
// key, each store build starts on its own bundle. This is the default
// composition with the version read as {version}+{build}; keep it in step with
// MainApplication.kt and app/src/ota/stagedUpdate.ts (isolationKeyFor), which
// rebuilds it to read the staged update for apply-on-return.
static NSString *KeyringOtaIsolationKey(void)
{
  NSDictionary *info = [NSBundle mainBundle].infoDictionary;
  NSString *fingerprint = info[@"HOT_UPDATER_FINGERPRINT_HASH"];
  NSString *channel = info[@"HOT_UPDATER_CHANNEL"];
  NSString *version = [NSString stringWithFormat:@"%@+%@", info[@"CFBundleShortVersionString"] ?: @"unknown",
                                                 info[@"CFBundleVersion"] ?: @"unknown"];
  NSString *base = fingerprint.length ? [NSString stringWithFormat:@"%@_%@", fingerprint, version] : version;
  return [NSString stringWithFormat:@"hotupdater_%@_%@_", base, channel.length ? channel : @"production"];
}

// The staged bundle id when this launch is hot-updater's trial of it, else nil.
// Reads hot-updater's own bundle-store/metadata.json (verification_pending,
// staging_bundle_id): there is no public API for it in 0.36.18. A hot-updater
// bump re-checks this (deploy/keyring-ota/README.md, "Upgrading hot-updater").
static NSString *KeyringOtaTrialBundleId(NSURL *bundleURL)
{
  NSURL *documents = [[[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory
                                                             inDomains:NSUserDomainMask] firstObject];
  NSData *data = [NSData dataWithContentsOfURL:[documents URLByAppendingPathComponent:@"bundle-store/metadata.json"]];
  if (!data) return nil;
  id metadata = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![metadata isKindOfClass:[NSDictionary class]]) return nil;
  // Metadata a previous build wrote under another key, which hot-updater ignores too.
  if (![metadata[@"isolation_key"] isEqual:KeyringOtaIsolationKey()]) return nil;
  id pending = metadata[@"verification_pending"];
  id staging = metadata[@"staging_bundle_id"];
  if (![pending respondsToSelector:@selector(boolValue)] || ![pending boolValue]) return nil;
  if (![staging isKindOfClass:[NSString class]] || [staging length] == 0) return nil;
  // The loader chose the staged bundle for this launch (not a rollback to another).
  return [bundleURL.path containsString:staging] ? staging : nil;
}

@interface AppDelegate () <UNUserNotificationCenterDelegate>
@end

@implementation AppDelegate {
  // The tap that launched the app is delivered twice: in the launch options and
  // as a notification response. The launch options open the wake's link, so
  // that one response is skipped.
  BOOL _launchedFromWakeTap;
  // The over-the-air watchdog's pending close, while armed (see above).
  dispatch_block_t _otaWatchdog;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // allows background WebRTC
  [WebRTCModuleOptions sharedInstance].enableMultitaskingCameraAccess = YES;

  [FIRApp configure];
  // Before React Native asks for the bundle URL (see KeyringOtaIsolationKey).
  [HotUpdater configureWithFingerprintHash:nil publicKey:nil channel:nil isolationKey:KeyringOtaIsolationKey()];
  self.moduleName = @"KeyRing";
  // RN 0.77+: third-party Fabric components/modules are resolved through this provider
  self.dependencyProvider = [RCTAppDependencyProvider new];
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  // Because certain file operations can reset resource values, we
  // excluded file’s resource values each time the application starts.
  [self excludeDotAFJFolderFromBackup];

  // A tapped wake opens the waiting approvals, or the Messages tab for a
  // message wake (KeyringWakeLink). The gateway sends the wake
  // straight to APNs, not through Firebase, so Firebase messaging's tap
  // callbacks never fire for it (it only reports notifications that carry its
  // own message id). Set before Firebase messaging takes the delegate over at
  // the end of launch: it keeps this one and forwards to it.
  [UNUserNotificationCenter currentNotificationCenter].delegate = self;

  // A tap that launched the app: hand React Native the wake's link as the
  // launch URL, which the app's deep-link handling keeps until the wallet is
  // unlocked.
  NSDictionary *launchNotification = launchOptions[UIApplicationLaunchOptionsRemoteNotificationKey];
  if ([launchNotification isKindOfClass:[NSDictionary class]] && KeyringIsWakeNotification(launchNotification) &&
      launchOptions[UIApplicationLaunchOptionsURLKey] == nil) {
    NSMutableDictionary *options = [launchOptions mutableCopy];
    options[UIApplicationLaunchOptionsURLKey] = [NSURL URLWithString:KeyringWakeLink(launchNotification)];
    launchOptions = options;
    _launchedFromWakeTap = YES;
  }

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

// A wake that arrives while Keyring is open. Without this, iOS shows nothing
// for a notification whose app is in the foreground, so an approval request
// made from the phone itself (My Agent > "Send me a test request") rang the
// gateway and APNs delivered it, and the person saw no banner (IN-309, 264).
//
// - An approval wake: a banner, in Notification Centre, with its sound, and no
//   app-icon badge, since the app keeps its own count of waiting requests.
// - A message wake: nothing. The app is open, so the message itself arrives
//   in it, and the in-app message notice (InAppMessageNotifier) says so unless
//   that chat is on screen. A banner too would say it twice.
// - Anything else: as before, nothing.
//
// Firebase messaging takes the delegate over at launch and forwards this to
// it for any notification that is not its own (no gcm.message_id).
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  NSDictionary *userInfo = notification.request.content.userInfo;
  if (KeyringIsWakeNotification(userInfo) && !KeyringIsMessageWake(userInfo)) {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList |
                      UNNotificationPresentationOptionSound);
    return;
  }
  completionHandler(UNNotificationPresentationOptionNone);
}

// A tap on a notification while the app is running or suspended.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler
{
  NSDictionary *userInfo = response.notification.request.content.userInfo;
  if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier] &&
      KeyringIsWakeNotification(userInfo)) {
    if (_launchedFromWakeTap) {
      _launchedFromWakeTap = NO;
    } else {
      [RCTLinkingManager application:[UIApplication sharedApplication]
                             openURL:[NSURL URLWithString:KeyringWakeLink(userInfo)]
                             options:@{}];
    }
  }
  completionHandler();
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

// RN 0.74+ RCTAppDelegate calls -bundleURL (sourceURLForBridge: kept for compat)
- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  // The over-the-air update loader: an installed update when there is one,
  // otherwise this build's own main.jsbundle (src/ota/withOta.tsx).
  NSURL *url = [HotUpdater bundleURL];
  [self armOtaWatchdogForBundleURL:url];
  return url;
#endif
}

- (void)armOtaWatchdogForBundleURL:(NSURL *)bundleURL
{
  if (_otaWatchdog) return;
  NSString *bundleId = KeyringOtaTrialBundleId(bundleURL);
  if (!bundleId) return;
  if ([UIApplication sharedApplication].applicationState == UIApplicationStateBackground) return;

  __weak AppDelegate *weakSelf = self;
  _otaWatchdog = dispatch_block_create((dispatch_block_flags_t)0, ^{
    NSLog(@"[OtaWatchdog] no first screen %.0f s after launching update %@; closing so the next launch "
           "opens the previous bundle",
          KeyringOtaWatchdogSeconds, bundleId);
    abort();
  });
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  [center addObserver:self selector:@selector(disarmOtaWatchdog) name:RCTContentDidAppearNotification object:nil];
  [center addObserver:self
             selector:@selector(disarmOtaWatchdog)
                 name:UIApplicationDidEnterBackgroundNotification
               object:nil];
  dispatch_block_t watchdog = _otaWatchdog;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(KeyringOtaWatchdogSeconds * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   AppDelegate *strongSelf = weakSelf;
                   if (strongSelf && strongSelf->_otaWatchdog == watchdog) watchdog();
                 });
}

- (void)disarmOtaWatchdog
{
  if (!_otaWatchdog) return;
  dispatch_block_cancel(_otaWatchdog);
  _otaWatchdog = nil;
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  [center removeObserver:self name:RCTContentDidAppearNotification object:nil];
  [center removeObserver:self name:UIApplicationDidEnterBackgroundNotification object:nil];
}

- (BOOL)application:(UIApplication *)application
   openURL:(NSURL *)url
   options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}

- (BOOL)application:(UIApplication *)application
   continueUserActivity:(nonnull NSUserActivity *)userActivity
   restorationHandler:(nonnull void (^)(NSArray<id<UIUserActivityRestoring>> * _Nullable))restorationHandler
{
  return [RCTLinkingManager application:application
                   continueUserActivity:userActivity
                     restorationHandler:restorationHandler];
}

- (void)applicationDidBecomeActive:(UIApplication *)application {
  [UIApplication sharedApplication].applicationIconBadgeNumber = 0;
}

- (UIInterfaceOrientationMask)application:(UIApplication *)application supportedInterfaceOrientationsForWindow:(UIWindow *)window {
  return [Orientation getOrientation];
}

// The .afj folder from Credo cannot be restored.
- (void)excludeDotAFJFolderFromBackup {
    NSString *folderName = @".afj";
    NSURL *documentsURL = [[[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory
                                                                  inDomains:NSUserDomainMask] firstObject];
    NSURL *folderURL = [documentsURL URLByAppendingPathComponent:folderName];

    // Check if the directory exists
    BOOL isDir;
    BOOL fileExists = [[NSFileManager defaultManager] fileExistsAtPath:[folderURL path]
                                                           isDirectory:&isDir];
    if (!fileExists || !isDir) {
      NSLog(@"Directory %@ does not exist. Skipping backup exclusion.", folderName);
      return;
    }

    // Exclude the folder from backup
    NSError *error = nil;
    BOOL success = [folderURL setResourceValue:@YES 
                                        forKey:NSURLIsExcludedFromBackupKey 
                                         error:&error];

    if (success) {
      NSLog(@"Excluded folder %@ from backup.", folderName);
    } else {
      NSLog(@"Error excluding folder %@ from backup: %@", folderName, error);
    }
}

@end
