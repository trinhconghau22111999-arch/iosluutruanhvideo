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
    clientThumbnail,
  } = await request.json();

  if (!dedupeKey || !driveFileId || !accountEmail) {
    return NextResponse.json({ error: "Thiếu thông tin để lưu" }, { status: 400 });
  }

  // clientThumbnail is a small JPEG data URL the browser captured itself
  // from the video's first frame at sync time (see sync/page.js) — used as
  // a guaranteed fallback because Drive frequently never generates its own
  // thumbnailLink for videos uploaded via the API, unlike images which
  // almost always get one. Keep it capped defensively: Firestore documents
  // have a 1MB limit and this field should only ever be a few tens of KB.
  const safeClientThumbnail =
    typeof clientThumbnail === "string" && clientThumbnail.length < 200_000
      ? clientThumbnail
      : null;

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
    clientThumbnail: safeClientThumbnail,
  });

  return NextResponse.json({ ok: true });
}
