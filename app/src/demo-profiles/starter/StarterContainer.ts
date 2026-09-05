import {
  BifoldLogger,
  Container,
  DispatchAction,
  LocalStorageKeys,
  PersistentState,
  PersistentStorage,
  PreferencesState,
  ReducerAction,
  TOKENS,
  TokenMapping,
  initializeVrcModule,
} from '@bifold/core'
import { BrandingOverlayType, DefaultOCABundleResolver } from '@bifold/oca/build/legacy'
import { DependencyContainer } from 'tsyringe'

import { demoOCABundles } from './ocaBundles'
import StarterHomeHeader from './StarterHomeHeader'

/**
 * The smallest container that actually runs — the one to copy.
 *
 * `app/container-imp.ts` is the real thing and is 421 lines, of which roughly
 * fifteen are the container mechanism and the rest is Keyring's own product:
 * BC Government credential-definition caches, a PersonCredential notification
 * flow, ledger configuration, help-action overrides. All of that is correct
 * for Keyring and noise for someone standing up their own use case, who has
 * to read the whole file to find the handful of lines that show how to
 * override one token.
 *
 * This file is those lines. Every registration below is an *example of a
 * kind* — swap the payload, keep the shape:
 *
 *   registerInstance(<token>, <your thing>)
 *
 * To use it, swap the container App.tsx builds:
 *
 *   const container = new StarterContainer(bifoldContainer).init()
 *
 * The DI mechanism itself needs nothing new: `container-api.ts`'s tokens are
 * already how Keyring overrides core, and this is the same mechanism with
 * Keyring's payload removed.
 */
export class StarterContainer implements Container {
  private _container: DependencyContainer
  private logger = new BifoldLogger()
  private storage: PersistentStorage<PersistentState>

  public constructor(bifoldContainer: Container) {
    // A child container: everything core registered stays resolvable, and
    // anything registered here shadows it.
    this._container = bifoldContainer.container.createChildContainer()
    this.storage = new PersistentStorage(this.logger)
  }

  public get container(): DependencyContainer {
    return this._container
  }

  public init(): Container {
    // 1. Replace a component. Any COMPONENT_* / SCREEN_* token works the same
    //    way — see TOKENS in @bifold/core's container-api.ts for the full set.
    this._container.registerInstance(TOKENS.COMPONENT_HOME_HEADER, StarterHomeHeader)

    // 2. Decide how credentials look. DefaultOCABundleResolver takes bundles
    //    you ship *inside the app*, so a demo needs no OCA hosting and no
    //    network: see ocaBundles.ts. Keyring itself uses
    //    RemoteOCABundleResolver against a git-hosted tree, which is the right
    //    choice in production and an avoidable failure point in a demo.
    this._container.registerInstance(
      TOKENS.UTIL_OCA_RESOLVER,
      new DefaultOCABundleResolver(demoOCABundles, { brandingOverlayType: BrandingOverlayType.Branding10 })
    )

    // 3. Rehydrate persisted state on boot. Keyring's version loads several
    //    app-specific slices; the pattern is this — read a key, dispatch it —
    //    at whatever length your own state needs.
    this._container.registerInstance(TOKENS.LOAD_STATE, async (dispatch: React.Dispatch<ReducerAction<unknown>>) => {
      const preferences = (await this.storage.getValueForKey(LocalStorageKeys.Preferences)) as
        | PreferencesState
        | undefined
      if (preferences) {
        dispatch({ type: DispatchAction.PREFERENCES_UPDATED, payload: [preferences] })
      }
    })

    // 4. Turn on the VRC module — relationship credentials, the witness
    //    ceremony, R-Cards. Anything credential-shaped in this repo rides it.
    initializeVrcModule(this._container)

    this._container.registerInstance(TOKENS.UTIL_LOGGER, this.logger)

    return this
  }

  public resolve<K extends keyof TokenMapping>(token: K): TokenMapping[K] {
    return this._container.resolve(token) as TokenMapping[K]
  }

  public resolveAll<K extends keyof TokenMapping, T extends K[]>(
    tokens: [...T]
  ): { [I in keyof T]: TokenMapping[T[I]] } {
    return tokens.map((key) => this.resolve(key)!) as { [I in keyof T]: TokenMapping[T[I]] }
  }
}
