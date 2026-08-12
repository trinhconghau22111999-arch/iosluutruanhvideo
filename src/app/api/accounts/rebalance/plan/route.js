import { NextResponse } from "next/server";
import { getStorageQuota } from "@/lib/google";
import { listAccounts, listFilesForAccount } from "@/lib/library";

export const dynamic = "force-dynamic";

// "percent" mode: a move is only worth doing once an account's gap from its
// own target is at least this big — avoids constantly shuffling files
// around to fix tiny, meaningless differences.
const PERCENT_TOLERANCE_BYTES = 200 * 1024 * 1024; // 200MB
// "even" mode: keep moving files until the gap between the fullest and the
// emptiest account's own synced data is within this amount.
const EVEN_MAX_GAP_BYTES = 100 * 1024 * 1024; // 100MB
// Never plan a move that would leave the destination with less real free
// space than this, regardless of mode — capacity is always a hard limit.
const SAFETY_MARGIN_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_ITERATIONS = 500; // safety valve, not a realistic ceiling for personal use

// Computes which of the app's own synced files should move from
// over-target accounts to under-target ones, without touching anything yet.
// Only accounts with a numeric quota limit are considered — an unlimited
// (Workspace) account has nothing meaningful to balance against.
//
// Two modes, chosen by the person:
//  - "percent": target is proportional to each account's own capacity, so
//    a 15GB account ends up holding roughly 3x as much as a 5GB account —
//    both land at about the same % used.
//  - "even": keeps moving files from the fullest account (of the app's own
//    synced data) to the emptiest one until the two are within 100MB of
//    each other, ignoring how big each account's own Drive capacity is.
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

  const freeByEmail = {};
  bounded.forEach((a) => (freeByEmail[a.email] = a.quota.free));

  const moves = [];
  let totalBytes = 0;

  if (mode === "even") {
    const currentByEmail = { ...ownBytesByEmail };
    const movedIds = new Set();

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const richest = bounded.reduce((a, b) => (currentByEmail[a.email] > currentByEmail[b.email] ? a : b));
      const poorest = bounded.reduce((a, b) => (currentByEmail[a.email] < currentByEmail[b.email] ? a : b));
      const gap = currentByEmail[richest.email] - currentByEmail[poorest.email];
      if (gap <= EVEN_MAX_GAP_BYTES || richest.email === poorest.email) break;

      const candidates = filesByEmail[richest.email].filter((f) => !movedIds.has(f.id));
      if (candidates.length === 0) break; // nothing left to move out of the richest account

      // Prefer a file that closes the gap without overshooting past the
      // poorest account; otherwise take the smallest available so progress
      // is still made without a wild overcorrection.
      const fitting = candidates.filter((f) => (f.size || 0) <= gap);
      const file = fitting.length > 0 ? fitting[0] : candidates[candidates.length - 1];
      const size = file.size || 0;

      if (freeByEmail[poorest.email] - size <= SAFETY_MARGIN_BYTES) break; // destination has no room

      moves.push({ id: file.id, name: file.name, size, fromEmail: richest.email, toEmail: poorest.email });
      movedIds.add(file.id);
      currentByEmail[richest.email] -= size;
      currentByEmail[poorest.email] += size;
      freeByEmail[richest.email] += size;
      freeByEmail[poorest.email] -= size;
      totalBytes += size;
    }
  } else {
    const totalUsage = bounded.reduce((s, a) => s + a.quota.usage, 0);
    const totalLimit = bounded.reduce((s, a) => s + a.quota.limit, 0);
    const avgPercentUsed = totalLimit ? totalUsage / totalLimit : 0;

    const currentByEmail = {};
    const targetByEmail = {};
    bounded.forEach((a) => {
      currentByEmail[a.email] = a.quota.usage;
      targetByEmail[a.email] = a.quota.limit * avgPercentUsed;
    });

    const sources = bounded
      .filter((a) => currentByEmail[a.email] - targetByEmail[a.email] > PERCENT_TOLERANCE_BYTES)
      .sort(
        (a, b) =>
          (targetByEmail[b.email] - currentByEmail[b.email]) -
          (targetByEmail[a.email] - currentByEmail[a.email])
      ); // most over-target first

    for (const src of sources) {
      let need = currentByEmail[src.email] - targetByEmail[src.email];
      const files = filesByEmail[src.email];

      for (const file of files) {
        if (need <= PERCENT_TOLERANCE_BYTES) break;
        const size = file.size || 0;

        const dest = bounded
          .filter((a) => a.email !== src.email)
          .filter((a) => targetByEmail[a.email] - currentByEmail[a.email] > PERCENT_TOLERANCE_BYTES / 2)
          .filter((a) => freeByEmail[a.email] - size > SAFETY_MARGIN_BYTES)
          .sort(
            (a, b) =>
              (targetByEmail[b.email] - currentByEmail[b.email]) -
              (targetByEmail[a.email] - currentByEmail[a.email])
          )[0];

        if (!dest) continue;

        moves.push({ id: file.id, name: file.name, size, fromEmail: src.email, toEmail: dest.email });
        currentByEmail[src.email] -= size;
        currentByEmail[dest.email] += size;
        freeByEmail[src.email] += size;
        freeByEmail[dest.email] -= size;
        need -= size;
        totalBytes += size;
      }
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
