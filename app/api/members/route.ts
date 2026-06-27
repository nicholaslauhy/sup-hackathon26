import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfile, toAccount } from "@/lib/server/accounts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MemberBody = { name?: string; email?: string; password?: string; role?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "Not signed in.", status: 401 as const };
  const account = await findProfile(user.id);
  if (account?.role !== "admin") return { error: "Only admins can manage accounts.", status: 403 as const };
  return { account };
}

export async function GET() {
  const authorization = await requireAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });

  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id,name,email,role,created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Unable to load accounts." }, { status: 500 });
  return NextResponse.json({ accounts: (data ?? []).map(toAccount) });
}

export async function POST(request: Request) {
  const authorization = await requireAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });

  const body = await request.json() as MemberBody;
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : null;
  if (!name || !email || password.length < 8 || !role) {
    return NextResponse.json({ error: "Name, email, role, and a temporary password of at least 8 characters are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role },
  });
  if (authError || !data.user) {
    const message = authError?.message.toLowerCase().includes("registered")
      ? "An account with this email already exists."
      : "Unable to create the account login.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { data: created, error: profileError } = await admin
    .from("profiles")
    .insert({ id: data.user.id, name, email, role })
    .select("id,name,email,role,created_at")
    .single();
  if (profileError || !created) {
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: "Unable to create the account profile." }, { status: 500 });
  }

  const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/update-password`,
  });
  if (resetError) {
    await admin.from("profiles").delete().eq("id", data.user.id);
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: "The account was not created because the password reset email could not be sent." }, { status: 500 });
  }

  return NextResponse.json({ account: toAccount(created) }, { status: 201 });
}
