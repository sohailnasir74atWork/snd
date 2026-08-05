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
 * Later weeks add here: exception pushes (§11), order profit on delivery
 * (FR-15.2), token revocation on removal (FR-1.9).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();

const norm = (email) => (email || '').trim().toLowerCase();

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
    return { status: 'admitted', companyId: dir.companyId, role: dir.role, name: dir.name || '' };
  }

  // ---- Create a new business — FR-1.7 --------------------------------------
  const businessName = (request.data?.createBusinessName || '').trim();
  if (!businessName) return { status: 'not_on_list' };

  const companyRef = db.collection('companies').doc();
  const batch = db.batch();
  batch.set(companyRef, {
    businessName,
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
  batch.set(db.doc(`companies/${companyRef.id}/settings/company`), {
    brandName: businessName,
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
  const callerRole = request.auth?.token?.companyId && request.auth?.token?.role;
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
  return { status: 'invited', email, role };
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
    await getAuth().setCustomUserClaims(target.uid, null);
    await getAuth().revokeRefreshTokens(target.uid); // FR-1.9
  }
  return { status: 'removed', email };
});
