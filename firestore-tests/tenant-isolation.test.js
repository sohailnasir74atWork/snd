/**
 * The deny matrix: can anyone from company B touch company A's data?
 *
 * Every collection under `companies/{id}` gets the same treatment, from four
 * angles that between them cover how a real breach would arrive:
 *
 *   - company B's ADMIN — the dangerous one. A legitimate, fully-claimed user
 *     of a real business, doing what any customer could do by changing one
 *     string in a modified client.
 *   - company B's booker and rider — the same, with less privilege.
 *   - a STRANGER — signed in to Google, admitted to nothing. This is what
 *     every "not_on_list" sign-in leaves sitting there, and it is the persona
 *     that found the `days` hole.
 *   - anonymous — not signed in at all.
 *
 * A test that only checks "A can read A" proves nothing. The point of all of
 * these is the refusal.
 */
const {
  co, cob, setup, teardown, clear,
  as, asStranger, asAnon, seed, patch,
  assertFails, assertSucceeds,
} = require('./helpers');

beforeAll(setup);
afterAll(teardown);

/** Every collection the app writes under a company, with a plausible document. */
const COLLECTIONS = {
  shops: { name: 'Beauty Corner', area: 'Saddar', outstanding: 5000, active: true },
  products: { name: 'Face Wash', code: 'FW-01', tradePrice: 900, stockQty: 10, committedQty: 0 },
  areas: { name: 'Saddar', active: true },
  orders: {
    orderNo: 'ORD-2026-0001', bookedBy: 'a-booker', assignedTo: 'a-rider',
    shopId: 's1', status: 'assigned', paymentStatus: 'unpaid', amountPaid: 0,
    deliveryDate: '2026-08-09',
  },
  payments: {
    receiptNo: 'RCP-2026-0001', shopId: 's1', amount: 500,
    collectedBy: 'a-rider', confirmed: false,
  },
  days: { staffId: 'a-rider', date: '2026-08-09', handoverConfirmed: false },
  expenses: { amount: 400, category: 'petrol' },
  fixedCharges: { amount: 20000, name: 'Rent', active: true },
  productCosts: { costPrice: 600 },
  employeeList: { email: 'x@y.com', name: 'X', role: 'rider', joined: true, removed: false },
  rewardClaims: { by: 'a-booker', staffId: 'rs1', pieces: 5, amount: 200, status: 'pending' },
  floatMovements: { staffId: 'a-rider', amount: 2000, kind: 'issue' },
  stockMovements: { productId: 'p1', delta: 10, note: 'restock' },
  handovers: { staffId: 'a-rider', amount: 5000 },
  counters: { order: 1 },
  settings: { brandName: 'Company A' },
  users: { name: 'Someone', email: 'a@b.com', role: 'rider', active: true },
};

const OUTSIDERS = [
  ['company B admin', () => as('b-admin', cob(), 'admin')],
  ['company B booker', () => as('b-booker', cob(), 'booker')],
  ['company B rider', () => as('b-rider', cob(), 'rider')],
  ['a signed-in stranger with no claims', () => asStranger()],
  ['an anonymous caller', () => asAnon()],
];

describe('cross-tenant READ is refused on every collection', () => {
  for (const [collection, doc] of Object.entries(COLLECTIONS)) {
    for (const [who, ctx] of OUTSIDERS) {
      test(`${who} cannot read companies/A/${collection}`, async () => {
        await seed(db => db.doc(`companies/${co()}/${collection}/doc1`).set(doc));
        await assertFails(ctx().doc(`companies/${co()}/${collection}/doc1`).get());
      });
    }
  }
});

describe('cross-tenant WRITE is refused on every collection', () => {
  for (const [collection, doc] of Object.entries(COLLECTIONS)) {
    for (const [who, ctx] of OUTSIDERS) {
      test(`${who} cannot write companies/A/${collection}`, async () => {
        await assertFails(ctx().doc(`companies/${co()}/${collection}/planted`).set(doc));
      });
    }
  }
});

