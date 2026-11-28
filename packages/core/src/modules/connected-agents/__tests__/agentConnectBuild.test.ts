/**
 * Agent connect and its rooms tier are absent from a store build (decided 2026-11-28 by Alberto): without
 * `KEYRING_AGENT_CONNECT_BUILD=1` baked into the build, both switches read off and setting them does nothing. Each
 * case loads the three modules fresh against its own `react-native-config`, as a store build or a development build
 * would see it.
 */

type Modules = {
  build: typeof import('../agentConnectBuild')
  connect: typeof import('../agentConnectFlag')
  rooms: typeof import('../agentRoomsFlag')
}

/**
 * The modules as a build whose `.env` gave `react-native-config` these values: loaded fresh, with that fresh registry's
 * own `react-native-config` object holding exactly them. Returns that object too, which the build value is read from on
 * every call.
 */
function loadAs(values: Record<string, string | undefined>): Modules & { config: Record<string, string | undefined> } {
  let loaded: (Modules & { config: Record<string, string | undefined> }) | undefined
  jest.isolateModules(() => {
    const rnc = require('react-native-config')
    const config: Record<string, string | undefined> = rnc.default ?? rnc.Config
    delete config.KEYRING_AGENT_CONNECT_BUILD
    Object.assign(config, values)
    loaded = {
      config,
      build: require('../agentConnectBuild'),
      connect: require('../agentConnectFlag'),
      rooms: require('../agentRoomsFlag'),
    }
  })
  if (!loaded) throw new Error('modules did not load')
  return loaded
}

/** Turn both switches on, as the Developer screen would, and read them back. */
function tryToTurnOn(m: Modules) {
  m.connect.setAgentConnectEnabled(true)
  m.rooms.setAgentRoomsEnabled(true)
  return { connect: m.connect.isAgentConnectEnabled(), rooms: m.rooms.isAgentRoomsEnabled() }
}

describe('a store build: no KEYRING_AGENT_CONNECT_BUILD', () => {
  it('carries no agent connect: both switches stay off when set, and the build reads unavailable', () => {
    const m = loadAs({})
    expect(m.build.agentConnectAvailableInBuild()).toBe(false)
    expect(tryToTurnOn(m)).toEqual({ connect: false, rooms: false })
  })

  it('a value other than exactly 1 is a store build too', () => {
    for (const value of ['', ' ', '0', 'true', 'yes', '11', 'on']) {
      const m = loadAs({ KEYRING_AGENT_CONNECT_BUILD: value })
      expect([value, m.build.agentConnectAvailableInBuild()]).toEqual([value, false])
      expect([value, tryToTurnOn(m)]).toEqual([value, { connect: false, rooms: false }])
    }
  })

  it('a setter called while unavailable stores nothing: the switch reads off even once the build would allow it', () => {
    const m = loadAs({})
    m.connect.setAgentConnectEnabled(true)
    m.rooms.setAgentRoomsEnabled(true)
    // The same modules, now reading a build with the key (the value is read on every call): what the setters were
    // given while unavailable was not kept.
    m.config.KEYRING_AGENT_CONNECT_BUILD = '1'
    expect(m.build.agentConnectAvailableInBuild()).toBe(true)
    expect(m.connect.isAgentConnectEnabled()).toBe(false)
    expect(m.rooms.isAgentRoomsEnabled()).toBe(false)
  })
})

describe('CONTROL: a development or test build, KEYRING_AGENT_CONNECT_BUILD=1', () => {
  it('both switches start off, and turn on when set', () => {
    const m = loadAs({ KEYRING_AGENT_CONNECT_BUILD: '1' })
    expect(m.build.agentConnectAvailableInBuild()).toBe(true)
    expect({ connect: m.connect.isAgentConnectEnabled(), rooms: m.rooms.isAgentRoomsEnabled() }).toEqual({
      connect: false,
      rooms: false,
    })
    expect(tryToTurnOn(m)).toEqual({ connect: true, rooms: true })
  })

  it('whitespace around the 1 is still on', () => {
    expect(loadAs({ KEYRING_AGENT_CONNECT_BUILD: ' 1\n' }).build.agentConnectAvailableInBuild()).toBe(true)
  })

  it('the rooms switch still needs agent connect on', () => {
    const m = loadAs({ KEYRING_AGENT_CONNECT_BUILD: '1' })
    m.rooms.setAgentRoomsEnabled(true)
    expect(m.rooms.isAgentRoomsEnabled()).toBe(false)
    m.connect.setAgentConnectEnabled(true)
    expect(m.rooms.isAgentRoomsEnabled()).toBe(true)
  })
})
