import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findProfile } from "@/lib/server/accounts";
import { toReceiptRecord, type ReceiptRow } from "@/lib/server/receipts";

export const dynamic = "force-dynamic";

// Admins see every check; members see only their own. Row visibility is also
// enforced by RLS, so the session client returns the correct subset either way.
const SELECT_WITH_UPLOADER =
  "id,uploaded_by,claim_type,file_name,file_kind,score,tier,result,final_decision,status,created_at,reviewed_at,uploader:profiles!receipts_uploaded_by_fkey(name,email)";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await findProfile(user.id);
  if (!account) return NextResponse.json({ error: "Account profile not found." }, { status: 404 });

  const { data, error: queryError } = await supabase
    .from("receipts")
    .select(SELECT_WITH_UPLOADER)
    .order("created_at", { ascending: false });
  if (queryError) return NextResponse.json({ error: "Unable to load receipts." }, { status: 500 });

  return NextResponse.json({ receipts: (data ?? []).map((row) => toReceiptRecord(row as unknown as ReceiptRow)) });
}
