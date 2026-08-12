import { NextResponse } from "next/server";
import { getStorageQuota } from "@/lib/google";
import { listAccounts, listFilesForAccount } from "@/lib/library";

export const dynamic = "force-dynamic";

// A move is only worth doing once the gap from the target is at least this
// big — avoids constantly shuffling files around to fix tiny, meaningless
// differences.
const TOLERANCE_BYTES = 200 * 1024 * 1024; // 200MB
// Never plan a move that would leave the destination with less real free
// space than this, regardless of mode — capacity is always a hard limit.
const SAFETY_MARGIN_BYTES = 100 * 1024 * 1024; // 100MB

// Computes which of the app's own synced files should move from
// over-target accounts to under-target ones, without touching anything yet.
// Only accounts with a numeric quota limit are considered — an unlimited
// (Workspace) account has nothing meaningful to balance against.
//
// Two modes, chosen by the person:
//  - "percent": target is proportional to each account's own capacity, so
//    a 15GB account ends up holding roughly 3x as much as a 5GB account —
//    both land at about the same % used.
//  - "even": target is the app's total synced bytes split equally across
//    every connected account, ignoring how big each account's own capacity
//    is (e.g. 10MB of synced photos over 5 accounts → ~2MB each).
// Real free space (from Google) is always respected as a hard limit on
// where a file can land, no matter which mode is picked.
export async function POST(request) {
  const { mode = "percent" } = await request.json().catch(() => ({}));
  if (mode !== "percent" && mode !== "even") {
    return NextResponse.json({ error: "mode phải là 'percent' hoặc 'even'" }, { status: 400 });
  }

  const accounts = await listAccounts();
  if (accounts.length < 2) {
    return NextResponse.json({ moves: [], note: "Cần ít nhất 2 tài khoản mới cân bằng được." });
  }

  const withQuota = await Promise.all(
    accounts.map(async (acc) => {
      try {
        return { ...acc, quota: await getStorageQuota(acc.email) };
      } catch {
        return { ...acc, quota: null };
      }
    })
  );

  const bounded = withQuota.filter((a) => a.quota && typeof a.quota.limit === "number");
  const skippedUnlimited = withQuota.length - bounded.length;

  if (bounded.length < 2) {
    return NextResponse.json({
      moves: [],
      note: "Cần ít nhất 2 tài khoản có giới hạn dung lượng cụ thể mới cân bằng được.",
    });
  }

  // Files this app has synced into each account (largest first), and how
  // many of the app's own bytes are currently sitting in each one.
  const filesByEmail = {};
  const ownBytesByEmail = {};
  for (const a of bounded) {
    const files = await listFilesForAccount(a.email);
    filesByEmail[a.email] = files;
    ownBytesByEmail[a.email] = files.reduce((s, f) => s + (f.size || 0), 0);
  }
  const totalOwnBytes = Object.values(ownBytesByEmail).reduce((s, n) => s + n, 0);

  // currentByEmail / targetByEmail define the balancing basis — what we're
  // trying to equalize — depending on the chosen mode. Real Drive free
  // space (freeByEmail below) is tracked separately and always enforced as
  // the hard constraint on whether a move is actually possible.
  const currentByEmail = {};
  const targetByEmail = {};

  if (mode === "even") {
    const evenTarget = totalOwnBytes / bounded.length;
    bounded.forEach((a) => {
      currentByEmail[a.email] = ownBytesByEmail[a.email];
      targetByEmail[a.email] = evenTarget;
    });
  } else {
    const totalUsage = bounded.reduce((s, a) => s + a.quota.usage, 0);
    const totalLimit = bounded.reduce((s, a) => s + a.quota.limit, 0);
    const avgPercentUsed = totalLimit ? totalUsage / totalLimit : 0;
    bounded.forEach((a) => {
      currentByEmail[a.email] = a.quota.usage;
      targetByEmail[a.email] = a.quota.limit * avgPercentUsed;
    });
  }

  const freeByEmail = {};
  bounded.forEach((a) => (freeByEmail[a.email] = a.quota.free));

  const sources = bounded
    .filter((a) => currentByEmail[a.email] - targetByEmail[a.email] > TOLERANCE_BYTES)
    .sort((a, b) => (targetByEmail[b.email] - currentByEmail[b.email]) - (targetByEmail[a.email] - currentByEmail[a.email])); // most over-target first

  const moves = [];
  let totalBytes = 0;

  for (const src of sources) {
    let need = currentByEmail[src.email] - targetByEmail[src.email];
    const files = filesByEmail[src.email];

    for (const file of files) {
      if (need <= TOLERANCE_BYTES) break;
      const size = file.size || 0;

      // Prefer whichever eligible account is currently furthest under its
      // own target, recomputed each step since earlier planned moves in
      // this same run shift who has the most room left.
      const dest = bounded
        .filter((a) => a.email !== src.email)
        .filter((a) => targetByEmail[a.email] - currentByEmail[a.email] > TOLERANCE_BYTES / 2)
        .filter((a) => freeByEmail[a.email] - size > SAFETY_MARGIN_BYTES)
        .sort(
          (a, b) =>
            (targetByEmail[b.email] - currentByEmail[b.email]) -
            (targetByEmail[a.email] - currentByEmail[a.email])
        )[0];

      if (!dest) continue;

      moves.push({
        id: file.id,
        name: file.name,
        size,
        fromEmail: src.email,
        toEmail: dest.email,
      });

      currentByEmail[src.email] -= size;
      currentByEmail[dest.email] += size;
      freeByEmail[src.email] += size;
      freeByEmail[dest.email] -= size;
      need -= size;
      totalBytes += size;
    }
  }

  return NextResponse.json({
    mode,
    moves,
    totalBytes,
    accountCount: bounded.length,
    skippedUnlimited,
  });
}
