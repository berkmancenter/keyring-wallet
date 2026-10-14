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
    })

    override val reactHost: ReactHost
        get() = getDefaultReactHost(this.applicationContext, reactNativeHost)

    override fun onCreate() {
        registerActivityLifecycleCallbacks(OrientationActivityLifecycle.getInstance())
        super.onCreate()
        createWakeChannel()
        loadReactNative(this)
        ApplicationLifecycleDispatcher.onApplicationCreate(this)
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