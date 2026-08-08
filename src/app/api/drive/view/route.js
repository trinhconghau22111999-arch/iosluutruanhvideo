import { getFileMediaStream } from "@/lib/google";
import { getLibraryEntry } from "@/lib/library";

export const dynamic = "force-dynamic";

// Streams the file inline (no Content-Disposition: attachment) so tapping a
// tile opens the actual photo/video straight in the browser — no Google
// sign-in needed, since the server already holds the access token.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const entry = await getLibraryEntry(id);
  if (!entry) return new Response("Không tìm thấy", { status: 404 });

  const stream = await getFileMediaStream(entry.accountEmail, entry.driveFileId);
  return new Response(stream, {
    headers: {
      "Content-Type": entry.mimeType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
