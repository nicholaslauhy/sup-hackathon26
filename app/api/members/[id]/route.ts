import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfile } from "@/lib/server/accounts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "Not signed in.", status: 401 as const };
  const account = await findProfile(user.id);
  if (account?.role !== "admin") return { error: "Only admins can manage accounts.", status: 403 as const };
  return { account };
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await requireAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });

  if (authorization.account.id === id) {
    return NextResponse.json({ error: "You cannot delete your own signed-in admin account." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,role")
    .eq("id", id)
    .maybeSingle();

  if (targetError || !target) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  if (target.role === "admin") {
    const { count, error: countError } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if (countError) return NextResponse.json({ error: "Unable to verify admin accounts." }, { status: 500 });
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "You must keep at least one admin account." }, { status: 400 });
    }
  }

  const { error: authError } = await admin.auth.admin.deleteUser(id);
  if (authError) return NextResponse.json({ error: "Unable to delete the login user." }, { status: 500 });

  // public.profiles has `on delete cascade` from auth.users, but this is kept
  // as a cleanup fallback in case the row still exists.
  await admin.from("profiles").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}
