import { NextResponse } from "next/server";
import { handleOAuthCallback } from "@/lib/google";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const base = process.env.APP_BASE_URL || "http://localhost:3000";

  if (!code) {
    return NextResponse.redirect(`${base}/tai-khoan?error=missing_code`);
  }

  try {
    const email = await handleOAuthCallback(code);
    return NextResponse.redirect(`${base}/tai-khoan?connected=${encodeURIComponent(email)}`);
  } catch (err) {
    console.error(err);
    return NextResponse.redirect(`${base}/tai-khoan?error=${encodeURIComponent(err.message)}`);
  }
}