describe('cross-tenant LIST is refused', () => {
  // A rule that denies get() but permits list() leaks the whole collection to
  // anyone who asks for it as a query instead of a document.
  for (const collection of Object.keys(COLLECTIONS)) {
    test(`company B admin cannot list companies/A/${collection}`, async () => {
      await seed(db => db.doc(`companies/${co()}/${collection}/doc1`).set(COLLECTIONS[collection]));
      await assertFails(as('b-admin', cob(), 'admin').collection(`companies/${co()}/${collection}`).get());
    });
  }
});

describe('cross-tenant DELETE — shops, the one collection that permits it', () => {
  // Every other collection denies delete outright, so the default rule carries
  // them. Shops now allow it for an ADMIN, which makes "which company's admin"
  // load-bearing for the first time: `isAdmin()` reads the companyId off the
  // caller's own token, and this is the test that says so.
  for (const [who, ctx] of OUTSIDERS) {
    test(`${who} cannot delete a shop of company A`, async () => {
      await seed(db => db.doc(`companies/${co()}/shops/doc1`).set(COLLECTIONS.shops));
      await assertFails(ctx().doc(`companies/${co()}/shops/doc1`).delete());
    });
  }
});

describe('the company document itself', () => {
  test('its own member reads it', async () => {
    await seed(db => db.doc(`companies/${co()}`).set({ businessName: 'A' }));
    await assertSucceeds(as('a-rider', co(), 'rider').doc(`companies/${co()}`).get());
  });

  test('another company cannot read it', async () => {
    await seed(db => db.doc(`companies/${co()}`).set({ businessName: 'A' }));
    await assertFails(as('b-admin', cob(), 'admin').doc(`companies/${co()}`).get());
  });

  test('nobody can write it — admitSignIn owns this document', async () => {
    await assertFails(as('a-admin', co(), 'admin').doc(`companies/${co()}`).set({ businessName: 'hijacked' }));
  });
});

describe('employeeDirectory is server-only — it is the door', () => {
  // The directory decides which company an email belongs to. A client that
  // could write it could add itself to any business in the system.
  const paths = ['employeeDirectory/victim@example.com'];
  for (const p of paths) {
    test(`an admin cannot read ${p}`, async () => {
      await seed(db => db.doc(p).set({ companyId: co(), role: 'admin' }));
      await assertFails(as('a-admin', co(), 'admin').doc(p).get());
    });
    test(`an admin cannot write ${p}`, async () => {
      await assertFails(as('a-admin', co(), 'admin').doc(p).set({ companyId: co(), role: 'admin' }));
    });
  }
});

describe('the days hole, specifically', () => {
  // The regression test for the live bug: create AND update both omitted
  // inCompany(), so any Google account could plant documents in any tenant's
  // days collection just by putting its own uid in staffId.
  test('a stranger cannot create a day in someone else\'s company', async () => {
    await assertFails(
      asStranger('drive-by').doc(`companies/${co()}/days/drive-by_2026-08-09`)
        .set({ staffId: 'drive-by', date: '2026-08-09', handoverConfirmed: false }),
    );
  });

  test('company B\'s rider cannot create a day in company A', async () => {
    await assertFails(
      as('b-rider', cob(), 'rider').doc(`companies/${co()}/days/b-rider_2026-08-09`)
        .set({ staffId: 'b-rider', date: '2026-08-09', handoverConfirmed: false }),
    );
  });

  test('a stranger cannot update an existing day in someone else\'s company', async () => {
    await seed(db => db.doc(`companies/${co()}/days/drive-by_2026-08-09`)
      .set({ staffId: 'drive-by', date: '2026-08-09', handoverConfirmed: false }));
    await assertFails(
      patch(asStranger('drive-by').doc(`companies/${co()}/days/drive-by_2026-08-09`),
        { routeStarted: true }),
    );
  });

  test('but a real member still starts his own day', async () => {
    await assertSucceeds(
      as('a-rider', co(), 'rider').doc(`companies/${co()}/days/a-rider_2026-08-09`)
        .set({ staffId: 'a-rider', date: '2026-08-09', handoverConfirmed: false, routeStarted: true }),
    );
  });
});
