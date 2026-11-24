# Bifold Core Test Failure Analysis

**Test Run Date:** January 21, 2026
**Total Tests:** 736
**Passed:** 716 (97.3%)
**Failed:** 18 (2.4%)
**Skipped:** 2
**Failed Test Suites:** 6 of 114

---

## Summary of Root Causes

### 1. **Mock File Incorrectly Identified as Test Suite** ⚠️ HIGH PRIORITY

**File:** `src/modules/vrc/__tests__/mocks/react-native-zeroconf.ts`

**Issue:** Jest is treating a mock file as a test suite.

**Error:**

```
Your test suite must contain at least one test.
```

**Root Cause:** The file is located in `__tests__` directory but contains no tests. Jest's test regex pattern picks it up.

**Solution:**

- Move to `__mocks__/` directory at package root, OR
- Rename file to not match test pattern, OR
- Add to `testPathIgnorePatterns` in jest.config.js

---

### 2. **WitnessedVRCManager Logic Error** 🔴 CRITICAL

**File:** `src/modules/vrc/__tests__/unit/witnessedVRCManager.test.ts`

**Failed Tests:**

- `isWitnessedExchangeAvailable › should return true when witness is connected and locality verified`
- `getWitnessedExchangeStatus › should return available status message`

**Issue:** The manager incorrectly validates locality proof timestamps.

**Errors:**

```javascript
// Test expects: true
// Actual result: false

// Test expects: "Witnessed exchange available"
// Actual result: "Locality proof expired"
```

**Root Cause:** The `isWitnessedExchangeAvailable` method is checking if the locality proof is expired, but the test provides a valid timestamp. The expiry logic appears to be incorrectly implemented.

**Investigation Needed:**

- Check `src/modules/vrc/witnessed-vrc-manager.ts`
- Verify timestamp comparison logic in locality proof validation
- Confirm expiry window constants

---

### 3. **WitnessHttpClient Test Expectations Mismatch** 🟡 MEDIUM

**File:** `src/modules/vrc/__tests__/unit/witnessClient.test.ts`

**Failed Tests:**

- `verifyLocality › should handle network errors`
- `getWitnessInfo › should fetch witness issuer information`

**Issue 1 - Network Error Handling:**

```javascript
// Test expects: Promise to reject/throw
// Actual: Promise resolves with error object: { verified: false, error: "..." }
```

**Root Cause:** The `verifyLocality` method catches network errors and returns an error response object instead of throwing. The test expects it to throw.

**Solution:** Update test to expect resolved error object, not rejection.

**Issue 2 - Fetch Call Arguments:**

```javascript
// Test expects fetch called with: "http://localhost:9003/api/issuer"
// Actual: fetch called with: "http://localhost:9003/api/issuer", { headers: {...}, method: "GET" }
```

**Root Cause:** Implementation passes options object to fetch, but test only checks URL.

**Solution:** Update test assertion to use `toHaveBeenCalledWith(url, expect.objectContaining({...}))`

---

### 4. **VRC Display Handler Registration** 🟡 MEDIUM

**File:** `__tests__/modules/vrc/display/register.test.ts`

**Failed Test:**

- `registerVrcDisplayHandlers › should register the RelationshipCredentialHandler`

**Issue:**

```javascript
// Test expects: 1 handler registered
// Actual: 2 handlers registered
// Handlers: [WitnessCredential (priority 110), RelationshipCredential (priority 100)]
```

**Root Cause:** The `registerVrcDisplayHandlers` function now registers BOTH `WitnessCredentialHandler` and `RelationshipCredentialHandler`, but the test only expects one.

**Solution:** Update test to expect 2 handlers and verify both types are registered.

---

### 5. **ContactDetails Screen Localization Issues** 🟡 MEDIUM

**File:** `__tests__/modules/vrc/screens/ContactDetails.test.tsx`

**Failed Tests:**

- `Shows View Messages button when connection exists` - Timeout
- `Disables View Messages button when no connection exists`
- `View Messages button has correct accessibility labels`

**Issue:**

```javascript
// Test expects: "View Messages"
// Actual: "ContactDetails.ViewMessages" (localization key not translated)
```

**Root Cause:** The mock i18n setup is not properly translating localization keys. Tests are seeing raw keys instead of translated text.

**Investigation Needed:**

- Check `bifold/packages/core/src/modules/vrc/localization/en.json`
- Verify mock i18n configuration in test setup
- Ensure translation keys match between code and locale files

---

### 6. **ListContacts Screen Localization Issues** 🟡 MEDIUM

**File:** `__tests__/modules/vrc/screens/ListContacts.test.tsx`

**Failed Test:**

- `Renders correctly with no contacts`

**Issue:**

```javascript
// Test expects: "Contacts.YouDoNotHaveAnyContacts"
// Actual: "Contacts.EmptyList" (different key rendered)
```

**Root Cause:** The component is rendering "Contacts.EmptyList" but the test expects "Contacts.YouDoNotHaveAnyContacts". Either:

1. The component implementation changed and test wasn't updated, OR
2. The localization key was renamed

**Solution:** Update test to match current implementation, or fix component to use expected key.

---

## Recommended Action Plan

### Immediate Fixes (Quick Wins)

1. **Fix Mock File Location** (5 min)

   - Move `src/modules/vrc/__tests__/mocks/react-native-zeroconf.ts` to proper location

2. **Update Test Expectations** (15 min)

   - Fix `register.test.ts` to expect 2 handlers
   - Fix `witnessClient.test.ts` mock assertions
   - Update `ListContacts.test.tsx` text expectations

3. **Fix i18n Test Setup** (30 min)
   - Review localization mock configuration
   - Ensure keys are properly translated in tests

### Code Fixes Required

1. **Fix WitnessedVRCManager Locality Logic** (1-2 hours)
   - Debug timestamp validation in `isWitnessedExchangeAvailable`
   - Review locality proof expiry calculation
   - Add test cases for edge cases

### Investigation Required

1. **ContactDetails Component Investigation** (30 min)
   - Determine why connection-based rendering is timing out
   - Verify async data loading in tests

---

## Test Files Requiring Updates

1. `src/modules/vrc/__tests__/mocks/react-native-zeroconf.ts` - Relocate
2. `src/modules/vrc/__tests__/unit/witnessClient.test.ts` - Update assertions
3. `src/modules/vrc/__tests__/unit/witnessedVRCManager.test.ts` - May need updates after code fix
4. `__tests__/modules/vrc/display/register.test.ts` - Update expectations
5. `__tests__/modules/vrc/screens/ListContacts.test.tsx` - Update text expectations
6. `__tests__/modules/vrc/screens/ContactDetails.test.tsx` - Fix i18n setup

## Source Files Likely Needing Fixes

1. `src/modules/vrc/witnessed-vrc-manager.ts` - Locality proof validation logic
2. Possibly `src/modules/vrc/services/witnessClient.ts` - If test expectations are correct

---

## Additional Notes

- **97.3% pass rate** is good overall
- All failures are in VRC (Verifiable Relationship Credential) module - new feature
- Most issues are test maintenance (stale expectations) rather than critical bugs
- The locality proof expiry logic issue is the most concerning as it's core functionality
