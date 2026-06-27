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
  // Flag ids HR has dismissed as false positives (e.g. a misfired AI check).
  ignoredFlags: string[];
  uploader: { name: string; email: string } | null;
};

export type ClaimSubmission = {
  id: string;
  fileName: string;
  claimType: ReceiptType;
  createdAt: string;
};

export type ClaimHistoryRecord = {
  id: string;
  claimType: ReceiptType;
  fileName: string;
  finalDecision: FinalDecision;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
};

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: { error?: string } | T | null = null;

  if (text.trim()) {
    try {
      body = JSON.parse(text) as { error?: string } | T;
    } catch {
      if (!response.ok) {
        throw new Error("The server returned an unreadable error response.");
      }
      throw new Error("The server returned an unreadable response.");
    }
  }

  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body
      ? body.error
      : null;
    throw new Error(error ?? "The request could not be completed.");
  }

  if (!body) throw new Error("The server returned an empty response.");
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

export async function getClaimHistory(): Promise<ClaimHistoryRecord[]> {
  return readJson<{ receipts: ClaimHistoryRecord[] }>(
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

// HR marks a fraud-check flag as a false positive (or restores it). Sends the
// full desired set of ignored flag ids; the server de-duplicates and persists.
export async function setIgnoredFlags(id: string, ignoredFlags: string[]): Promise<ReceiptRecord> {
  return readJson<{ receipt: ReceiptRecord }>(
    await fetch(`/api/receipts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ignoredFlags }),
    }),
  ).then((body) => body.receipt);
}

export async function deleteReceipt(id: string): Promise<void> {
  await readJson<{ ok: true }>(
    await fetch(`/api/receipts/${id}`, { method: "DELETE" }),
  );
}
