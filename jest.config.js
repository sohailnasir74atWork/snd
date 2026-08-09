module.exports = {
  preset: '@react-native/jest-preset',
  // The rules tests are a different kind of test: Node environment, Firebase
  // web SDK, and a live Firestore emulator on 8080. Under this preset the
  // module mapper rewrites the web SDK into native modules that do not exist
  // here, so they fail to even load. They have their own config and their own
  // script — `npm run test:rules`.
  testPathIgnorePatterns: ['/node_modules/', '/firestore-tests/'],
};
