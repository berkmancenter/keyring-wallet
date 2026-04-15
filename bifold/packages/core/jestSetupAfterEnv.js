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
  } catch (e) {
    // Module may not be loaded yet, that's okay
  }
})
