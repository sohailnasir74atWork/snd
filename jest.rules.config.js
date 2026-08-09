/**
 * Rules tests run in Node against the Firestore emulator, NOT under the React
 * Native preset — they load the Firebase web SDK, which the RN preset's module
 * mapper would rewrite into native modules that do not exist here.
 *
 * Run with `npm run test:rules`, which starts the emulator around them. Running
 * plain `jest --config jest.rules.config.js` with no emulator fails with a
 * connection error, which is the correct and obvious failure.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/firestore-tests/**/*.test.js'],
  // The emulator is a real process; the first connection can be slow on a cold
  // JVM, and every test does a real round-trip.
  testTimeout: 20000,
};
