import { setAgentConnectEnabled } from '../agentConnectFlag'
import { isAgentRoomsEnabled, setAgentRoomsEnabled } from '../agentRoomsFlag'

describe('agentRoomsFlag', () => {
  afterEach(() => {
    setAgentRoomsEnabled(false)
    setAgentConnectEnabled(false)
  })

  it('is off by default, with agent connect off and with it on', () => {
    expect(isAgentRoomsEnabled()).toBe(false)
    setAgentConnectEnabled(true)
    expect(isAgentRoomsEnabled()).toBe(false)
  })

  it('is on only when its own switch and agent connect are both on', () => {
    setAgentRoomsEnabled(true)
    expect(isAgentRoomsEnabled()).toBe(false)
    setAgentConnectEnabled(true)
    expect(isAgentRoomsEnabled()).toBe(true)
    setAgentConnectEnabled(false)
    expect(isAgentRoomsEnabled()).toBe(false)
  })

  // control: the rooms switch alone turns nothing on; a flag that ignored agent connect would read true here.
  it('stays off when agent connect is off, whatever its own switch says', () => {
    setAgentRoomsEnabled(true)
    setAgentConnectEnabled(false)
    expect(isAgentRoomsEnabled()).toBe(false)
  })
})
