import { NextResponse } from "next/server";
import { getStorageQuota, uploadFileToDrive } from "@/lib/google";
import { listAccounts, getExistingDedupeKeys, recordSyncedFile, makeDedupeKey } from "@/lib/library";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  const form = await request.formData();
  const file = form.get("file");
  const name = form.get("name");
  const size = Number(form.get("size"));
  const lastModified = form.get("lastModified");
  const mimeType = form.get("mimeType") || "application/octet-stream";

  if (!file || !name) {
    return NextResponse.json({ error: "Thiếu file" }, { status: 400 });
  }

  const dedupeKey = makeDedupeKey({ name, size, lastModified });
  const already = await getExistingDedupeKeys([dedupeKey]);
  if (already.has(dedupeKey)) {
    return NextResponse.json({ skipped: true, reason: "Đã đồng bộ trước đó", dedupeKey });
  }

  const accounts = await listAccounts();
  if (accounts.length === 0) {
    return NextResponse.json({ error: "Chưa kết nối tài khoản Google nào" }, { status: 400 });
  }

  // Pick the account with the most free space right now.
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
    return NextResponse.json({ error: "Không lấy được dung lượng của tài khoản nào" }, { status: 500 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const uploaded = await uploadFileToDrive(best.email, { name, mimeType, buffer });

  await recordSyncedFile({
    dedupeKey,
    name,
    size,
    mimeType,
    lastModified,
    accountEmail: best.email,
    driveFileId: uploaded.id,
    driveLink: uploaded.webViewLink,
    thumbnailLink: uploaded.thumbnailLink || null,
  });

  return NextResponse.json({ ok: true, account: best.email, driveFileId: uploaded.id });
}
