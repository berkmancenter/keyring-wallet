import { agentConnectAvailableInBuild } from '../agentConnectBuild'

// The package's tests run as a development build: the shared jest setup (jestSetup.js) gives react-native-config
// KEYRING_AGENT_CONNECT_BUILD=1, so the suites that turn agent connect on keep working. A suite that needs a store build
// mocks react-native-config itself (agentConnectBuild.test.ts).
it('the shared jest setup makes this a development build, with agent connect in it', () => {
  expect(agentConnectAvailableInBuild()).toBe(true)
})
