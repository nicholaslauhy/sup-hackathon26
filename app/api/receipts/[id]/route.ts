import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfile } from "@/lib/server/accounts";
import { RECEIPT_COLUMNS, toReceiptRecord, type FinalDecision, type ReceiptRow } from "@/lib/server/receipts";

export const dynamic = "force-dynamic";

const DECISIONS: FinalDecision[] = ["authentic", "rejected"];

// HR uses the single admin account to record the final reimbursement decision.
// Writes go through the service-role client (RLS blocks authenticated updates),
// gated on the admin role.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await findProfile(user.id);
  if (!account) return NextResponse.json({ error: "Account profile not found." }, { status: 404 });
  if (account.role !== "admin") {
    return NextResponse.json({ error: "Only HR can approve or reject claims." }, { status: 403 });
  }

  const body = await request.json() as { decision?: string };
  const decision = body.decision as FinalDecision;
  if (!DECISIONS.includes(decision)) {
    return NextResponse.json({ error: "Decision must be 'authentic' or 'rejected'." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("receipts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });

  const { data: updated, error: updateError } = await admin
    .from("receipts")
    .update({ final_decision: decision, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .select(RECEIPT_COLUMNS)
    .single();
  if (updateError || !updated) return NextResponse.json({ error: "Unable to save the decision." }, { status: 500 });

  return NextResponse.json({ receipt: toReceiptRecord(updated as ReceiptRow) });
}

// The uploader (or an admin) can delete a receipt and its stored file. Like the
// PATCH above, deletes run through the service-role client because RLS blocks
// authenticated writes; ownership is enforced here.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await findProfile(user.id);
  if (!account) return NextResponse.json({ error: "Account profile not found." }, { status: 404 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("receipts")
    .select("id,uploaded_by,file_path")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  if (existing.uploaded_by !== user.id && account.role !== "admin") {
    return NextResponse.json({ error: "You can only delete your own receipts." }, { status: 403 });
  }

  const { error: deleteError } = await admin.from("receipts").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: "Unable to delete the receipt." }, { status: 500 });

  // Remove the stored file (best effort; the row is already gone).
  if (existing.file_path) await admin.storage.from("receipts").remove([existing.file_path]);

  return NextResponse.json({ ok: true });
}
