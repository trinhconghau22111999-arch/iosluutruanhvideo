import { NextResponse } from "next/server";
import { getLibraryEntry, updateLibraryEntry } from "@/lib/library";

export const dynamic = "force-dynamic";

// Lets the browser save a frame it captured itself (see sync/page.js's
// captureVideoFrame) onto a file that was already synced earlier, before
// this feature existed — used by the "Tạo ảnh xem trước cho video cũ" tool
// in the Thư viện tab. Same size guard as the normal upload-complete path.
export async function POST(request) {
  const { id, clientThumbnail } = await request.json().catch(() => ({}));
  if (!id || typeof clientThumbnail !== "string") {
    return NextResponse.json({ error: "Thiếu dữ liệu" }, { status: 400 });
  }
  if (clientThumbnail.length >= 200_000) {
    return NextResponse.json({ error: "Ảnh xem trước quá lớn" }, { status: 400 });
  }

  const entry = await getLibraryEntry(id);
  if (!entry) return NextResponse.json({ error: "Không tìm thấy file" }, { status: 404 });

  await updateLibraryEntry(id, { clientThumbnail });
  return NextResponse.json({ ok: true });
}
