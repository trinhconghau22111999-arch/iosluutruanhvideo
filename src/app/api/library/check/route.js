import { NextResponse } from "next/server";
import { getExistingDedupeKeys } from "@/lib/library";

export async function POST(request) {
  const { keys } = await request.json();
  if (!Array.isArray(keys)) {
    return NextResponse.json({ error: "keys phải là mảng" }, { status: 400 });
  }
  const existing = await getExistingDedupeKeys(keys);
  return NextResponse.json({ existing: Array.from(existing) });
}
