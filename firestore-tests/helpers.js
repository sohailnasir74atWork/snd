/**
 * Shared harness for the rules tests.
 *
 * `firestore.rules` is the ONLY thing standing between one distribution
 * business and another's shop list, margins and khata. Until now no machine
 * had ever checked it — the comment at the top of the rules file claims an
 * emulator suite runs on every change, and there wasn't one.
 *
 * The personas below are the whole point: every test is written as "this
 * person, from this company, tries this", and the ones that matter most are
 * the OUTSIDER cases — a signed-in Google account with no claims at all, and a
 * fully legitimate admin of a DIFFERENT company. Those two are what a
 * multi-tenant Firestore has to refuse, every time, on every collection.
 */
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'snd-rules-test';

/** The two companies every test plays off against each other. */
const A = 'companyA';
const B = 'companyB';

/**
 * Each test gets its OWN pair of company ids.
 *
 * Sharing `companyA` across 240 tests and wiping between them looked tidy and
 * was quietly flaky: `clearFirestore()` empties the server but the clients keep
 * their own view, and a denied write sits in a client's mutation queue and
 * retries. Failures moved between runs and every one of them passed in
 * isolation — the classic shape of a suite you cannot trust.
 *
 * Namespacing by test name means no test can observe another's data, so there
 * is nothing to clear and nothing to race. Slightly more documents in the
 * emulator, which is free and lives for eight seconds.
 */
function testKey() {
  const state = typeof expect !== 'undefined' && expect.getState ? expect.getState() : null;
  const name = (state && state.currentTestName) || 'setup';
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(-60) || 'x';
}

/** This test's company A. */
function co() { return `${A}_${testKey()}`; }
/** This test's company B — a real, unrelated business. */
function cob() { return `${B}_${testKey()}`; }

let testEnv;

/**
 * One Firestore client per persona, for the life of the run.
 *
 * Not an optimisation — a correctness fix. Every `authenticatedContext()` call
 * builds a NEW client with its own gRPC stream, and a test that named three
 * personas built three more. With `clearFirestore()` running between tests,
 * those extra clients race the wipe: a write still in flight on one connection
 * lands after the clear, or a read arrives before the seed settles, and tests
 * fail in ways that vanish the moment you run them alone. (They did — five of
 * them, and every one passed in isolation.)
 *
 * A fixed handful of long-lived clients removes the race entirely.
 */
const clients = new Map();

async function setup() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  return testEnv;
}

async function teardown() {
  clients.clear();
  if (testEnv) await testEnv.cleanup();
}

async function clear() {
  if (testEnv) await testEnv.clearFirestore();
}

function client(key, make) {
  if (!clients.has(key)) clients.set(key, make());
  return clients.get(key);
}

/**
 * A signed-in phone, with the claims `admitSignIn` would have minted for it.
 *
 * The rules never do a lookup — identity rides in the token — so this is
 * exactly the surface a real device presents.
 */
function as(uid, companyId, role) {
  return client(`${uid}|${companyId}|${role}`,
    () => testEnv.authenticatedContext(uid, { companyId, role }).firestore());
}

/**
 * Signed in to Google, admitted to nothing. This is the persona that found the
 * `days` hole: a real Firebase user with NO companyId and NO role, which is
 * what every "not_on_list" sign-in leaves behind.
 */
function asStranger(uid = 'stranger') {
  return client(`stranger|${uid}`,
    () => testEnv.authenticatedContext(uid, {}).firestore());
}

/** Not signed in at all. */
function asAnon() {
  return client('anon', () => testEnv.unauthenticatedContext().firestore());
}

/**
 * An UPDATE, expressed as a merging set.
 *
 * `update()` carries a CLIENT-side precondition — the document must exist in
 * the client's view — and the memoised clients above keep an in-memory cache
 * that `clearFirestore()` does not invalidate. So a doc seeded fresh each test
 * looks absent to a client that watched the previous one get wiped, and
 * `update()` fails with NOT_FOUND before the rules are ever consulted.
 *
 * `set(..., {merge:true})` on an existing document is an `update` to Firestore
 * rules — identical `request.resource.data` and `resource.data`, identical
 * `diff().affectedKeys()` — with no such precondition. Same thing tested, no
 * cache to trip over.
 */
function patch(ref, data) {
  return ref.set(data, { merge: true });
}

/** Seed data past the rules — this is how a document gets to exist at all. */
async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await fn(ctx.firestore());
  });
}

module.exports = {
  A, B, co, cob, PROJECT_ID,
  setup, teardown, clear,
  as, asStranger, asAnon, seed, patch,
  assertFails, assertSucceeds,
};
