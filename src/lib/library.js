import { db } from "./firebaseAdmin";

const COLLECTION = "synced_files";

// A dedupe key based on name+size+lastModified is a solid proxy for "same
// photo/video" without needing to hash file bytes (which would be slow for
// large videos on a phone connection).
export function makeDedupeKey({ name, size, lastModified }) {
  return `${name}__${size}__${lastModified}`;
}

export async function getExistingDedupeKeys(keys) {
  if (keys.length === 0) return new Set();
  const found = new Set();
  // Firestore 'in' queries are capped at 30 values per call.
  const chunks = [];
  for (let i = 0; i < keys.length; i += 30) chunks.push(keys.slice(i, i + 30));
  for (const chunk of chunks) {
    const snap = await db
      .collection(COLLECTION)
      .where("dedupeKey", "in", chunk)
      .get();
    snap.forEach((doc) => found.add(doc.data().dedupeKey));
  }
  return found;
}

export async function recordSyncedFile(entry) {
  await db.collection(COLLECTION).add({
    ...entry,
    syncedAt: entry.syncedAt || new Date().toISOString(),
  });
}

export async function listLibrary() {
  const snap = await db
    .collection(COLLECTION)
    .orderBy("syncedAt", "desc")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Largest-first so the rebalancer can shed an account's usage by moving the
// fewest files possible, instead of shuffling lots of small ones around.
export async function listFilesForAccount(email) {
  const snap = await db.collection(COLLECTION).where("accountEmail", "==", email).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
}

export async function deleteLibraryEntry(id) {
  await db.collection(COLLECTION).doc(id).delete();
}

export async function getLibraryEntry(id) {
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function updateLibraryEntry(id, patch) {
  await db.collection(COLLECTION).doc(id).update(patch);
}

export async function listAccounts() {
  const snap = await db.collection("accounts").get();
  return snap.docs.map((d) => {
    const { refreshTokenEnc, ...rest } = d.data();
    return rest;
  });
}

export async function removeAccount(email) {
  await db.collection("accounts").doc(email).delete();
}
