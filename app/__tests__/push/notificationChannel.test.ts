/**
 * The Android channel a push wake is shown in. Without one the wake went to
 * Firebase's fallback channel (fcm_fallback_notification_channel, importance
 * default), which on stock Android shows no heads-up banner, only an entry in
 * the shade (emulator, 10-11). Native code no jest test runs, so this pins what
 * the three places must agree on: the id, its importance, and its words.
 */
import fs from 'fs'
import path from 'path'

const APP = path.join(__dirname, '..', '..')
const ANDROID = path.join(APP, 'android', 'app', 'src', 'main')
const LOCALES = ['values', 'values-fr', 'values-pt-rBR']

describe('the Android wake notification channel', () => {
  const firebase = JSON.parse(fs.readFileSync(path.join(APP, 'firebase.json'), 'utf8'))
  const app = fs.readFileSync(path.join(ANDROID, 'java', 'ca', 'bc', 'gov', 'BCWallet', 'MainApplication.kt'), 'utf8')

  it("is Firebase's default channel, so a wake with no channel of its own uses it", () => {
    expect(firebase['react-native'].messaging_android_notification_channel_id).toBe('keyring_wake')
  })

  it('is created by the app with that id, at high importance, at start-up', () => {
    expect(app).toContain('const val WAKE_CHANNEL_ID = "keyring_wake"')
    expect(app).toMatch(/NotificationChannel\(\s*WAKE_CHANNEL_ID,[\s\S]*?NotificationManager\.IMPORTANCE_HIGH/)
    const onCreate = app.slice(app.indexOf('override fun onCreate()'))
    expect(onCreate.slice(0, onCreate.indexOf('\n    }'))).toContain('createWakeChannel()')
  })

  it.each(LOCALES)('has a name and a description in %s', (dir) => {
    const strings = fs.readFileSync(path.join(ANDROID, 'res', dir, 'strings.xml'), 'utf8')
    expect(strings).toMatch(/<string name="notification_channel_wake_name">[^<]+<\/string>/)
    expect(strings).toMatch(/<string name="notification_channel_wake_description">[^<]+<\/string>/)
  })
})
