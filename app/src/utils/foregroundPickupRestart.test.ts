import { foregroundPickupRestart } from './foregroundPickupRestart'

// 277.6 (iPhone): pickup started three times in 2 s at launch, the last by the foreground handler on the first
// 'active'. 277.4 (Android): two foreground restarts 141 ms apart. Each restart stops and starts the polling loop.
describe('the foreground pickup restart', () => {
  const setup = (initial: string) => {
    const order: string[] = []
    let n = 0
    const restart = jest.fn(async () => {
      const mine = ++n
      order.push(`start ${mine}`)
      await new Promise((resolve) => setImmediate(resolve))
      order.push(`end ${mine}`)
    })
    return { restart, order, restarts: foregroundPickupRestart(restart, initial) }
  }

  it('does not restart on the first active after launch', async () => {
    const { restart, restarts } = setup('unknown')
    await restarts.onAppStateChange('active')
    const fromInactive = setup('inactive')
    await fromInactive.restarts.onAppStateChange('active')
    expect(restart).not.toHaveBeenCalled()
    expect(fromInactive.restart).not.toHaveBeenCalled()
  })

  it('restarts once on each return from the background', async () => {
    const { restart, restarts } = setup('active')
    await restarts.onAppStateChange('inactive')
    await restarts.onAppStateChange('background')
    await restarts.onAppStateChange('active')
    expect(restart).toHaveBeenCalledTimes(1)
    await restarts.onAppStateChange('background')
    await restarts.onAppStateChange('inactive')
    await restarts.onAppStateChange('active')
    expect(restart).toHaveBeenCalledTimes(2)
  })

  it('a second active with no background between does nothing', async () => {
    const { restart, restarts } = setup('active')
    await restarts.onAppStateChange('background')
    await Promise.all([restarts.onAppStateChange('active'), restarts.onAppStateChange('active')])
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('a prompt over the app (active, inactive, active) is not a return', async () => {
    const { restart, restarts } = setup('active')
    await restarts.onAppStateChange('inactive')
    await restarts.onAppStateChange('active')
    expect(restart).not.toHaveBeenCalled()
  })

  it('an app woken in the background restarts on its first active', async () => {
    const { restart, restarts } = setup('background')
    await restarts.onAppStateChange('active')
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('restarts run one after another, never side by side', async () => {
    const { order, restarts } = setup('active')
    void restarts.onAppStateChange('background')
    const first = restarts.onAppStateChange('active')
    void restarts.onAppStateChange('background')
    const second = restarts.onAppStateChange('active')
    await Promise.all([first, second])
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
  })
})
