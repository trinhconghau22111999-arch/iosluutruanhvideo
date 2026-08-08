import { NextResponse } from "next/server";
import { listLibrary } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listLibrary();
  return NextResponse.json({ items });
}
