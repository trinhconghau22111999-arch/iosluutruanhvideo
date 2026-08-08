import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google";

export async function GET() {
  const url = buildAuthUrl("connect");
  return NextResponse.redirect(url);
}
