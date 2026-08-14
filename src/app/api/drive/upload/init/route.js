import { NextResponse } from "next/server";
import { getStorageQuota, initResumableUpload } from "@/lib/google";
import { listAccounts, checkAlreadySynced, makeDedupeKey } from "@/lib/library";

export const dynamic = "force-dynamic";

// Step 1 of 2 for syncing a file. This only exchanges small JSON — the name,
// size and mime type of the file — never the file bytes themselves, so it
// stays comfortably under Vercel's 4.5MB request body limit no matter how
// large the actual photo or video is. The browser uses the returned
// sessionUrl to PUT the real bytes straight to Google.
export async function POST(request) {
  const { name, size, lastModified, mimeType } = await request.json();

  if (!name || !size) {
    return NextResponse.json({ error: "Thiếu thông tin file" }, { status: 400 });
  }

  const dedupeKey = makeDedupeKey({ name, size });
  const already = await checkAlreadySynced(name, size);
  if (already) {
    return NextResponse.json({ skipped: true, reason: "Đã đồng bộ trước đó", dedupeKey });
  }

  const accounts = await listAccounts();
  if (accounts.length === 0) {
    return NextResponse.json({ error: "Chưa kết nối tài khoản Google nào" }, { status: 400 });
  }

  const quotas = await Promise.all(
    accounts.map(async (acc) => {
      try {
        return await getStorageQuota(acc.email);
      } catch {
        return { email: acc.email, free: -1 };
      }
    })
  );
  const best = quotas.filter((q) => q.free >= 0).sort((a, b) => b.free - a.free)[0];
  if (!best) {
    return NextResponse.json(
      { error: "Không lấy được dung lượng của tài khoản nào" },
      { status: 500 }
    );
  }

  const sessionUrl = await initResumableUpload(best.email, { name, mimeType, size });

  return NextResponse.json({ sessionUrl, account: best.email, dedupeKey });
}
