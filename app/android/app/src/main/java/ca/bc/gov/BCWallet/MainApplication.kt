package asml.bkc.harvard.wallet

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.res.Configuration
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost

import com.hotupdater.HotUpdater
import com.hotupdater.HotUpdaterConfig
import com.hotupdater.HotUpdaterImpl
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper
import org.wonday.orientation.OrientationActivityLifecycle

/**
 * The channel every push wake is shown in, named as Firebase's default
 * (firebase.json messaging_android_notification_channel_id). Without it the
 * wake went to Firebase's fallback channel, whose default importance shows no
 * heads-up banner on stock Android: only an entry in the shade.
 */
const val WAKE_CHANNEL_ID = "keyring_wake"

/** The bundle file React Native was given for this process (MainActivity's update watchdog reads it). */
@Volatile
var otaBundleFile: String? = null

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        ReactNativeHostWrapper(this, object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> =
                PackageList(this).packages.apply {
                    // Packages that cannot be autolinked yet can be added manually here, for example:
                    // add(MyReactNativePackage())
                }
            
            override fun getJSMainModuleName(): String = "index"
            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG
            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED

            // The over-the-air update loader: an installed update when there is
            // one, otherwise this build's own bundle (src/ota/withOta.tsx). Debug
            // builds keep loading from Metro. Expo's ReactNativeHostWrapper reads
            // this through to the New Architecture ReactHost (toReactHost).
            override fun getJSBundleFile(): String? =
                if (BuildConfig.DEBUG) {
                    null
                } else {
                    HotUpdater.getJSBundleFile(this@MainApplication.applicationContext).also { otaBundleFile = it }
                }
    })

    override val reactHost: ReactHost
        get() = getDefaultReactHost(this.applicationContext, reactNativeHost)

    override fun onCreate() {
        registerActivityLifecycleCallbacks(OrientationActivityLifecycle.getInstance())
        super.onCreate()
        createWakeChannel()
        // Before React Native asks for the bundle file (see otaIsolationKey).
        HotUpdaterConfig.isolationKey = otaIsolationKey()
        loadReactNative(this)
        ApplicationLifecycleDispatcher.onApplicationCreate(this)
    }

    // The key hot-updater files this phone's downloaded update under. Its
    // default, HotUpdaterPrefs_{fingerprint}_{appVersion}_{channel}, has no build
    // number, and every store build has the same version (0.2.0). So a store
    // build with only JavaScript changes would find the previous build's update,
    // launch it instead of its own bundle, and the server would offer neither an
    // update nor a rollback (the update is older than this build). With the
    // build number in the key, each store build starts on its own bundle. This
    // is the default composition with the version read as {version}+{build};
    // keep it in step with AppDelegate.mm.
    internal fun otaIsolationKey(): String {
        val version = "${HotUpdaterImpl.getAppVersion(this) ?: "unknown"}+${BuildConfig.VERSION_CODE}"
        val fingerprint = HotUpdaterImpl.getFingerprintHash(this)
        val base = if (fingerprint.isNullOrEmpty()) version else "${fingerprint}_$version"
        return "HotUpdaterPrefs_${base}_${HotUpdaterImpl.getChannel(this)}"
    }

    // High importance: a wake is something waiting for the person (an approval or
    // a message), so it pops up as a banner. Created at every start, before any
    // wake can arrive; creating an existing channel only refreshes its name and
    // description, and never overrides what the person set for it.
    private fun createWakeChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            WAKE_CHANNEL_ID,
            getString(R.string.notification_channel_wake_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply { description = getString(R.string.notification_channel_wake_description) }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
    }
}