import { NextResponse } from "next/server";
import { deleteFileFromDrive } from "@/lib/google";
import { getLibraryEntry, deleteLibraryEntry } from "@/lib/library";

export async function POST(request) {
  const { id } = await request.json();
  const entry = await getLibraryEntry(id);
  if (!entry) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  try {
    await deleteFileFromDrive(entry.accountEmail, entry.driveFileId);
  } catch (err) {
    // File may already be gone from Drive; still clean up our record.
    console.warn("Xoá trên Drive lỗi (tiếp tục xoá bản ghi):", err.message);
  }
  await deleteLibraryEntry(id);
  return NextResponse.json({ ok: true });
}
