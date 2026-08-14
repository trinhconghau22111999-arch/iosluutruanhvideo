import { getLibraryEntry } from "@/lib/library";
import { getAccessToken } from "@/lib/google";

export const dynamic = "force-dynamic";

// Streams a file inline for the in-app viewer.
//
// iOS Safari REQUIRES HTTP 206 Partial Content + Range support to play video
// at all — it won't even start a video that returns HTTP 200 for the whole
// file. This route handles the Range header properly so video works on iPhone.
//
// Flow:
// 1. Look up the Firestore entry to get accountEmail + driveFileId.
// 2. Get a short-lived access token for that account.
// 3. Fetch from Google Drive, forwarding the Range header if present.
// 4. Mirror Google's response status (200 or 206) and relevant headers back
//    to the browser — Accept-Ranges, Content-Range, Content-Length.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return new Response("Thiếu id", { status: 400 });

  const entry = await getLibraryEntry(id);
  if (!entry) return new Response("Không tìm thấy", { status: 404 });

  const accessToken = await getAccessToken(entry.accountEmail);

  // Forward Range header from the browser to Google Drive so iOS can seek
  // and buffer video in chunks instead of needing the whole file up front.
  const rangeHeader = request.headers.get("Range");
  const driveHeaders = {
    Authorization: `Bearer ${accessToken}`,
    ...(rangeHeader ? { Range: rangeHeader } : {}),
  };

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${entry.driveFileId}?alt=media`;
  const driveRes = await fetch(driveUrl, { headers: driveHeaders });

  if (!driveRes.ok && driveRes.status !== 206) {
    return new Response(`Không lấy được file từ Drive (${driveRes.status})`, {
      status: driveRes.status,
    });
  }

  // Mirror the headers iOS/Chrome need to play video correctly.
  const responseHeaders = {
    "Content-Type": entry.mimeType || driveRes.headers.get("Content-Type") || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  // Content-Length and Content-Range must be forwarded exactly as Google
  // returns them — iOS Safari uses these to know the total file size and
  // which byte range it received, so it can seek the video scrubber correctly.
  const contentLength = driveRes.headers.get("Content-Length");
  if (contentLength) responseHeaders["Content-Length"] = contentLength;

  const contentRange = driveRes.headers.get("Content-Range");
  if (contentRange) responseHeaders["Content-Range"] = contentRange;

  return new Response(driveRes.body, {
    status: driveRes.status, // 200 khi không có Range, 206 khi có Range
    headers: responseHeaders,
  });
}
