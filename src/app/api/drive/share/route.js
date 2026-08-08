import { NextResponse } from "next/server";
import { shareFileOnDrive } from "@/lib/google";
import { getLibraryEntry, updateLibraryEntry } from "@/lib/library";

export async function POST(request) {
  const { id } = await request.json();
  const entry = await getLibraryEntry(id);
  if (!entry) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  if (entry.shareLink) {
    return NextResponse.json({ link: entry.shareLink });
  }

  const link = await shareFileOnDrive(entry.accountEmail, entry.driveFileId);
  await updateLibraryEntry(id, { shareLink: link });
  return NextResponse.json({ link });
}
