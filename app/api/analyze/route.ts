import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProfile } from "@/lib/server/accounts";
import { RECEIPT_COLUMNS, toReceiptRecord, type ReceiptRow } from "@/lib/server/receipts";
import { analyzeReceipt, type DuplicateMatch, type FileKind } from "@/lib/analysis/analyze";
import { claimTypeMismatchMessage } from "@/lib/analysis/claim-type-classifier";
import { validateSelectedClaimType } from "@/lib/analysis/claim-type-preflight";
import { contentHash, hammingDistance, perceptualHash } from "@/lib/analysis/hash";
import type { ReceiptType } from "@/lib/analysis/types";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const CLAIM_TYPES: ReceiptType[] = ["medical", "purchase", "grab"];
const NEAR_DUPLICATE_THRESHOLD = 6; // max Hamming distance to treat as near-duplicate

function detectFileKind(name: string, type: string): FileKind | null {
  const ext = name.toLowerCase().split(".").pop();
  if (type === "application/pdf" || ext === "pdf") return "PDF";
  if (type === "image/jpeg" || ext === "jpg" || ext === "jpeg") return "JPEG";
  if (type === "image/png" || ext === "png") return "PNG";
  if (type === "image/heic" || type === "image/heif" || ext === "heic" || ext === "heif") return "HEIC";
  return null;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "receipt";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  let stage = "start";

  try {
    stage = "auth";
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    stage = "profile";
    const account = await findProfile(user.id);
    if (!account) return NextResponse.json({ error: "Account profile not found." }, { status: 404 });
    if (account.role !== "member") {
      return NextResponse.json({ error: "Only employees can submit claims." }, { status: 403 });
    }

    stage = "form";
    const form = await request.formData();
    const file = form.get("file");
    const claimType = String(form.get("claimType") ?? "") as ReceiptType;

    if (!CLAIM_TYPES.includes(claimType)) {
      return NextResponse.json({ error: "Choose a valid receipt type." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach a receipt file." }, { status: 400 });
    }
    const fileKind = detectFileKind(file.name, file.type);
    if (!fileKind) {
      return NextResponse.json({ error: "Unsupported file type. Use PDF, JPEG, PNG, or HEIC." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "The file must be 10 MB or smaller." }, { status: 400 });
    }

    stage = "read-file";
    const bytes = Buffer.from(await file.arrayBuffer());

    stage = "claim-type-preflight";
    const claimTypeDecision = await validateSelectedClaimType({
      bytes,
      fileKind,
      selectedClaimType: claimType,
    });
    if (claimTypeDecision.status === "mismatch") {
      return NextResponse.json({
        error: claimTypeMismatchMessage(claimType),
        detectedType: claimTypeDecision.detectedType,
        confidence: claimTypeDecision.confidence,
        reasons: claimTypeDecision.reasons,
      }, { status: 400 });
    }

    stage = "hashing";
    const hash = contentHash(bytes);
    const phash = await perceptualHash(bytes, fileKind);

    stage = "admin-client";
    const admin = createAdminClient();

    // Duplicate detection: exact content-hash match first, then near-duplicate
    // by perceptual-hash distance against prior submissions.
    stage = "duplicate-check";
    let duplicate: DuplicateMatch | null = null;
    const { data: exactMatch } = await admin
      .from("receipts")
      .select("id,file_name,uploaded_by")
      .eq("content_hash", hash)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (exactMatch) {
      duplicate = { exact: true, receiptId: exactMatch.id, fileName: exactMatch.file_name, uploadedBy: exactMatch.uploaded_by };
    } else if (phash) {
      const { data: candidates } = await admin
        .from("receipts")
        .select("id,file_name,uploaded_by,perceptual_hash")
        .not("perceptual_hash", "is", null);
      for (const candidate of candidates ?? []) {
        const distance = hammingDistance(phash, candidate.perceptual_hash as string);
        if (distance <= NEAR_DUPLICATE_THRESHOLD) {
          duplicate = { exact: false, receiptId: candidate.id, fileName: candidate.file_name, uploadedBy: candidate.uploaded_by, distance };
          break;
        }
      }
    }

    stage = "analysis";
    const result = await analyzeReceipt({
      bytes,
      fileKind,
      claimType,
      contentHash: hash,
      perceptualHash: phash,
      duplicate,
    });

    // Store the file (best effort; analysis still returns if storage fails).
    stage = "storage-upload";
    const filePath = `${user.id}/${Date.now()}-${safeName(file.name)}`;
    const { error: uploadError } = await admin.storage
      .from("receipts")
      .upload(filePath, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: "Unable to store the uploaded file." }, { status: 500 });
    }

    stage = "database-insert";
    const { data: inserted, error: insertError } = await admin
      .from("receipts")
      .insert({
        uploaded_by: user.id,
        claim_type: claimType,
        file_name: file.name,
        file_path: filePath,
        file_kind: fileKind,
        content_hash: hash,
        perceptual_hash: phash,
        score: result.score,
        tier: result.tier,
        result,
        status: "complete",
      })
      .select(RECEIPT_COLUMNS)
      .single();
    if (insertError || !inserted) {
      await admin.storage.from("receipts").remove([filePath]);
      return NextResponse.json({ error: "Unable to save the analysis result." }, { status: 500 });
    }

    const receipt = toReceiptRecord(inserted as ReceiptRow);
    return NextResponse.json({
      submission: {
        id: receipt.id,
        fileName: receipt.fileName,
        claimType: receipt.claimType,
        createdAt: receipt.createdAt,
      },
    }, { status: 201 });
  } catch (error) {
    console.error(`Receipt analysis failed during ${stage}:`, error);
    const detail = process.env.NODE_ENV === "production" ? null : errorMessage(error);
    return NextResponse.json({
      error: detail
        ? `Unable to process this receipt during ${stage}: ${detail}`
        : "Unable to process this receipt. Please try another file or check the server logs.",
      stage,
    }, { status: 500 });
  }
}
