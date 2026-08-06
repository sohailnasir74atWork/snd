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
      // Keep the owner-facing mirror honest: "Invited" -> "joined".
      await db.doc(`companies/${dir.companyId}/employeeList/${email}`)
        .set({ joined: true }, { merge: true })
        .catch(() => {});
      // Now that the rider has a uid, orders can be addressed to him (FR-6.1).
      if (dir.role === 'rider') {
        const sRef = db.doc(`companies/${dir.companyId}/settings/company`);
        const sSnap = await sRef.get();
        const s = sSnap.exists ? sSnap.data() : {};
        if (!s.autoAssignRiderId || s.autoAssignRiderEmail === email) {
          await sRef.set({ autoAssignRiderId: uid, autoAssignRiderEmail: email }, { merge: true });
        }
      }
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

  // The business has one rider: orders assign themselves to him (FR-6.1).
  // Recorded here so the booker's phone knows who to assign to.
  if (role === 'rider') {
    const settingsRef = db.doc(`companies/${companyId}/settings/company`);
    const cur = await settingsRef.get();
    if (!cur.exists || !cur.data().autoAssignRiderEmail) {
      await settingsRef.set({ autoAssignRiderEmail: email }, { merge: true });
    }
  }
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
