// Unit tests for pure logic modules (no React Native runtime).
//
// Deliberately NOT jest-expo: the only suites here cover services/util/*,
// which are import-pure by design, so a plain node environment runs them far
// faster and without a native-module mock surface. If a suite ever needs to
// render a component or touch an Expo native module, add a second project
// with the jest-expo preset rather than widening this one.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/services/util/__tests__/**/*.test.ts'],
  // Vendored/bundled trees carry duplicate package.json names that make
  // jest-haste-map warn on every run. Nothing under them is under test.
  modulePathIgnorePatterns: ['<rootDir>/.netlify/', '<rootDir>/site/', '<rootDir>/dist/', '<rootDir>/ios/'],
  // The counter resolves everything through an explicit America/Chicago
  // formatter and an injected clock, so host TZ must not matter. Pinning UTC
  // here means a machine in CT can't accidentally mask a timezone bug.
  globalSetup: '<rootDir>/services/util/__tests__/setTz.js',
};
