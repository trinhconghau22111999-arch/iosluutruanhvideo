import { NextResponse } from "next/server";
import { copyFileToAccount, deleteFileFromDrive } from "@/lib/google";
import { getLibraryEntry, updateLibraryEntry } from "@/lib/library";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Executes a single planned move: copy the file's bytes to the destination
// account, then delete the original from the source account, then point the
// library record at the new copy. Only deletes the original after the copy
// has fully succeeded, so a failure partway through never loses the file —
// worst case it just temporarily exists in both accounts.
export async function POST(request) {
  const { id, toEmail } = await request.json();
  if (!id || !toEmail) {
    return NextResponse.json({ error: "Thiếu thông tin để chuyển file" }, { status: 400 });
  }

  const entry = await getLibraryEntry(id);
  if (!entry) return NextResponse.json({ error: "Không tìm thấy file" }, { status: 404 });
  if (entry.accountEmail === toEmail) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const newFile = await copyFileToAccount(entry.accountEmail, toEmail, entry.driveFileId, {
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size,
  });

  try {
    await deleteFileFromDrive(entry.accountEmail, entry.driveFileId);
  } catch (err) {
    // The copy already succeeded and Firestore is about to point at the new
    // file either way — a leftover original on the source account just
    // means a little wasted space, not a data-loss risk, so this is only
    // logged rather than failing the whole move.
    console.warn(`Không xoá được bản gốc trên ${entry.accountEmail}:`, err.message);
  }

  await updateLibraryEntry(id, {
    accountEmail: toEmail,
    driveFileId: newFile.id,
    driveLink: newFile.webViewLink,
    thumbnailLink: newFile.thumbnailLink || null,
  });

  return NextResponse.json({ ok: true });
}
