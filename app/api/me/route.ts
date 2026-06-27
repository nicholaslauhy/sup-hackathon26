import { NextResponse } from "next/server";
import { findProfile } from "@/lib/server/accounts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await findProfile(user.id);
  if (!account) return NextResponse.json({ error: "Account profile not found." }, { status: 404 });
  return NextResponse.json({ account });
}
