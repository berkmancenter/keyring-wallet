package asml.bkc.harvard.wallet

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.bridge.ReactMarker
import com.facebook.react.bridge.ReactMarkerConstants
import java.io.File
import org.devio.rn.splashscreen.SplashScreen
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactActivityDelegate

// The over-the-air update watchdog, Android's counterpart of the one in
// AppDelegate.mm (#562). hot-updater recovers an update that crashes at load by
// restarting the app on the previous bundle, but an update that hangs before its
// first screen (no error, no content) is never recovered: its own watchdog acts
// only on a crash marker, and at its deadline it just stops. The app stays blank
// until the person closes it; only the next launch rolls the bundle back
// (docs/plans/release-cadence-and-testing-strategy/2026-10-21-al.md). So when the
// first launch of a downloaded update shows nothing for OTA_WATCHDOG_MS, this
// fails the launch.
//
// It arms only for that trial launch (OtaTrial: hot-updater's metadata says the
// staged bundle is pending verification under this build's isolation key, and the
// loader chose it), and only in the foreground: onStart. A background start (a
// push wake, a headless task) has no activity and never arms. It disarms when
// content appears or the activity stops. A store build without OTA_UPDATE_URL
// never has a downloaded bundle, so it never arms there.
//
// The threshold errs long on purpose, as on iOS: firing late costs seconds of
// blank screen after a rare bad update, while firing early fails a healthy slow
// launch every time. 20 s matches iOS until an Android phone is measured.
private const val OTA_WATCHDOG_MS = 20_000L

class MainActivity : ReactActivity() {

    private val otaWatchdogHandler = Handler(Looper.getMainLooper())
    private var otaWatchdog: Runnable? = null
    private val otaContentAppeared =
        ReactMarker.MarkerListener { name, _, _ ->
            if (name == ReactMarkerConstants.CONTENT_APPEARED) otaWatchdogHandler.post { disarmOtaWatchdog() }
        }

    // react-native-screens override
    // https://github.com/software-mansion/react-native-screens#android
    override fun onCreate(savedInstanceState: Bundle?) {
        SplashScreen.show(this)
        super.onCreate(null)
    }

    /**
     * Detects changes in device orientation and sends them to JavaScript by broadcasting an event.
     * This is used to support the camera on different tablet orientations.
     */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val intent = Intent("onConfigurationChanged")
        intent.putExtra("newConfig", newConfig)
        this.sendBroadcast(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        removeNotifications()
        armOtaWatchdog()
    }

    override fun onStop() {
        disarmOtaWatchdog()
        super.onStop()
    }

    private fun armOtaWatchdog() {
        if (otaWatchdogArmed) return
        otaWatchdogArmed = true
        val metadata = File(filesDir, "bundle-store/metadata.json").takeIf(File::exists)?.readText()
        val isolationKey = (application as MainApplication).otaIsolationKey()
        val bundleFile = otaBundleFile
        val bundleId = OtaTrial.trialBundleId(metadata, isolationKey, bundleFile)
        if (bundleId == null) {
            // A trial is pending but React Native's bundle file was never recorded: the
            // watchdog can't tell what is launching, so it stays off. Logged, so a change
            // that defers the bundle-file read shows here instead of as an unrecovered hang.
            if (bundleFile == null) {
                OtaTrial.pendingTrialId(metadata, isolationKey)?.let {
                    Log.w("OtaWatchdog", "update $it is pending but no bundle file was recorded; not armed")
                }
            }
            return
        }
        Log.i("OtaWatchdog", "armed for update $bundleId (${OTA_WATCHDOG_MS / 1000} s)")
        ReactMarker.addListener(otaContentAppeared)
        val watchdog = Runnable {
            Log.e("OtaWatchdog", "no first screen ${OTA_WATCHDOG_MS / 1000} s after launching update $bundleId; failing the launch")
            // Throw rather than kill the process: during a trial launch hot-updater's
            // uncaught-exception handler is installed (HotUpdaterRecoveryManager). It
            // records the crash and restarts the app on the previous bundle by itself,
            // the in-place recovery Android supports. Without that handler, the default
            // one closes the app and the next launch rolls the bundle back.
            throw IllegalStateException("OTA update $bundleId showed no first screen in ${OTA_WATCHDOG_MS / 1000} s")
        }
        otaWatchdog = watchdog
        otaWatchdogHandler.postDelayed(watchdog, OTA_WATCHDOG_MS)
    }

    private fun disarmOtaWatchdog() {
        otaWatchdog?.let(otaWatchdogHandler::removeCallbacks)
        otaWatchdog = null
        ReactMarker.removeListener(otaContentAppeared)
    }

    override fun onRestart() {
        super.onRestart()
        removeNotifications()
    }

    /**
     * Returns the name of the main component registered from JavaScript. This is used to schedule
     * rendering of the component.
     */
    override fun getMainComponentName(): String = "KeyRing"

    companion object {
        // Once per process: the trial is the process's first launch, not each return to the foreground.
        private var otaWatchdogArmed = false
    }

    /**
     * Returns the instance of the [ReactActivityDelegate]. Here we use a util class
     * [DefaultReactActivityDelegate] which allows you to easily enable Fabric and Concurrent React
     * (aka React 18) with two boolean flags.
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return object : DefaultReactActivityDelegate(
            this,
            mainComponentName,
            DefaultNewArchitectureEntryPoint.fabricEnabled
        ) {
            override fun onCreate(savedInstanceState: Bundle?) {
                super.onCreate(savedInstanceState)
            }
        }
    }

    /**
     * Clears notification badges etc. on app open
     */
    private fun removeNotifications() {
        val notificationManagerCompat = NotificationManagerCompat.from(this)
        notificationManagerCompat.cancelAll()
    }
}