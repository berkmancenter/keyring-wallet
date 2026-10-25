/**
 * Keyring has one push path: a push wake-up gateway holds the token, and the
 * phone's agent provisions it (docs/plans/push-notifications-plan.md §1, step
 * 1.2). The inherited BC Wallet path handed the FCM token to the DIDComm
 * mediator through Credo's push module instead; this fails if any of it comes
 * back into the app's source.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..', 'src')
const APP_ROOT_FILES = ['App.tsx', 'container-imp.ts', 'index.js'].map((f) => path.join(__dirname, '..', '..', f))
const FORBIDDEN = [
  'pushNotificationsFcm',
  'PushNotificationsHelper',
  'MEDIATOR_USE_PUSH_NOTIFICATIONS',
  'setDeviceInfo',
]

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|js)$/.test(entry.name) ? [full] : []
  })
}

describe('the inherited BC Wallet push path', () => {
  it('is gone from the app source', () => {
    const files = [...sourceFiles(SRC), ...APP_ROOT_FILES.filter((f) => fs.existsSync(f))]
    const hits = files.flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8')
      return FORBIDDEN.filter((word) => text.includes(word)).map((word) => `${path.relative(SRC, file)}: ${word}`)
    })
    expect(hits).toEqual([])
  })
})
