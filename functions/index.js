/**
 * SnD Manager — the project's single Cloud Functions file (Plan §2: exactly
 * one function deployment; anything more is a change note).
 *
 * admitSignIn — the only door into the app (SRS FR-1.1–1.10, §10.1):
 *   - "Create your business" bootstraps a workspace with the caller as admin
 *   - everyone else must already be on some company's employeeDirectory
 *   - admission writes {companyId, role} into custom claims, so Firestore
 *     rules check the token, never a lookup (§4.3)
 *
 * Also here: uploadUrl (photo slots), push triggers (§11 — order assigned,
 * cash exception, handover confirmed, reward claim). Still pending:
 * server-side order profit (FR-15.2) — the app computes it client-side today.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();

const norm = (email) => (email || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Provisioned staff logins (FR-1.3, two-lane auth)
//
// An owner recruits a rider off the street. He knows the man's phone number and
// his face; he does NOT know his Gmail address, and the rider frequently does
// not know it either — his handset was set up for him at the shop he bought it
// from. Asking the owner to type it EXACTLY put the app's worst failure right
// at its first minute: one wrong character and the rider's first morning is a
// refusal screen and a phone call.
//
// So the owner mints the identity instead, the way Salesforce has always done
// it: a login ID he chooses and a PIN he can read out. Firebase Auth needs a
// globally unique email, so one is synthesised from the company's own code and
// never shown to anybody — the rider types "ali" and six digits.
//
// Owners keep Google. They are signing themselves up, they have a real address,
// and they need account recovery that does not route through a helpdesk that
// does not exist.
// ---------------------------------------------------------------------------

/** Non-routable by design: nobody can mail a staff login, and the owner is the
 *  only reset path. That is the intended property, not a limitation. */
const STAFF_DOMAIN = 'snd.app';
// 2–20 chars so "ali" works and a paragraph does not. Leading alphanumeric
// keeps the synthesised address a legal one.
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,19}$/;
// Six, not four: Firebase Auth rejects passwords under six characters. Digits
// only, so the phone shows a number pad and the PIN survives being read aloud
// down a bad line.
const PIN_RE = /^\d{6}$/;

function slugify(name) {
  const base = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12);
  return base.length >= 3 ? base : `biz${base}`;
}

/**
 * Claim a globally unique company code.
 *
 * This code is typed by every employee at every sign-in, so it is derived from
 * the business's own name rather than being a random string — "alitraders" is
 * something a rider can be told once and remember. The reservation doc is what
 * makes it unique; the transaction is what stops two businesses called Ali
 * Traders signing up in the same second from both getting it.
 */
async function reserveCompanyCode(businessName, companyId) {
  const base = slugify(businessName);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = attempt === 0 ? base : `${base}${Math.floor(Math.random() * 9000) + 1000}`;
    const ref = db.doc(`companySlugs/${code}`);
    try {
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) throw new Error('taken');
        tx.set(ref, { companyId, createdAt: FieldValue.serverTimestamp() });
      });
      return code;
    } catch (e) {
      if (e.message !== 'taken') throw e;
    }
  }
  throw new HttpsError('resource-exhausted', 'Could not allocate a business code.');
}

/**
 * The company's code, minted on demand.
 *
 * Businesses created before staff logins existed have no code, and the first
 * one their owner issues is where they get one. It is mirrored onto the
 * settings doc because that is the document every client already listens to —
 * the Employees screen has to be able to show the owner what to write on the
 * slip, including before he has issued anybody a login.
 */
