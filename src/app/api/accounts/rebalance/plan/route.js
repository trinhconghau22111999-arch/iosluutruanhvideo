import { NextResponse } from "next/server";
import { getStorageQuota } from "@/lib/google";
import { listAccounts, listFilesForAccount } from "@/lib/library";

export const dynamic = "force-dynamic";

// A move is only worth doing once the gap from the average is at least this
// big — avoids constantly shuffling files around to fix tiny, meaningless
// differences.
const TOLERANCE_BYTES = 200 * 1024 * 1024; // 200MB

// Computes which files should move from over-full accounts to under-full
// ones to bring everyone closer to the average free space, without actually
// touching any files yet. Only accounts with a numeric quota limit are
// considered — an unlimited (Workspace) account has nothing meaningful to
// "balance" against.
export async function POST() {
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

  const totalFree = bounded.reduce((s, a) => s + a.quota.free, 0);
  const average = totalFree / bounded.length;

  // Working copy of free space per account, updated as we simulate moves.
  const freeByEmail = {};
  bounded.forEach((a) => (freeByEmail[a.email] = a.quota.free));

  const sources = bounded
    .filter((a) => average - freeByEmail[a.email] > TOLERANCE_BYTES)
    .sort((a, b) => freeByEmail[a.email] - freeByEmail[b.email]); // least free first

  const moves = [];
  let totalBytes = 0;

  for (const src of sources) {
    let need = average - freeByEmail[src.email];
    if (need <= TOLERANCE_BYTES) continue;

    const files = await listFilesForAccount(src.email); // largest first
    for (const file of files) {
      if (need <= TOLERANCE_BYTES) break;

      // Recompute the current most-spacious destination each time, since
      // earlier planned moves in this same run change who has room.
      const dest = bounded
        .filter((a) => a.email !== src.email)
        .filter((a) => freeByEmail[a.email] - (file.size || 0) > TOLERANCE_BYTES / 2)
        .sort((a, b) => freeByEmail[b.email] - freeByEmail[a.email])[0];

      if (!dest || freeByEmail[dest.email] <= freeByEmail[src.email]) continue;

      moves.push({
        id: file.id,
        name: file.name,
        size: file.size || 0,
        fromEmail: src.email,
        toEmail: dest.email,
      });
      freeByEmail[src.email] += file.size || 0;
      freeByEmail[dest.email] -= file.size || 0;
      need -= file.size || 0;
      totalBytes += file.size || 0;
    }
  }

  return NextResponse.json({
    moves,
    totalBytes,
    accountCount: bounded.length,
    skippedUnlimited,
  });
}
