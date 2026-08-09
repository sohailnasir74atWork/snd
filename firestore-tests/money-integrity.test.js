/**
 * Privilege inside one company — the rules that stop a modified client from
 * stealing.
 *
 * Tenant isolation (the other file) stops company B. This file stops company
 * A's own booker and rider, which is the likelier attack: they have a real
 * login, they know what the money is worth, and the app is a cash app.
 *
 * Every assertion here maps to a line in PROGRESS.md §4 "Money integrity
 * rules". If one of these ever goes green-to-red, a staff phone can move money
 * it should not.
 */
const {
  co, setup, teardown, clear, as, seed, patch, assertFails, assertSucceeds,
} = require('./helpers');

beforeAll(setup);
afterAll(teardown);

const admin = () => as('a-admin', co(), 'admin');
const booker = () => as('a-booker', co(), 'booker');
const rider = () => as('a-rider', co(), 'rider');

const payment = (over = {}) => ({
  receiptNo: 'RCP-2026-0001', shopId: 's1', amount: 500,
  collectedBy: 'a-rider', confirmed: false, ...over,
});

describe('payments — cash cannot be minted', () => {
  test('a rider records cash he collected', async () => {
    await assertSucceeds(rider().doc(`companies/${co()}/payments/p1`).set(payment()));
  });

  test('nobody can create cash that is already confirmed', async () => {
    // Without this, a modified client mints confirmed money that the owner
    // never counted and every total believes.
    await assertFails(rider().doc(`companies/${co()}/payments/p1`).set(payment({ confirmed: true })));
    await assertFails(admin().doc(`companies/${co()}/payments/p1`).set(payment({ confirmed: true, collectedBy: 'a-admin' })));
  });

  test('nobody can attribute cash to someone else', async () => {
    await assertFails(rider().doc(`companies/${co()}/payments/p1`).set(payment({ collectedBy: 'a-booker' })));
  });

  test('amounts must be positive integers', async () => {
    await assertFails(rider().doc(`companies/${co()}/payments/p1`).set(payment({ amount: 0 })));
    await assertFails(rider().doc(`companies/${co()}/payments/p2`).set(payment({ amount: -500 })));
    await assertFails(rider().doc(`companies/${co()}/payments/p3`).set(payment({ amount: 500.5 })));
  });

  test('a booker may take cash ONLY as a flagged exception (FR-7.13)', async () => {
    await assertFails(booker().doc(`companies/${co()}/payments/p1`)
      .set(payment({ collectedBy: 'a-booker' })));
    await assertSucceeds(booker().doc(`companies/${co()}/payments/p2`)
      .set(payment({ collectedBy: 'a-booker', exception: true })));
  });

  test('only the owner may confirm cash', async () => {
    await seed(db => db.doc(`companies/${co()}/payments/p1`).set(payment()));
    await assertFails(patch(rider().doc(`companies/${co()}/payments/p1`), { confirmed: true }));
    await assertFails(patch(booker().doc(`companies/${co()}/payments/p1`), { confirmed: true }));
    await assertSucceeds(patch(admin().doc(`companies/${co()}/payments/p1`), { confirmed: true }));
  });

  test('payments are append-only — nobody deletes money history', async () => {
    await seed(db => db.doc(`companies/${co()}/payments/p1`).set(payment()));
    await assertFails(rider().doc(`companies/${co()}/payments/p1`).delete());
    await assertFails(admin().doc(`companies/${co()}/payments/p1`).delete());
  });

  test('the owner may void, but not rewrite the amount', async () => {
    await seed(db => db.doc(`companies/${co()}/payments/p1`).set(payment()));
    await assertSucceeds(patch(admin().doc(`companies/${co()}/payments/p1`), { voided: true }));
    await assertFails(patch(admin().doc(`companies/${co()}/payments/p1`), { amount: 99999 }));
  });

  test('staff see only their own receipts', async () => {
    await seed(db => db.doc(`companies/${co()}/payments/p1`).set(payment({ collectedBy: 'a-rider' })));
    await assertSucceeds(rider().doc(`companies/${co()}/payments/p1`).get());
    await assertFails(booker().doc(`companies/${co()}/payments/p1`).get());
  });
});

describe('the handover — only the owner closes a day', () => {
  const day = (over = {}) => ({
    staffId: 'a-rider', date: '2026-08-09', handoverConfirmed: false, ...over,
  });

  test('a rider starts and hands over his own day', async () => {
    await assertSucceeds(rider().doc(`companies/${co()}/days/a-rider_d`).set(day({ routeStarted: true })));
  });

  test('a rider cannot confirm his own cash', async () => {
    await seed(db => db.doc(`companies/${co()}/days/a-rider_d`).set(day({ handedOver: true })));
    await assertFails(patch(rider().doc(`companies/${co()}/days/a-rider_d`), { handoverConfirmed: true }));
    await assertSucceeds(patch(admin().doc(`companies/${co()}/days/a-rider_d`), { handoverConfirmed: true }));
  });

  test('a day cannot be born already confirmed', async () => {
    await assertFails(rider().doc(`companies/${co()}/days/a-rider_e`).set(day({ handoverConfirmed: true })));
  });

  test('a rider cannot write another person\'s day', async () => {
    await assertFails(rider().doc(`companies/${co()}/days/a-booker_d`)
      .set(day({ staffId: 'a-booker' })));
  });
});

