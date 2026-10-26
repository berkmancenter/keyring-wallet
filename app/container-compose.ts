import { MainContainer } from '@bifold/core'
import { useMemo } from 'react'
import { TFunction } from 'react-i18next'
import { container } from 'tsyringe'

import { AppContainer } from './container-imp'
import BCLogger from './src/utils/logger'

/**
 * The app's dependency container: bifold's container with the app's as its
 * child.
 *
 * The app's registrations shadow bifold's because AppContainer registers into
 * its own child container (container-imp.ts) and the app resolves from that
 * child; tsyringe looks in the child before the parent, so the order the two
 * init() calls run in does not matter. What does matter fails silently: if the
 * app resolved from bifold's container, or registered on the parent, bifold's
 * defaults would win. For example, TOKENS.UTIL_MESSAGE_PICKUP would fall back to
 * bifold's polling restart and undo live pickup on every return to the
 * foreground. App.tsx and __tests__/containerComposition.test.ts both build the
 * container here, so the test resolves from exactly what the app is given.
 */
export const composeContainers = (
  t: TFunction<'translation', undefined>,
  navigate: (stack: never, params: never) => void,
  setSurveyVisible: (visible: boolean) => void
) => {
  // With the app's logger, so the container's own start-up lines (for example
  // the Askar scan shim's result) reach the log and problem reports; without
  // one, MainContainer's this.log?.info calls are silently skipped (#650).
  const bifold = new MainContainer(container.createChildContainer(), BCLogger).init()
  const app = new AppContainer(bifold, t, navigate, setSurveyVisible).init()
  return { bifold, app }
}

/** The container the app is given: the child (see above). */
export const composeAppContainer = (...args: Parameters<typeof composeContainers>) => composeContainers(...args).app

/**
 * The container the app is given, built once per mount of App: a new one only when one of its inputs changes (the
 * translation function, which changes with the language). Built in App's render body, a new pair of containers came
 * with every render of App, and App renders again on every launch: HotUpdater.wrap re-renders it once its update check
 * finishes. Each rebuild gave every useServices consumer new instances, ran MainContainer.init's start-up work again,
 * and left another of the logger's event listeners behind (AppContainer.init's startEventListeners).
 */
export const useAppContainer = (...args: Parameters<typeof composeContainers>) => {
  const [t, navigate, setSurveyVisible] = args
  return useMemo(() => composeAppContainer(t, navigate, setSurveyVisible), [t, navigate, setSurveyVisible])
}
