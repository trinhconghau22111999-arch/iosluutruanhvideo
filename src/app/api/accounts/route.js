import { NextResponse } from "next/server";
import { listAccounts, removeAccount } from "@/lib/library";
import { getStorageQuota } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await listAccounts();
  const withQuota = await Promise.all(
    accounts.map(async (acc) => {
      try {
        const quota = await getStorageQuota(acc.email);
        return { ...acc, quota };
      } catch (err) {
        return { ...acc, quota: null, error: "Không lấy được dung lượng" };
      }
    })
  );
  return NextResponse.json({ accounts: withQuota });
}

export async function DELETE(request) {
  const { email } = await request.json();
  if (!email) return NextResponse.json({ error: "Thiếu email" }, { status: 400 });
  await removeAccount(email);
  return NextResponse.json({ ok: true });
}