describe('margins are owner-only (FR-15.1)', () => {
  test('costPrice may never live on a product document', async () => {
    // Every staff phone syncs products; a cost on that document is a margin
    // leak to everyone in the company.
    await assertFails(admin().doc(`companies/${co()}/products/p1`)
      .set({ name: 'Face Wash', tradePrice: 900, costPrice: 600 }));
    await assertSucceeds(admin().doc(`companies/${co()}/products/p1`)
      .set({ name: 'Face Wash', tradePrice: 900 }));
  });

  for (const [who, ctx] of [['booker', booker], ['rider', rider]]) {
    test(`a ${who} cannot read productCosts`, async () => {
      await seed(db => db.doc(`companies/${co()}/productCosts/p1`).set({ costPrice: 600 }));
      await assertFails(ctx().doc(`companies/${co()}/productCosts/p1`).get());
    });
    test(`a ${who} cannot read expenses`, async () => {
      await seed(db => db.doc(`companies/${co()}/expenses/e1`).set({ amount: 400 }));
      await assertFails(ctx().doc(`companies/${co()}/expenses/e1`).get());
    });
  }
});

describe('the shop khata — a booker never moves a balance (FR-7.10)', () => {
  beforeEach(async () => {
    await seed(db => db.doc(`companies/${co()}/shops/s1`)
      .set({ name: 'Beauty Corner', area: 'Saddar', outstanding: 5000, active: true }));
  });

  test('a booker may keep shop details', async () => {
    await assertSucceeds(patch(booker().doc(`companies/${co()}/shops/s1`), { phone: '923001234567' }));
  });

  test('a booker cannot touch outstanding', async () => {
    await assertFails(patch(booker().doc(`companies/${co()}/shops/s1`), { outstanding: 0 }));
  });

  test('a booker may sign up a counter person — they live ON the shop now', async () => {
    // Counter staff moved out of their own collection and onto the shop, so
    // the shops rules are what governs them. The booker is the one standing at
    // the counter when someone agrees to sell for us.
    await assertSucceeds(patch(booker().doc(`companies/${co()}/shops/s1`), {
      counterStaff: [{ id: 'cs1', name: 'Salman', phone: '923001112233', active: true, addedBy: 'a-booker' }],
    }));
  });

  test('a rider cannot — his whitelist is pins and photos', async () => {
    await assertFails(patch(rider().doc(`companies/${co()}/shops/s1`), {
      counterStaff: [{ id: 'cs1', name: 'Planted', active: true, addedBy: 'a-rider' }],
    }));
  });

  test('the old rewardStaff collection is dead — writing to it fails loudly', async () => {
    // No rule at all now, so the default deny catches an old build that still
    // maintains a second, divergent list instead of letting it drift.
    await assertFails(booker().doc(`companies/${co()}/rewardStaff/x`).set({ name: 'Salman', active: true }));
    await assertFails(admin().doc(`companies/${co()}/rewardStaff/x`).set({ name: 'Salman', active: true }));
  });

  test('only the owner may delete a shop', async () => {
    // Staff never delete. A booker who could would be one tap from erasing a
    // debtor off the round he is standing on.
    await assertFails(booker().doc(`companies/${co()}/shops/s1`).delete());
    await assertFails(rider().doc(`companies/${co()}/shops/s1`).delete());
    await assertSucceeds(patch(admin().doc(`companies/${co()}/shops/s1`), { active: false }));
    await assertSucceeds(admin().doc(`companies/${co()}/shops/s1`).delete());
  });
});

describe('orders — the booker whitelist added this week', () => {
  const order = (over = {}) => ({
    orderNo: 'ORD-2026-0001', bookedBy: 'a-booker', assignedTo: 'a-rider',
    shopId: 's1', status: 'assigned', paymentStatus: 'unpaid', amountPaid: 0,
    deliveryDate: '2026-08-09', ...over,
  });

  beforeEach(async () => {
    await seed(db => db.doc(`companies/${co()}/orders/o1`).set(order()));
  });

  test('a booker may cancel his own order', async () => {
    await assertSucceeds(patch(booker().doc(`companies/${co()}/orders/o1`), { status: 'cancelled' }));
  });

  test('a booker cannot mark his own order delivered and paid', async () => {
    // The hole this closed: a forged delivered order counted as revenue on the
    // owner's dashboard with no cash collected and no payment row to reconcile.
    await assertFails(patch(booker().doc(`companies/${co()}/orders/o1`), {
      status: 'delivered', paymentStatus: 'paid', amountPaid: 14400,
    }));
    await assertFails(patch(booker().doc(`companies/${co()}/orders/o1`), { amountPaid: 14400 }));
    await assertFails(patch(booker().doc(`companies/${co()}/orders/o1`), { invoiceNo: 'INV-FAKE' }));
  });

  test('a booker cannot touch an order he did not book', async () => {
    await seed(db => db.doc(`companies/${co()}/orders/o2`).set(order({ bookedBy: 'someone-else' })));
    await assertFails(patch(booker().doc(`companies/${co()}/orders/o2`), { status: 'cancelled' }));
    await assertFails(booker().doc(`companies/${co()}/orders/o2`).get());
  });

  test('a rider only sees orders addressed to him', async () => {
    await assertSucceeds(rider().doc(`companies/${co()}/orders/o1`).get());
    await seed(db => db.doc(`companies/${co()}/orders/o3`).set(order({ assignedTo: 'other-rider' })));
    await assertFails(rider().doc(`companies/${co()}/orders/o3`).get());
  });

  test('orders are cancelled, never deleted (FR-5.7)', async () => {
    await assertFails(admin().doc(`companies/${co()}/orders/o1`).delete());
  });
});

