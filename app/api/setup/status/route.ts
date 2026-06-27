import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { count, error } = await createAdminClient()
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (error) return NextResponse.json({ error: "Unable to read account setup status." }, { status: 500 });
  return NextResponse.json({ hasAccounts: (count ?? 0) > 0 });
}
