/**
 * Putting the hidden-vetting modules in the build, once and on purpose.
 *
 * Each adapter registers its seam when its module is evaluated, and **nothing
 * reads the adapters' exports**, so for a bundler there is no reason to
 * evaluate them. `app/metro.config.js` turns on Metro's `inlineRequires` for
 * every build that is not Storybook, which moves a module's `require` to the
 * first use of its binding; for a re-export the only use is inside the
 * export's getter, which nothing calls. The modules were therefore bundled
 * and never run: `hiddenVettingSeam()` answered undefined on every device, so
 * the Join card refused private vetting exactly as a build without the module
 * should, while the code sat in the APK and every unit test passed, because
 * jest does not inline requires. Build 254 shipped that way.
 *
 * Two things follow, and both are the reason this file exists rather than a
 * tidier import somewhere.
 *
 * A bare `import './module/hiddenVettingAdapter'` does not fix it: beside a
 * re-export of the same module babel merges them into one binding, which
 * inlineRequires then defers. Only a module-scope **use** survives, and the
 * call below is one.
 *
 * And the package root defers `./modules/trust-tasks` wholly, so putting the
 * call in that index is not enough on its own: it would run at whatever
 * moment something first touched a trust-tasks export, which need not be
 * before a screen reads a seam — the screens import the seam registry by
 * relative path and never go through the index at all. So the app calls this
 * at startup (App.tsx), where it certainly runs before any screen renders.
 *
 * @module trust-tasks/hiddenVettingModules
 */
import { hiddenVetterSeamImplementation } from './module/hiddenVetterAdapter'
import { hiddenVettingSeamImplementation } from './module/hiddenVettingAdapter'
import { releaseWarn } from './module/releaseLog'
import { hiddenVetterSeam, registerHiddenVetter } from './screens/hiddenVetterSeam'
import { hiddenVettingSeam, registerHiddenVetting } from './screens/hiddenVettingSeam'

let said = false

/**
 * Register the applicant's and the vetter's hidden-vetting modules. Safe to
 * call more than once, and called both from this module's own index and from
 * the app's startup; the line it logs is said once.
 *
 * Returns what is registered, so a caller or a test can state it rather than
 * assume it.
 */
export function registerHiddenVettingModules(): { applicant: boolean; vetter: boolean } {
  registerHiddenVetting(hiddenVettingSeamImplementation)
  registerHiddenVetter(hiddenVetterSeamImplementation)
  const registered = { applicant: hiddenVettingSeam() !== undefined, vetter: hiddenVetterSeam() !== undefined }
  if (!said) {
    said = true
    // A line a release build keeps, so a device log answers "is private
    // vetting in this build?" without a debugger — which is what 254 cost.
    releaseWarn(
      `[hidden-vetting] seams: applicant=${registered.applicant ? 'yes' : 'no'} vetter=${
        registered.vetter ? 'yes' : 'no'
      }`
    )
  }
  return registered
}

/** The agents the line has been logged through, so each says it once. */
const toldThrough = new WeakSet<object>()

/**
 * Say the same line at Info through `agent`'s logger, once per agent.
 *
 * The line `registerHiddenVettingModules` logs runs at module scope through
 * `releaseWarn`, before the app's log buffer exists: Android's logcat keeps
 * it, but on iOS it reached neither the system log nor the in-app report, so
 * neither of a tester's iPhone reports could say whether private vetting was
 * in the build. Once an agent exists its logger feeds the report, so the app
 * calls this when it has one (TabStack), and again for the agent an unlock
 * builds anew. The early `releaseWarn` stays: it costs nothing, and Android
 * reads it.
 */
export function logHiddenVettingSeams(
  agent: { config?: { logger?: { info?: (m: string) => void } } } | undefined
): void {
  if (!agent || toldThrough.has(agent)) return
  toldThrough.add(agent)
  const registered = registerHiddenVettingModules()
  agent.config?.logger?.info?.(
    `[hidden-vetting] seams: applicant=${registered.applicant ? 'yes' : 'no'} vetter=${registered.vetter ? 'yes' : 'no'}`
  )
}