describe('serial counters only ever go up (§8.1)', () => {
  test('a fresh year starts at one', async () => {
    await assertSucceeds(rider().doc(`companies/${co()}/counters/2026`).set({ invoice: 1 }));
  });

  test('a counter cannot be born mid-sequence', async () => {
    // The hole this closed: create accepted any keys and any values, so a
    // client could seed the year anywhere and re-issue bill numbers that
    // already existed on paper.
    await assertFails(rider().doc(`companies/${co()}/counters/2026`).set({ invoice: 5000 }));
    await assertFails(rider().doc(`companies/${co()}/counters/2026`).set({ nonsense: 1 }));
  });

  test('a counter steps by exactly one', async () => {
    await seed(db => db.doc(`companies/${co()}/counters/2026`).set({ invoice: 10 }));
    await assertSucceeds(patch(rider().doc(`companies/${co()}/counters/2026`), { invoice: 11 }));
  });

  test('a counter can never be rewound', async () => {
    await seed(db => db.doc(`companies/${co()}/counters/2026`).set({ invoice: 10 }));
    await assertFails(patch(rider().doc(`companies/${co()}/counters/2026`), { invoice: 1 }));
    await assertFails(patch(rider().doc(`companies/${co()}/counters/2026`), { invoice: 50 }));
    await assertFails(rider().doc(`companies/${co()}/counters/2026`).delete());
  });
});

describe('settings and areas are the owner\'s (FR-12.1)', () => {
  test('everyone reads settings — every screen depends on them', async () => {
    await seed(db => db.doc(`companies/${co()}/settings/company`).set({ brandName: 'A' }));
    await assertSucceeds(rider().doc(`companies/${co()}/settings/company`).get());
    await assertSucceeds(booker().doc(`companies/${co()}/settings/company`).get());
  });

  test('only the owner writes them', async () => {
    await assertFails(booker().doc(`companies/${co()}/settings/company`).set({ maxDiscountPercent: 90 }));
    await assertSucceeds(admin().doc(`companies/${co()}/settings/company`).set({ maxDiscountPercent: 15 }));
  });

  test('a booker may create a round — he is the one standing in a new street', async () => {
    await assertSucceeds(booker().doc(`companies/${co()}/areas/new1`).set({
      name: 'Bund Road', active: true, createdBy: 'a-booker', createdAt: new Date(),
    }));
  });

  test('but he cannot smuggle a rider or a territory in through the create door', async () => {
    // riderId decides which van every future order in this area goes to;
    // bookerId decides whose shops they are. Both stay the owner's.
    await assertFails(booker().doc(`companies/${co()}/areas/new2`).set({
      name: 'Bund Road', active: true, createdBy: 'a-booker', riderId: 'a-rider',
    }));
    await assertFails(booker().doc(`companies/${co()}/areas/new3`).set({
      name: 'Bund Road', active: true, createdBy: 'a-booker', bookerId: 'a-booker',
    }));
    await assertFails(booker().doc(`companies/${co()}/areas/new4`).set({
      name: 'Retired on arrival', active: false, createdBy: 'a-booker',
    }));
    await assertFails(booker().doc(`companies/${co()}/areas/new5`).set({
      name: 'Someone else', active: true, createdBy: 'a-admin',
    }));
  });

  test('a booker cannot rename or retire an existing round', async () => {
    await seed(db => db.doc(`companies/${co()}/areas/a1`).set({ name: 'Saddar', active: true }));
    await assertFails(patch(booker().doc(`companies/${co()}/areas/a1`), { name: 'Renamed' }));
    await assertFails(patch(booker().doc(`companies/${co()}/areas/a1`), { active: false }));
    await assertFails(rider().doc(`companies/${co()}/areas/r1`).set({ name: 'Rider round', active: true }));
  });

  test('only the owner puts a rider on a round', async () => {
    // Area.riderId decides which van every future order goes to, so a booker
    // who could write it could redirect the company's deliveries.
    await seed(db => db.doc(`companies/${co()}/areas/a1`).set({ name: 'Saddar', active: true }));
    await assertFails(patch(booker().doc(`companies/${co()}/areas/a1`), { riderId: 'a-booker' }));
    await assertSucceeds(patch(admin().doc(`companies/${co()}/areas/a1`), { riderId: 'a-rider' }));
  });
});
