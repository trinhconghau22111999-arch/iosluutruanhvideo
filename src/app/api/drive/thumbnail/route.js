import { getFileMediaStream } from "@/lib/google";
import { getLibraryEntry } from "@/lib/library";

export const dynamic = "force-dynamic";

// Drive's thumbnailLink defaults to a smallish size (e.g. "=s220"); a grid
// tile only needs to be about this big on screen, so requesting a small
// size keeps the payload tiny and the grid fast — this works for both
// images and videos, since Drive generates a frame preview for videos too.
function resizeThumbnailUrl(url, size = 100) {
  return /=s\d+$/.test(url) ? url.replace(/=s\d+$/, `=s${size}`) : `${url}=s${size}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const entry = await getLibraryEntry(id);
  if (!entry) return new Response("Không tìm thấy", { status: 404 });

  const isImage = entry.mimeType?.startsWith("image/");

  // Google already generates a small, fast-loading thumbnail for both
  // images and videos — use that for the grid instead of streaming the
  // full original, which can easily be tens (or for video, hundreds) of
  // times larger and much slower to load when a whole page of tiles is
  // loading at once.
  if (entry.thumbnailLink) {
    try {
      const res = await fetch(resizeThumbnailUrl(entry.thumbnailLink, 100));
      if (res.ok && res.body) {
        return new Response(res.body, {
          headers: {
            "Content-Type": res.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "private, max-age=86400",
          },
        });
      }
    } catch {
      // Fall through below — e.g. Drive hasn't finished generating a
      // thumbnail yet for a just-uploaded file.
    }
  }

  // No thumbnail available. For images we can still fall back to streaming
  // the full original; for video there's nothing sensible to show here, so
  // the client falls back to a plain play-icon glyph instead.
  if (!isImage) {
    return new Response("Chưa có ảnh xem trước", { status: 404 });
  }

  const stream = await getFileMediaStream(entry.accountEmail, entry.driveFileId);
  return new Response(stream, {
    headers: {
      "Content-Type": entry.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
