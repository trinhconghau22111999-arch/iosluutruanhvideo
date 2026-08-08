import { getFileMediaStream } from "@/lib/google";
import { getLibraryEntry } from "@/lib/library";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const entry = await getLibraryEntry(id);
  if (!entry) return new Response("Không tìm thấy", { status: 404 });

  // Only proxy actual bytes for images; videos are opened directly in Drive
  // to avoid streaming large files through the server.
  if (!entry.mimeType?.startsWith("image/")) {
    return new Response("Không hỗ trợ xem trước video ở đây", { status: 400 });
  }

  const stream = await getFileMediaStream(entry.accountEmail, entry.driveFileId);
  return new Response(stream, {
    headers: {
      "Content-Type": entry.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
