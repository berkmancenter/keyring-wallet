/**
 * Runs `run` at most once at a time: a call made while a run is in flight gets
 * that run's promise instead of starting another. Once it settles, resolved or
 * rejected, the next call starts afresh.
 *
 * A joined call's arguments are ignored: it gets the run already in flight,
 * started with the first call's arguments. Join only where any caller would
 * have got the same result (agent start: the mediator is chosen before the
 * start begins, and every caller passes the same wallet secret).
 *
 * `inFlight` is kept by the caller (a React ref), so the guard outlives the
 * function it wraps: a hook's callback is rebuilt whenever its dependencies
 * change, and the run in flight must still be seen by the rebuilt one.
 */
export const singleFlight = <A extends unknown[], R>(
  inFlight: { current: Promise<R> | null },
  run: (...args: A) => Promise<R>
): ((...args: A) => Promise<R>) => {
  return (...args: A) => {
    if (inFlight.current) return inFlight.current
    const current = run(...args).finally(() => {
      if (inFlight.current === current) inFlight.current = null
    })
    inFlight.current = current
    return current
  }
}
