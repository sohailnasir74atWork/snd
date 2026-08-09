module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // The rules tests are plain Node + jest, not React Native. Without this
      // the shared globals (`expect`, `beforeAll`, `test`) read as undefined
      // and the suite that guards tenant isolation fails lint for a reason
      // that has nothing to do with it.
      files: ['firestore-tests/**/*.js'],
      env: { node: true, jest: true },
    },
  ],
};
