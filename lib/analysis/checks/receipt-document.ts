import type { Flag } from "../types";
import type { ExtractResult } from "../extract";
import type { DocumentShape } from "../shape";

// Vocabulary that overwhelmingly appears on receipts / invoices but rarely on
// an unrelated document (a contract, a photo, a screenshot of a chat, etc.).
// Matched whole-word, case-insensitively, against the extracted text.
const RECEIPT_TERMS = [
  "receipt",
  "invoice",
  "tax invoice",
  "subtotal",
  "sub-total",
  "total",
  "grand total",
  "amount due",
  "balance due",
  "gst",
  "vat",
  "sales tax",
  "qty",
  "quantity",
  "unit price",
  "cash",
  "change",
  "payment",
  "paid",
  "card",
  "visa",
  "mastercard",
  "paynow",
  "nets",
  "cashier",
  "merchant",
  "order no",
  "receipt no",
  "thank you",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchedTerms(text: string): string[] {
  return RECEIPT_TERMS.filter((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text));
}

// "Is this submission even a receipt?" Combines two no-AI signals computed
// elsewhere: the document-shape proxy (image is paper-and-ink, not a scene) and
// the extracted text's receipt properties (monetary amounts + receipt terms).
// Runs before the reviewer treats the other checks as meaningful.
export function receiptDocumentFlag(extract: ExtractResult | null, shape: DocumentShape | null): Flag {
  const text = extract && extract.source !== "none" ? extract.rawText : "";
  const hasText = text.trim().length > 0;

  const terms = hasText ? matchedTerms(text) : [];
  const moneyTokens = hasText ? (text.match(/\d[\d,]*\.\d{2}\b/g) ?? []).length : 0;
  const hasExtractedAmounts = Boolean(
    extract &&
      (extract.fields.total !== undefined ||
        extract.fields.subtotal !== undefined ||
        extract.fields.lineItems?.length),
  );

  // Conservative: bias against falsely rejecting a genuine (if messy) receipt.
  // Any one strong signal is enough to pass.
  const looksLikeReceipt =
    hasExtractedAmounts || (moneyTokens >= 1 && terms.length >= 2) || terms.length >= 3;

  const evidence = {
    matchedTerms: terms,
    termCount: terms.length,
    moneyTokens,
    hasExtractedAmounts,
    shape: shape
      ? {
          documentLike: shape.documentLike,
          brightFraction: shape.brightFraction,
          darkFraction: shape.darkFraction,
          aspectRatio: shape.aspectRatio,
        }
      : null,
  };

  if (looksLikeReceipt) {
    return {
      id: "is-receipt",
      title: "Document looks like a receipt",
      severity: "info",
      status: "passed",
      explanation: "The document contains the monetary amounts and receipt terms expected of a receipt or invoice.",
      evidence,
    };
  }

  // No receipt content found. If the image is not even document-shaped, this is
  // the strongest "wrong file" signal.
  if (shape && !shape.documentLike) {
    return {
      id: "is-receipt",
      title: "Does not appear to be a receipt",
      severity: "medium",
      status: "triggered",
      explanation:
        "The image does not look like a photo of a document (paper and print) and contains no receipt amounts or terms. It is likely the wrong file or an unrelated image.",
      evidence,
    };
  }

  // We could read the document (a shaped image, or a text PDF) but found none
  // of the amounts/terms a receipt should have.
  if (shape || hasText) {
    return {
      id: "is-receipt",
      title: "May not be a receipt",
      severity: "medium",
      status: "triggered",
      explanation:
        "No monetary amounts or receipt terms typical of a receipt or invoice were found, so the document may not be a receipt. Worth a manual look.",
      evidence,
    };
  }

  // Nothing to judge on (HEIC, or an image-only PDF we cannot OCR).
  return {
    id: "is-receipt",
    title: "Receipt format not determined",
    severity: "info",
    status: "pending",
    explanation: "Could not read enough from the document to confirm whether it is a receipt.",
    evidence,
  };
}