async function companyCodeFor(companyId) {
  const ref = db.doc(`companies/${companyId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Business not found.');
  const existing = snap.data().companyCode;
  if (existing) return existing;
  const code = await reserveCompanyCode(snap.data().businessName, companyId);
  await ref.set({ companyCode: code }, { merge: true });
  await db.doc(`companies/${companyId}/settings/company`)
    .set({ companyCode: code }, { merge: true })
    .catch((e) => console.warn('mirror companyCode', e.message));
  return code;
}

const staffEmail = (loginId, code) => `${loginId}@${code}.${STAFF_DOMAIN}`;

/**
 * The first rider a company onboards becomes its default, so a one-van business
 * needs no configuration at all. Shared with admitSignIn — it must fire once
 * per company and never again, or rider #4 would quietly inherit the round.
 */
async function claimDefaultRider(companyId, uid) {
  const sRef = db.doc(`companies/${companyId}/settings/company`);
  const sSnap = await sRef.get();
  const s = sSnap.exists ? sSnap.data() : {};
  if (!s.defaultRiderId && !s.autoAssignRiderId) {
    await sRef.set({ defaultRiderId: uid }, { merge: true });
  }
}

/**
 * Called right after Firebase Auth sign-in.
 * data: { createBusinessName?: string }  — present only from the
 * "Create a new business" flow (FR-1.7), where the typed name is the
 * deliberate step that prevents accidental workspaces.
 */
exports.admitSignIn = onCall({ region: 'asia-south1' }, async (request) => {
  const uid = request.auth?.uid;
  const email = norm(request.auth?.token?.email);
  if (!uid || !email) throw new HttpsError('unauthenticated', 'Sign in first.');

  const dirRef = db.doc(`employeeDirectory/${email}`);
  const dirSnap = await dirRef.get();

  // ---- Existing employee (or owner) — FR-1.4 -------------------------------
  if (dirSnap.exists) {
    const dir = dirSnap.data();
    if (dir.removedAt) return { status: 'access_ended' };

    // First successful sign-in: bind uid, mark joined (Employees screen
    // flips from "Invited — not joined yet").
    if (!dir.uid) {
      await dirRef.update({ uid, joinedAt: FieldValue.serverTimestamp() });
      // Keep the owner-facing mirror honest: "Invited" -> "joined". Write the
      // WHOLE row, not just the flag: addEmployee's mirror write is a separate
      // client call that can fail, and a bare {joined:true} merge CREATES a
      // role-less document that the Employees screen cannot render. The
      // directory is authoritative for name and role, so re-assert both.
      await db.doc(`companies/${dir.companyId}/employeeList/${email}`)
        .set({
          email,
          name: dir.name || '',
          role: dir.role,
          joined: true,
          removed: false,
        }, { merge: true })
        .catch((e) => console.warn('employeeList mirror', e.message));
      // What used to be here also swept every unaddressed order onto whoever
      // arrived. With one rider that was a fix; with six it silently overrode
      // the owner's own assignments, so unassigned orders are now surfaced to
      // the owner in-app instead of being redirected behind his back.
      if (dir.role === 'rider') await claimDefaultRider(dir.companyId, uid);
      await db.doc(`companies/${dir.companyId}/users/${uid}`).set(
        {
          name: dir.name || '',
          email,
          companyId: dir.companyId,
          role: dir.role,
          active: true,
          cashUnconfirmed: 0,
          floatOutstanding: 0,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await getAuth().setCustomUserClaims(uid, { companyId: dir.companyId, role: dir.role });

    // Came through "Create a new business" while already on a list.
    // The directory is keyed by email, so one address belongs to one business
    // and the typed name has nowhere to go. Admitting is right — this IS an
    // employee — but the name used to be dropped in SILENCE: a rider who typed
    // "Ali Traders" and pressed Create landed on the employer's rider screen
    // with no hint of why the workspace they thought they had just made was
    // not there. Same answer, said out loud.
    if ((request.data?.createBusinessName || '').trim()) {
      const cSnap = await db.doc(`companies/${dir.companyId}`).get();
      return {
        status: 'already_in_business',
        companyId: dir.companyId,
        role: dir.role,
        name: dir.name || '',
        businessName: (cSnap.exists && cSnap.data().businessName) || '',
      };
    }
    return { status: 'admitted', companyId: dir.companyId, role: dir.role, name: dir.name || '' };
  }

  // ---- Create a new business — FR-1.7 --------------------------------------
  const businessName = (request.data?.createBusinessName || '').trim();
  if (!businessName) return { status: 'not_on_list' };

  const companyRef = db.collection('companies').doc();
  // Minted here rather than at the first staff login, so the owner can see the
  // code his people will type from the moment the business exists.
  const companyCode = await reserveCompanyCode(businessName, companyRef.id);
  const batch = db.batch();
  batch.set(companyRef, {
    businessName,
    companyCode,
    ownerUid: uid,
    ownerEmail: email,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(dirRef, {
    email,
    companyId: companyRef.id,
    role: 'admin',
    name: request.auth.token.name || '',
    uid,
    addedBy: uid,
    addedAt: FieldValue.serverTimestamp(),
    joinedAt: FieldValue.serverTimestamp(),
    // Explicit null, not missing: the last-admin guard queries removedAt == null,
    // and a missing field never matches (audit finding).
    removedAt: null,
    removedBy: null,
  });
  batch.set(db.doc(`companies/${companyRef.id}/users/${uid}`), {
    name: request.auth.token.name || '',
    email,
    companyId: companyRef.id,
    role: 'admin',
    active: true,
    cashUnconfirmed: 0,
    floatOutstanding: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`companies/${companyRef.id}/employeeList/${email}`), {
    email, name: request.auth.token.name || '', role: 'admin',
    joined: true, removed: false,
  });
  batch.set(db.doc(`companies/${companyRef.id}/settings/company`), {
    brandName: businessName,
    // The Employees screen reads it from here — settings is the doc every
    // client already listens to, so the code needs no listener of its own.
    companyCode,
    currencySymbol: 'Rs',
    countryCode: '92',
    taxPercent: 0,
    maxDiscountPercent: 10,
    defaultDeliveryDay: 'today',
    shopsPerDay: 20,
    rewardApprovalLimit: 1000,
    acceptCheques: false,
    sendConfirmations: true,
    workingDays: 26,
    visibility: {
      bookerSeesDelivery: true,
      bookerSeesPayments: true,
      bookerSeesBalances: true,
      bookerSeesOwnTotals: true,
      riderSeesOldBalance: true,
    },
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  await getAuth().setCustomUserClaims(uid, { companyId: companyRef.id, role: 'admin' });
  return {
    status: 'admitted',
    companyId: companyRef.id,
    role: 'admin',
    name: request.auth.token.name || '',
  };
});

/**
 * addEmployee — Owner adds a Gmail address with a role (FR-1.3, FR-1.8).
 * One email belongs to one business at a time.
 */
exports.addEmployee = onCall({ region: 'asia-south1' }, async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only the owner adds employees.');
  }
  const companyId = request.auth.token.companyId;
  const email = norm(request.data?.email);
  const role = request.data?.role;
  const name = (request.data?.name || '').trim();
  if (!email || !['admin', 'booker', 'rider'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Need an email and a role.');
  }

  const dirRef = db.doc(`employeeDirectory/${email}`);
  const snap = await dirRef.get();
  if (snap.exists && !snap.data().removedAt) {
    const existing = snap.data();
    if (existing.companyId !== companyId) {
      throw new HttpsError('already-exists', 'This email already belongs to another business.');
    }
    throw new HttpsError('already-exists', 'This email is already on your employee list.');
  }
  await dirRef.set({
    email,
    companyId,
    role,
    name,
    uid: null,
    addedBy: request.auth.uid,
    addedAt: FieldValue.serverTimestamp(),
    removedAt: null,
    removedBy: null,
  });

  // Nothing to record here any more. A rider gets his uid at first sign-in
  // (admitSignIn), and which orders he carries is decided by the rounds the
  // owner puts him on — not by the order in which he was invited.
  return { status: 'invited', email, role };
});

/**
 * createStaffLogin — the owner mints an identity instead of asking for one.
 *
 * Unlike addEmployee this leaves nothing pending: the account exists, its
 * claims are written, and the man can sign in on the spot with a login ID and
 * six digits on a slip of paper. There is no invitation to accept, no address
 * to spell, and no Google account involved anywhere.
 */
exports.createStaffLogin = onCall({ region: 'asia-south1' }, async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only the owner creates staff logins.');
  }
  const companyId = request.auth.token.companyId;
  const loginId = (request.data?.loginId || '').trim().toLowerCase();
  const pin = String(request.data?.pin || '');
  const role = request.data?.role;
  const name = (request.data?.name || '').trim();

  if (!name) throw new HttpsError('invalid-argument', 'Give this person a name.');
  if (!LOGIN_ID_RE.test(loginId)) {
    throw new HttpsError('invalid-argument', 'Login ID: 2–20 letters or numbers, no spaces.');
  }
  if (!PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'PIN must be exactly 6 digits.');
  if (!['admin', 'booker', 'rider'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Pick a role.');
  }

  const companyCode = await companyCodeFor(companyId);
  const email = staffEmail(loginId, companyCode);
  const dirRef = db.doc(`employeeDirectory/${email}`);
  const dirSnap = await dirRef.get();
  // A removed staff login is fair game — removeEmployee moves the old address
  // out of the way precisely so the round's next man can inherit the login ID.
  if (dirSnap.exists && !dirSnap.data().removedAt) {
    throw new HttpsError('already-exists', `"${loginId}" is already taken. Pick another login ID.`);
  }

  let uid;
  try {
    ({ uid } = await getAuth().createUser({ email, password: pin, displayName: name }));
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', `"${loginId}" is already taken. Pick another login ID.`);
    }
    if (e.code === 'auth/invalid-password') {
      throw new HttpsError('invalid-argument', 'PIN must be exactly 6 digits.');
    }
    throw new HttpsError('internal', e.message);
  }

  // Before the documents, so a phone that raced in on the new PIN is never
  // admitted without a company. The claims ARE the authorisation (§4.3).
  await getAuth().setCustomUserClaims(uid, { companyId, role });

  const batch = db.batch();
  batch.set(dirRef, {
    email, companyId, role, name, uid,
    loginId, companyCode, staffLogin: true,
    addedBy: request.auth.uid,
    addedAt: FieldValue.serverTimestamp(),
    // Provisioned, so he has already "joined" — there is nothing to wait for.
    joinedAt: FieldValue.serverTimestamp(),
    removedAt: null,
    removedBy: null,
  });
  batch.set(db.doc(`companies/${companyId}/employeeList/${email}`), {
    email, name, role, loginId, staffLogin: true, joined: true, removed: false,
  });
  batch.set(db.doc(`companies/${companyId}/users/${uid}`), {
    name, email, companyId, role,
    active: true, cashUnconfirmed: 0, floatOutstanding: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  if (role === 'rider') await claimDefaultRider(companyId, uid);

  return { status: 'created', email, loginId, companyCode, role };
});

/**
 * resetStaffPin — the owner IS the password-reset flow.
 *
 * Nothing can be mailed to a synthesised address, which is the whole point: the
 * man who forgot his PIN on a market street rings the owner, who reads him a
 * new one. Tokens are revoked with it, so a phone still holding the old session
 * is out inside a minute (startAccessWatch) — that matters when the reason for
 * the reset is that the handset went missing.
 */
exports.resetStaffPin = onCall({ region: 'asia-south1' }, async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only the owner resets a PIN.');
  }
  const companyId = request.auth.token.companyId;
  const email = norm(request.data?.email);
  const pin = String(request.data?.pin || '');
  if (!PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'PIN must be exactly 6 digits.');

  const snap = await db.doc(`employeeDirectory/${email}`).get();
  if (!snap.exists || snap.data().companyId !== companyId) {
    throw new HttpsError('not-found', 'Not on your employee list.');
  }
  const target = snap.data();
  if (target.removedAt) {
    throw new HttpsError('failed-precondition', 'This person no longer has access.');
  }
  if (!target.staffLogin || !target.uid) {
    throw new HttpsError(
      'failed-precondition',
      'This person signs in with Google — there is no PIN to reset.',
    );
  }

  await getAuth().updateUser(target.uid, { password: pin });
  await getAuth().revokeRefreshTokens(target.uid);
  return {
    status: 'reset',
    email,
    loginId: target.loginId || '',
    companyCode: target.companyCode || '',
  };
});

/**
 * removeEmployee — FR-1.9: cut access within about a minute.
 * Refuses to remove the last admin (FR-1.10).
 */
exports.removeEmployee = onCall({ region: 'asia-south1' }, async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only the owner removes employees.');
  }
  const companyId = request.auth.token.companyId;
  const email = norm(request.data?.email);
  const dirRef = db.doc(`employeeDirectory/${email}`);
  const snap = await dirRef.get();
  if (!snap.exists || snap.data().companyId !== companyId) {
    throw new HttpsError('not-found', 'Not on your employee list.');
  }
  const target = snap.data();

  if (target.role === 'admin') {
    const admins = await db
      .collection('employeeDirectory')
      .where('companyId', '==', companyId)
      .where('role', '==', 'admin')
      .where('removedAt', '==', null)
      .get();
    if (admins.size <= 1) {
      throw new HttpsError('failed-precondition', 'Cannot remove the only admin (FR-1.10).');
    }
  }

  await dirRef.update({
    removedAt: FieldValue.serverTimestamp(),
    removedBy: request.auth.uid,
  });
  if (target.uid) {
    await db.doc(`companies/${companyId}/users/${target.uid}`).set({ active: false }, { merge: true });
    // Close his open day on the way out. He can no longer write his own day
    // doc, and the owner's confirm card only renders for handedOver days — so
    // cash he collected this morning would otherwise be unconfirmable by
    // anyone, forever. The Admin SDK bypasses the rules that stop him.
    //
    // Only days that already EXIST are touched, so this never invents a card;
    // yesterday is included because this clock is UTC and the business runs at
    // UTC+5, where "today" starts five hours earlier.
    const dayKey = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const daySnaps = await db.getAll(
      ...[dayKey(0), dayKey(1)].map((d) => db.doc(`companies/${companyId}/days/${target.uid}_${d}`)),
    );
    const openDays = daySnaps.filter((s) => s.exists && s.data().handoverConfirmed !== true);
    if (openDays.length) {
      const batch = db.batch();
      openDays.forEach((s) => batch.set(s.ref, { handedOver: true }, { merge: true }));
      await batch.commit().catch((e) => console.warn('close day on removal', e.message));
    }
    await getAuth().setCustomUserClaims(target.uid, null);
    await getAuth().revokeRefreshTokens(target.uid); // FR-1.9
    // Revocation alone leaves an account that can still authenticate — it just
    // gets a claimless token. Disabling is the hard stop, and for a PIN login
    // it is the only one that matters: the ex-rider knows his own six digits.
    await getAuth()
      .updateUser(target.uid, { disabled: true })
      .catch((e) => console.warn('disable account', e.message));
    // Free the login ID so the next man on the round can be "ali" too. The uid
    // is untouched, so his days, cash and orders stay attached to him and not
    // to whoever inherits the name.
    if (target.staffLogin && target.loginId && target.companyCode) {
      await getAuth()
        .updateUser(target.uid, {
          email: staffEmail(`${target.loginId}.left-${target.uid.slice(0, 6)}`, target.companyCode),
        })
        .catch((e) => console.warn('release login id', e.message));
    }
  }
  // Take him off every round he covered and out of the default slot —
  // otherwise new orders keep addressing a ghost, and because a rider's read
  // rule keys on assignedTo they would be invisible to everyone including the
  // owner (audit blocker: "replacing the delivery rider silently breaks
  // assignment"). The rounds simply become unassigned, which the owner sees.
  if (target.uid) {
    const sRef = db.doc(`companies/${companyId}/settings/company`);
    const sSnap = await sRef.get();
    if (sSnap.exists) {
      const s = sSnap.data();
      if (s.defaultRiderId === target.uid || s.autoAssignRiderId === target.uid) {
        await sRef.set({ defaultRiderId: null, autoAssignRiderId: null }, { merge: true });
      }
    }
    // Both jobs, because either one left dangling points a round at a ghost:
    // as a rider his orders go dark, as a booker his territory belongs to
    // nobody and drops off every route screen in the company.
    // A round can name SEVERAL bookers (Area.bookerIds), so removal has to
    // pull this one man out of the array and leave his colleagues on it —
    // deleting the field would silently take a round off everybody else's
    // route screen. The legacy single `bookerId` is still queried because a
    // company that has not edited its rounds since the change still stores it.
    const [asRider, asBooker, asBookerLegacy] = await Promise.all([
      db.collection(`companies/${companyId}/areas`).where('riderId', '==', target.uid).get(),
      db.collection(`companies/${companyId}/areas`)
        .where('bookerIds', 'array-contains', target.uid).get(),
      db.collection(`companies/${companyId}/areas`).where('bookerId', '==', target.uid).get(),
    ]);
    if (!asRider.empty || !asBooker.empty || !asBookerLegacy.empty) {
      const batch = db.batch();
      asRider.docs.forEach((d) => batch.update(d.ref, { riderId: FieldValue.delete() }));
      asBooker.docs.forEach((d) => {
        const left = (d.data().bookerIds || []).filter((uid) => uid !== target.uid);
        batch.update(d.ref, {
          bookerIds: left.length ? left : FieldValue.delete(),
        });
      });
      asBookerLegacy.docs.forEach((d) => batch.update(d.ref, { bookerId: FieldValue.delete() }));
      await batch.commit().catch((e) => console.warn('clear rounds on removal', e.message));
    }
  }
  return { status: 'removed', email };
});

/**
 * uploadUrl — permission to upload ONE photo (reward proof, logo, …).
 *
 * The path is chosen by the SERVER, so a phone can never write outside its
 * own company's folder. The zone key travels only inside the one response.
 * (Owner reviewed the exposure trade-off on 2026-08-06 and accepted it.)
 *
 * Key lives in Secret Manager: npx firebase-tools functions:secrets:set BUNNY_KEY
 */
const { defineSecret } = require('firebase-functions/params');
const BUNNY_KEY = defineSecret('BUNNY_KEY');

const BUNNY = {
  storageHost: 'storage.bunnycdn.com',
  storageZone: 'post-gag',
  cdnBase: 'https://pull-gag.b-cdn.net',
  prefix: 'snd',
};

const ALLOWED_KINDS = ['logo', 'product', 'shop', 'proof', 'reward', 'expense'];

exports.uploadUrl = onCall({ region: 'asia-south1', secrets: [BUNNY_KEY] }, async (request) => {
  const companyId = request.auth?.token?.companyId;
  if (!companyId) throw new HttpsError('permission-denied', 'Sign in first.');

  const kind = request.data?.kind;
  if (!ALLOWED_KINDS.includes(kind)) {
    throw new HttpsError('invalid-argument', 'Unknown photo kind.');
  }

  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `${BUNNY.prefix}/${companyId}/${kind}/${yyyymm}/${file}`;

  return {
    uploadUrl: `https://${BUNNY.storageHost}/${BUNNY.storageZone}/${path}`,
    accessKey: BUNNY_KEY.value(),
    publicUrl: `${BUNNY.cdnBase}/${path}`,
  };
});

