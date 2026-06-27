import "server-only";
import type { AnalysisResult, ReceiptType, Tier } from "@/lib/analysis/types";

export type FinalDecision = "pending" | "authentic" | "rejected";

// Client-facing shape returned by the receipts API.
export type ReceiptRecord = {
  id: string;
  claimType: ReceiptType;
  fileName: string;
  fileKind: string;
  score: number;
  tier: Tier;
  result: AnalysisResult;
  finalDecision: FinalDecision;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  uploader: { name: string; email: string } | null;
};

type UploaderJoin = { name: string; email: string } | { name: string; email: string }[] | null;

export type ReceiptRow = {
  id: string;
  uploaded_by: string;
  claim_type: ReceiptType;
  file_name: string;
  file_kind: string;
  score: number;
  tier: Tier;
  result: AnalysisResult;
  final_decision: FinalDecision;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  uploader?: UploaderJoin;
};

export const RECEIPT_COLUMNS =
  "id,uploaded_by,claim_type,file_name,file_kind,score,tier,result,final_decision,status,created_at,reviewed_at";

export function toReceiptRecord(row: ReceiptRow): ReceiptRecord {
  const uploaderRaw = Array.isArray(row.uploader) ? row.uploader[0] : row.uploader;
  return {
    id: row.id,
    claimType: row.claim_type,
    fileName: row.file_name,
    fileKind: row.file_kind,
    score: row.score,
    tier: row.tier,
    result: row.result,
    finalDecision: row.final_decision,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    uploader: uploaderRaw ? { name: uploaderRaw.name, email: uploaderRaw.email } : null,
  };
}
