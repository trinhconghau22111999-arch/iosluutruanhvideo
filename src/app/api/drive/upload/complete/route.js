import { NextResponse } from "next/server";
import { recordSyncedFile } from "@/lib/library";

export const dynamic = "force-dynamic";

// Step 2 of 2. Called after the browser has already PUT the file bytes
// straight to Google's resumable session URL. This just persists the
// small resulting metadata so the library page and future dedupe checks
// know about it — no file bytes pass through here either.
export async function POST(request) {
  const {
    dedupeKey,
    name,
    size,
    mimeType,
    lastModified,
    accountEmail,
    driveFileId,
    driveLink,
    thumbnailLink,
  } = await request.json();

  if (!dedupeKey || !driveFileId || !accountEmail) {
    return NextResponse.json({ error: "Thiếu thông tin để lưu" }, { status: 400 });
  }

  await recordSyncedFile({
    dedupeKey,
    name,
    size,
    mimeType,
    lastModified,
    accountEmail,
    driveFileId,
    driveLink,
    thumbnailLink: thumbnailLink || null,
  });

  return NextResponse.json({ ok: true });
}
