import { getFileMediaStream } from "@/lib/google";
import { getLibraryEntry } from "@/lib/library";

export const dynamic = "force-dynamic";

// Google's thumbnailLink defaults to a smallish size (e.g. "=s220"); bump it
// up a bit so grid tiles stay crisp on high-DPI phone screens while staying
// far smaller/faster than the original file.
function upsizeThumbnailUrl(url) {
  return /=s\d+$/.test(url) ? url.replace(/=s\d+$/, "=s400") : `${url}=s400`;
}

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

  // Google already generates a small, fast-loading thumbnail for every
  // image — use that for the grid instead of streaming the full original,
  // which can easily be tens of times larger and much slower to load when a
  // whole page of tiles is loading at once.
  if (entry.thumbnailLink) {
    try {
      const res = await fetch(upsizeThumbnailUrl(entry.thumbnailLink));
      if (res.ok && res.body) {
        return new Response(res.body, {
          headers: {
            "Content-Type": res.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "private, max-age=86400",
          },
        });
      }
    } catch {
      // Fall through to the full-size proxy below — e.g. Drive hasn't
      // finished generating a thumbnail yet for a just-uploaded file.
    }
  }

  const stream = await getFileMediaStream(entry.accountEmail, entry.driveFileId);
  return new Response(stream, {
    headers: {
      "Content-Type": entry.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
