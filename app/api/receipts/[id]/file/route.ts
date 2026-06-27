import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfile } from "@/lib/server/accounts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const raw = url.searchParams.get("raw") === "1";

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await findProfile(user.id);
  if (!account) return NextResponse.json({ error: "Account profile not found." }, { status: 404 });

  const admin = createAdminClient();
  const { data: receipt, error: receiptError } = await admin
    .from("receipts")
    .select("id,uploaded_by,file_path,file_kind")
    .eq("id", id)
    .maybeSingle();

  if (receiptError || !receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  if (receipt.uploaded_by !== user.id && account.role !== "admin") {
    return NextResponse.json({ error: "You can only view receipts you are allowed to review." }, { status: 403 });
  }

  if (raw) {
    const { data: file, error: downloadError } = await admin.storage
      .from("receipts")
      .download(receipt.file_path);

    if (downloadError || !file) {
      return NextResponse.json({ error: "Unable to load the receipt file." }, { status: 500 });
    }

    return new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  const { data: signed, error: signedError } = await admin.storage
    .from("receipts")
    .createSignedUrl(receipt.file_path, 60 * 5);

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: "Unable to load the receipt file." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, fileKind: receipt.file_kind });
}
