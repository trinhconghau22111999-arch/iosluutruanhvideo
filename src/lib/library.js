import { db } from "./firebaseAdmin";

const COLLECTION = "synced_files";

// Dedupe key dựa trên name + size — đủ để nhận dạng "cùng file" mà không
// cần hash bytes (chậm với video lớn trên mạng di động).
//
// ⚠ Không dùng lastModified: trên iOS Safari và một số Android, trường này
// trả về 0 hoặc Date.now() mỗi lần người dùng chọn file qua input[type=file]
// — tức là cùng một file ảnh có thể cho lastModified khác nhau mỗi lần chọn,
// khiến dedupeKey không khớp và file bị upload lại thành bản trùng.
//
// name + size là đủ chính xác: hai file ảnh/video khác nhau hiếm khi có
// cùng tên lẫn cùng dung lượng byte.
export function makeDedupeKey({ name, size }) {
  return `${name}__${size}`;
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

// Kiểm tra trùng lặp theo cả 2 cách:
// 1. dedupeKey mới (name__size) — format hiện tại
// 2. name + size khớp với bản ghi cũ (có thể có dedupeKey dạng name__size__lastModified)
//
// Dùng hàm này thay cho getExistingDedupeKeys ở bước init upload để tránh
// upload lại những file đã đồng bộ trước khi migration format key.
export async function checkAlreadySynced(name, size) {
  // Kiểm tra key mới trước (nhanh, trường hợp phổ biến)
  const newKey = makeDedupeKey({ name, size });
  const byNewKey = await db
    .collection(COLLECTION)
    .where("dedupeKey", "==", newKey)
    .limit(1)
    .get();
  if (!byNewKey.empty) return true;

  // Fallback: tìm theo name + size (bắt bản ghi cũ có lastModified trong key)
  const byNameSize = await db
    .collection(COLLECTION)
    .where("name", "==", name)
    .where("size", "==", size)
    .limit(1)
    .get();
  return !byNameSize.empty;
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
