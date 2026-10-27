/* eslint-disable no-undef */
// This runs after Jest environment is set up, so Jest globals like beforeEach are available

// Clear notification exclusion list before each test to prevent cross-test pollution
beforeEach(() => {
  // Dynamic import to avoid issues with module resolution timing
  try {
    const { clearExcludedNotificationConnectionIds } = require('./src/hooks/notifications')
    if (clearExcludedNotificationConnectionIds) {
      clearExcludedNotificationConnectionIds()
    }
  } catch (_e) {
    // Module may not be loaded yet, that's okay
  }
})

// RNTL's async helpers (waitFor, findBy*) give an awaited read 1000 ms by default, which is a budget, not a
// correctness bound: a test that reads state produced by a mocked async call fails on a loaded machine while
// passing on an idle one. jest's own testTimeout is 12 s, so the 1 s cliff is the narrower limit and the one
// that flakes. 3000 ms leaves room for a slow CI runner, still fails a genuinely hung read well inside
// testTimeout (three sequential waits fit inside the 12 s), and stays under the 4 s the hang detector
// treats as hung, so a real hang still reads as a hang rather than as a budget overrun.
require('@testing-library/react-native').configure({ asyncUtilTimeout: 3000 })
