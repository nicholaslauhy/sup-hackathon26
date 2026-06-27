import type { AnalysisResult, ReceiptType, Tier } from "@/lib/analysis/types";

export type FinalDecision = "pending" | "authentic" | "rejected";

// Client-facing receipt shape (mirrors the server's ReceiptRecord, kept here so
// client components don't import server-only modules).
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

export type ClaimSubmission = {
  id: string;
  fileName: string;
  claimType: ReceiptType;
  createdAt: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
  return body as T;
}

export async function analyzeReceipt(file: File, claimType: ReceiptType): Promise<ClaimSubmission> {
  const form = new FormData();
  form.append("file", file);
  form.append("claimType", claimType);
  return readJson<{ submission: ClaimSubmission }>(
    await fetch("/api/analyze", { method: "POST", body: form }),
  ).then((body) => body.submission);
}

export async function getReceipts(): Promise<ReceiptRecord[]> {
  return readJson<{ receipts: ReceiptRecord[] }>(
    await fetch("/api/receipts", { cache: "no-store" }),
  ).then((body) => body.receipts);
}

export async function recordDecision(id: string, decision: "authentic" | "rejected"): Promise<ReceiptRecord> {
  return readJson<{ receipt: ReceiptRecord }>(
    await fetch(`/api/receipts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }),
  ).then((body) => body.receipt);
}

export async function deleteReceipt(id: string): Promise<void> {
  await readJson<{ ok: true }>(
    await fetch(`/api/receipts/${id}`, { method: "DELETE" }),
  );
}
