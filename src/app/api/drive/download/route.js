import { getFileMediaStream } from "@/lib/google";
import { getLibraryEntry } from "@/lib/library";

export const dynamic = "force-dynamic";

// Streams the actual file bytes (image or video) so the browser can turn it
// into a real File object for the native share sheet, or a plain download.
// Unlike /api/drive/thumbnail (images only, used for the gallery grid), this
// works for every mime type since it's used for sharing videos too.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const entry = await getLibraryEntry(id);
  if (!entry) return new Response("Không tìm thấy", { status: 404 });

  const stream = await getFileMediaStream(entry.accountEmail, entry.driveFileId);
  return new Response(stream, {
    headers: {
      "Content-Type": entry.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(entry.name)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
