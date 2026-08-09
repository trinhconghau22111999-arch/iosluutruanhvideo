import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Step 2 of the upload flow. The browser sends the file in ~4MB chunks to
// THIS route (same origin — never blocked by CORS, and always safely under
// Vercel's 4.5MB request body cap). This route then forwards each chunk to
// Google's resumable session URL as a server-to-server request, which is
// never subject to browser CORS rules at all. This sidesteps entirely the
// question of whether Google's upload endpoint allows direct cross-origin
// PUTs from arbitrary web app origins — it doesn't matter, because the
// browser never talks to Google directly for the actual bytes.
export async function POST(request) {
  const sessionUrl = request.headers.get("x-session-url");
  const totalSize = Number(request.headers.get("x-total-size"));
  const chunkStart = Number(request.headers.get("x-chunk-start"));

  if (!sessionUrl || !Number.isFinite(totalSize) || !Number.isFinite(chunkStart)) {
    return NextResponse.json({ error: "Thiếu thông tin phần tải lên" }, { status: 400 });
  }

  let sessionHost;
  try {
    sessionHost = new URL(sessionUrl).host;
  } catch {
    return NextResponse.json({ error: "Địa chỉ phiên tải lên không hợp lệ" }, { status: 400 });
  }
  if (sessionHost !== "www.googleapis.com") {
    // The session URL always comes from our own /init route, but double
    // check it really points at Google before relaying anything to it.
    return NextResponse.json({ error: "Địa chỉ phiên tải lên không hợp lệ" }, { status: 400 });
  }

  const chunkBuffer = Buffer.from(await request.arrayBuffer());
  if (chunkBuffer.length === 0) {
    return NextResponse.json({ error: "Phần tải lên rỗng" }, { status: 400 });
  }
  const chunkEnd = chunkStart + chunkBuffer.length - 1;

  let googleRes;
  try {
    googleRes = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${chunkStart}-${chunkEnd}/${totalSize}`,
        "Content-Length": String(chunkBuffer.length),
      },
      body: chunkBuffer,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Không kết nối được tới Google: ${err.message}` },
      { status: 502 }
    );
  }

  if (googleRes.status === 308) {
    // Google has this chunk, expects more — tell the browser to send the
    // next one.
    return NextResponse.json({ status: "incomplete" });
  }

  if (googleRes.ok) {
    const file = await googleRes.json();
    return NextResponse.json({ status: "complete", file });
  }

  const text = await googleRes.text().catch(() => "");
  return NextResponse.json(
    { error: `Google trả lỗi ${googleRes.status}: ${text.slice(0, 300)}` },
    { status: 502 }
  );
}
