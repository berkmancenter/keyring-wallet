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

// Where a tapped wake leads: the Messages tab for a message wake, whose thread
// id is its own collapse id, starting keyring-msg- (gateway patch 0003); the
// approvals for every other wake (pushHandlers.ts tapKind does the same on Android).
static NSString *KeyringWakeLink(NSDictionary *userInfo)
{
  id aps = userInfo[@"aps"];
  id thread = [aps isKindOfClass:[NSDictionary class]] ? aps[@"thread-id"] : nil;
  BOOL message = [thread isKindOfClass:[NSString class]] && [thread hasPrefix:@"keyring-msg-"];
  return message ? KeyringMessagesLink : KeyringApprovalsLink;
}

@interface AppDelegate () <UNUserNotificationCenterDelegate>
@end

@implementation AppDelegate {
  // The tap that launched the app is delivered twice: in the launch options and
  // as a notification response. The launch options open the wake's link, so
  // that one response is skipped.
  BOOL _launchedFromWakeTap;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // allows background WebRTC
  [WebRTCModuleOptions sharedInstance].enableMultitaskingCameraAccess = YES;

  [FIRApp configure];
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
// Shown as a banner, in Notification Centre, and with its sound, but with no
// app-icon badge: the app already shows its own count of waiting requests.
// Firebase messaging takes the delegate over at launch and forwards this to
// it for any notification that is not its own (no gcm.message_id).
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  if (KeyringIsWakeNotification(notification.request.content.userInfo)) {
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
  return [HotUpdater bundleURL];
#endif
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
