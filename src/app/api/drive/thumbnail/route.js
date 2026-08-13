import { getFileMediaStream, getDriveClient } from "@/lib/google";
import { getLibraryEntry, updateLibraryEntry } from "@/lib/library";

export const dynamic = "force-dynamic";

// Drive's thumbnailLink defaults to a smallish size (e.g. "=s220"); grid
// tiles are at least 150 CSS px wide, and on high-density phone screens
// (DPR 2-3x) that needs 300-450 real pixels to look sharp — so we request
// 220px source images (up from 100px) as a middle ground between crisp
// thumbnails and payload size. This works for both images and videos,
// since Drive generates a frame preview for videos too.
function resizeThumbnailUrl(url, size = 220) {
  return /=s\d+$/.test(url) ? url.replace(/=s\d+$/, `=s${size}`) : `${url}=s${size}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const entry = await getLibraryEntry(id);
  if (!entry) return new Response("Không tìm thấy", { status: 404 });

  const isImage = entry.mimeType?.startsWith("image/");
  let thumbnailLink = entry.thumbnailLink;

  // Drive often hasn't finished generating a thumbnail yet at the moment a
  // file (especially a video) finishes uploading, so the value saved back
  // then can still be empty. Re-check live with Drive rather than being
  // stuck with "no thumbnail" forever — and save it back so this extra
  // round-trip only ever happens once per file.
  if (!thumbnailLink) {
    try {
      const drive = await getDriveClient(entry.accountEmail);
      const { data } = await drive.files.get({
        fileId: entry.driveFileId,
        fields: "thumbnailLink",
      });
      if (data.thumbnailLink) {
        thumbnailLink = data.thumbnailLink;
        updateLibraryEntry(id, { thumbnailLink }).catch(() => {});
      }
    } catch {
      // Ignore — falls through to the no-thumbnail handling below.
    }
  }

  // Google already generates a small, fast-loading thumbnail for both
  // images and videos — use that for the grid instead of streaming the
  // full original, which can easily be tens (or for video, hundreds) of
  // times larger and much slower to load when a whole page of tiles is
  // loading at once.
  if (thumbnailLink) {
    try {
      const res = await fetch(resizeThumbnailUrl(thumbnailLink, 220));
      if (res.ok && res.body) {
        return new Response(res.body, {
          headers: {
            "Content-Type": res.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "private, max-age=86400",
          },
        });
      }
    } catch {
      // Fall through below.
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