// ---------------------------------------------------------------------------
// Push notifications (§11, FR-12.10) — the four moments that matter in the
// field. Tokens live on users/{uid}.fcmToken (each phone writes its own; the
// rules whitelist exactly that key). Every send is best-effort: a dead token
// must never fail the write that triggered it.
// ---------------------------------------------------------------------------
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getMessaging } = require('firebase-admin/messaging');

async function tokenOf(companyId, uid) {
  if (!uid) return null;
  const snap = await db.doc(`companies/${companyId}/users/${uid}`).get();
  return (snap.exists && snap.data().fcmToken) || null;
}

async function adminTokens(companyId) {
  const snap = await db
    .collection(`companies/${companyId}/users`)
    .where('role', '==', 'admin')
    .get();
  return snap.docs.map((d) => d.data().fcmToken).filter(Boolean);
}

async function push(tokens, title, body) {
  const list = (Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean);
  if (!list.length) return;
  await getMessaging()
    .sendEachForMulticast({ tokens: list, notification: { title, body } })
    .catch((e) => console.warn('push failed', e.message));
}

const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`;

// New order → the rider it was assigned to (FR-6.1).
exports.pushOrderAssigned = onDocumentCreated(
  { document: 'companies/{c}/orders/{o}', region: 'asia-south1' },
  async (event) => {
    const o = event.data?.data();
    if (!o || !o.assignedTo) return;
    await push(
      await tokenOf(event.params.c, o.assignedTo),
      `New order — ${o.shopSnapshot?.name || 'shop'}`,
      `${rs(o.orderedTotals?.grandTotal)} • deliver ${o.deliveryDay || 'today'}`,
    );
  },
);

// Booker forced-cash exception (FR-7.13) → every admin, immediately.
exports.pushExceptionCash = onDocumentCreated(
  { document: 'companies/{c}/payments/{p}', region: 'asia-south1' },
  async (event) => {
    const p = event.data?.data();
    if (!p || p.exception !== true) return;
    await push(
      await adminTokens(event.params.c),
      'Cash exception — needs your eye',
      `Booker accepted ${rs(p.amount)} at a shop. Confirm it at the handover.`,
    );
  },
);

// Owner confirmed the handover → tell the staff member their day is closed.
exports.pushHandoverConfirmed = onDocumentUpdated(
  { document: 'companies/{c}/days/{staffId}', region: 'asia-south1' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after || before?.handoverConfirmed === true || after.handoverConfirmed !== true) return;
    await push(
      await tokenOf(event.params.c, event.params.staffId),
      'Cash confirmed',
      'The owner counted and confirmed your handover. All clear.',
    );
  },
);

// Every new order → every admin. The owner asked to know when work happens
// rather than having to open the app and look.
//
// A SECOND trigger on the same document as pushOrderAssigned rather than an
// extra send inside it: they are different audiences with different reasons.
// The rider one is dead without `assignedTo`, and an unassigned order is
// exactly the one the owner most needs to hear about — folding them together
// would silence the alert precisely when it matters.
exports.pushOrderBooked = onDocumentCreated(
  { document: 'companies/{c}/orders/{o}', region: 'asia-south1' },
  async (event) => {
    const o = event.data?.data();
    if (!o) return;
    await push(
      await adminTokens(event.params.c),
      `Order booked — ${o.shopSnapshot?.name || 'shop'}`,
      `${rs(o.orderedTotals?.grandTotal)} • ${o.assignedTo ? `deliver ${o.deliveryDay || 'today'}` : 'UNASSIGNED — no rider'}`,
    );
  },
);

// Delivered → every admin. Fires on the status EDGE, not on the value, so an
// order written again for any other reason (a reprice, a payment landing)
// cannot send this twice. `deliveredAt` is deliberately not used as the
// trigger: it is written in the same update as the status and would race.
exports.pushOrderDelivered = onDocumentUpdated(
  { document: 'companies/{c}/orders/{o}', region: 'asia-south1' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after || before?.status === 'delivered' || after.status !== 'delivered') return;
    const billed = after.billedTotals?.grandTotal ?? after.orderedTotals?.grandTotal;
    const paid = Number(after.amountPaid || 0);
    const owed = Number(billed || 0) - paid;
    await push(
      await adminTokens(event.params.c),
      `Delivered — ${after.shopSnapshot?.name || 'shop'}`,
      // The number the owner actually wants at that moment is not the bill, it
      // is whether the cash came with it.
      owed > 0 ? `${rs(billed)} • ${rs(owed)} still owed` : `${rs(billed)} • paid in full`,
    );
  },
);

// New reward claim → every admin (FR-16.5: only they can approve).
exports.pushClaimPending = onDocumentCreated(
  { document: 'companies/{c}/rewardClaims/{id}', region: 'asia-south1' },
  async (event) => {
    const cl = event.data?.data();
    if (!cl || cl.status !== 'pending') return;
    await push(
      await adminTokens(event.params.c),
      'Reward claim waiting',
      `${cl.staffName || 'Counter staff'} — ${cl.pieces} pcs, ${rs(cl.amount)}${cl.overLimit ? ' (over limit)' : ''}`,
    );
  },
);
