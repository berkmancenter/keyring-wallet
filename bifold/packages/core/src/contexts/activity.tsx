import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppState, AppStateStatus, PanResponder, View } from 'react-native'
import { TOKENS, useServices } from '../container-api'
import { LockoutReason, useAuth } from './auth'
import { useStore } from './store'
import { defaultAutoLockTime } from '../constants'
import { effectiveDefaultAutoLockMinutes } from '../utils/e2eClocks'
import { useAppAgent } from '../utils/agent'
import { notifyReturnLocked } from '../utils/otaApply'

// number of minutes before the timeout action is triggered
// a value of 0 will never trigger the lock out action and
// an undefined value will default to 5 minutes
export const AutoLockTime = {
  OneHour: 60,
  OneMinute: 1,
  ThreeMinutes: 3,
  FiveMinutes: 5,
  Never: 0,
} as const

export interface ActivityContext {
  appStateStatus: AppStateStatus
  /**
   * Keep the app from locking for inactivity while something the person is
   * watching runs in the foreground (a wait for an agent, which needs no
   * touch). While a hold is open the inactivity timer re-arms instead of
   * locking; the last release starts a fresh full timeout. Every hold lapses
   * on its own after `forMs`, so one never released (a bug) cannot keep the
   * phone unlocked: it locks at most one timeout after the hold lapses. Going
   * to the background is unaffected. Returns the release; calling it twice is safe.
   */
  holdLock: (forMs: number) => () => void
}

export const ActivityContext = createContext<ActivityContext>(null as unknown as ActivityContext)

export const ActivityProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [logger, { customAutoLockTimes }, messagePickup] = useServices([
    TOKENS.UTIL_LOGGER,
    TOKENS.CONFIG,
    TOKENS.UTIL_MESSAGE_PICKUP,
  ])
  const [store] = useStore()
  const { agent } = useAppAgent()
  const { lockOutUser } = useAuth()
  const lastActiveTimeRef = useRef<number | undefined>(undefined)
  const defaultAutoLockoutTime = effectiveDefaultAutoLockMinutes(
    customAutoLockTimes?.default?.time ?? defaultAutoLockTime
  )
  const timeoutInMilliseconds = useRef<number>((store.preferences.autoLockTime ?? defaultAutoLockoutTime) * 60000)
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Open holds, each with the time it lapses.
  const holdsRef = useRef(new Map<number, number>())
  const nextHoldRef = useRef(0)
  const prevAppStateStatusRef = useRef(AppState.currentState)
  const [appStateStatus, setAppStateStatus] = useState<AppStateStatus>(AppState.currentState)

  if (!agent) {
    throw new Error('ActivityProvider must be used within agent context provider')
  }

  const clearInactivityTimeoutIfExists = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current)
    }
  }, [])

  const resetInactivityTimeout = useCallback(
    (milliseconds: number) => {
      const arm = () => {
        clearInactivityTimeoutIfExists()
        lastActiveTimeRef.current = Date.now()

        // do not set timeout if timeout duration is set to 0
        if (milliseconds > 0) {
          // create new timeout; a hold re-arms it instead of locking, and counts
          // as activity, so time held never counts toward a later lock
          inactivityTimeoutRef.current = setTimeout(
            () =>
              [...holdsRef.current.values()].some((until) => until > Date.now())
                ? arm()
                : lockOutUser(LockoutReason.Timeout),
            milliseconds
          )
        }
      }
      arm()
    },
    [clearInactivityTimeoutIfExists, lockOutUser]
  )

  const holdLock = useCallback(
    (forMs: number) => {
      const id = ++nextHoldRef.current
      holdsRef.current.set(id, Date.now() + Math.max(0, forMs))
      let released = false
      return () => {
        if (released) return
        released = true
        holdsRef.current.delete(id)
        // The last hold gone: a fresh full timeout, unless the app is in the
        // background, where no timer runs.
        if (holdsRef.current.size === 0 && AppState.currentState !== 'background') {
          resetInactivityTimeout(timeoutInMilliseconds.current)
        }
      }
    },
    [resetInactivityTimeout]
  )

  useEffect(() => {
    // listener for backgrounding / foregrounding
    const eventSubscription = AppState.addEventListener('change', async (nextAppState) => {
      // if going into the background
      if (['active', 'inactive'].includes(prevAppStateStatusRef.current) && nextAppState === 'background') {
        // remove timeout when backgrounded as timeout refs can be lost when app is backgrounded
        clearInactivityTimeoutIfExists()
        try {
          await messagePickup.onBackground(agent)
          logger.info('Stopped agent message pickup')
        } catch (err) {
          logger.error(`Error stopping agent message pickup, ${err}`)
        }
      }

      // if coming to the foreground
      if (prevAppStateStatusRef.current === 'background' && ['active', 'inactive'].includes(nextAppState)) {
        // if app was in background for longer than allowed time, lock out user
        if (
          lastActiveTimeRef.current &&
          Date.now() - lastActiveTimeRef.current >= timeoutInMilliseconds.current &&
          timeoutInMilliseconds.current > 0
        ) {
          lockOutUser(LockoutReason.Timeout)
          // The person lands on the PIN screen: the one moment the app may apply a
          // downloaded update (utils/otaApply).
          notifyReturnLocked(Date.now() - lastActiveTimeRef.current)
        } else {
          // otherwise restart message pickup, the way the app picks up
          // (TOKENS.UTIL_MESSAGE_PICKUP; utils/messagePickupLifecycle.ts)
          try {
            await messagePickup.onForeground(agent)
            logger.info('Restarted agent message pickup')
          } catch (err) {
            logger.error(`Error restarting agent message pickup, ${err}`)
          }
        }

        // app coming into the foreground is 'user activity', reset timeout
        resetInactivityTimeout(timeoutInMilliseconds.current)
      }

      prevAppStateStatusRef.current = nextAppState
      setAppStateStatus(nextAppState)
    })

    // initial timeout setup
    resetInactivityTimeout(timeoutInMilliseconds.current)

    return () => {
      clearInactivityTimeoutIfExists()
      eventSubscription.remove()
    }
  }, [clearInactivityTimeoutIfExists, lockOutUser, resetInactivityTimeout, agent, logger, messagePickup])

  useEffect(() => {
    // user has updated settings for auto lock time
    timeoutInMilliseconds.current = (store.preferences.autoLockTime ?? defaultAutoLockoutTime) * 60000
  }, [store.preferences.autoLockTime, defaultAutoLockoutTime])

  const panResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        // some user interaction detected, reset timeout
        resetInactivityTimeout(timeoutInMilliseconds.current)

        // returns false so the PanResponder doesn't consume the touch event
        return false
      },
    })
  }, [resetInactivityTimeout])

  return (
    <ActivityContext.Provider value={{ appStateStatus, holdLock }}>
      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
        {children}
      </View>
    </ActivityContext.Provider>
  )
}
export const useActivity = () => useContext(ActivityContext)
