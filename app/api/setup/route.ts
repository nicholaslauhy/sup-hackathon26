import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toAccount } from "@/lib/server/accounts";

export const dynamic = "force-dynamic";

type SetupBody = { name?: string; email?: string; password?: string };

export async function POST(request: Request) {
  const body = await request.json() as SetupBody;
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!name || !email || password.length < 8) {
    return NextResponse.json({ error: "Name, email, and a password of at least 8 characters are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true });
  if (countError) return NextResponse.json({ error: "Unable to check account setup." }, { status: 500 });
  if ((count ?? 0) > 0) return NextResponse.json({ error: "The first account has already been created." }, { status: 409 });

  const { data, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role: "admin" },
  });
  if (authError || !data.user) {
    const message = authError?.message.toLowerCase().includes("registered")
      ? "An account with this email already exists."
      : "Unable to create the admin account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const profile = { id: data.user.id, name, email, role: "admin" as const };
  const { data: created, error: profileError } = await admin
    .from("profiles")
    .insert(profile)
    .select("id,name,email,role,created_at")
    .single();

  if (profileError || !created) {
    await admin.auth.admin.deleteUser(data.user.id);
    const message = profileError?.code === "23505"
      ? "An admin account already exists."
      : "Unable to create the admin profile.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  return NextResponse.json({ account: toAccount(created) }, { status: 201 });
}
