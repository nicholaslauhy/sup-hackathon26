import type { ExtractedFields, Flag } from "../types";

// Minimum extraction confidence (0-100) below which we refuse to judge the
// math and keep the flag `pending`. A failed extraction must never surface as
// a false `passed`.
const MIN_CONFIDENCE = 40;

// Currency rounding slack. Receipts round to the cent, and OCR/text extraction
// can drop a trailing digit, so allow a small absolute tolerance.
const TOLERANCE = 0.02;

const PENDING: Flag = {
  id: "arithmetic",
  title: "Line-item arithmetic",
  severity: "high",
  status: "pending",
  explanation:
    "Could not extract enough of the line items, subtotal, tax and total to verify the math. Surfaced for manual review.",
};

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

export function arithmeticFlag(fields: ExtractedFields | null, confidence: number): Flag {
  if (!fields || confidence < MIN_CONFIDENCE) return PENDING;

  const { lineItems, subtotal, tax, total } = fields;
  const checks: Array<{ label: string; expected: number; actual: number }> = [];

  const itemsSum =
    lineItems && lineItems.length
      ? round2(lineItems.reduce((acc, item) => acc + item.amount, 0))
      : undefined;

  // Line items should sum to the printed subtotal.
  if (itemsSum !== undefined && subtotal !== undefined) {
    checks.push({ label: "line items vs subtotal", expected: subtotal, actual: itemsSum });
  }

  // Only compare the printed subtotal/tax/total block when the receipt
  // actually exposes a subtotal. Inferring a subtotal from loosely parsed
  // lines is unsafe: trip distance, card values, and other numeric text can
  // look like receipt amounts even when the text layer itself is accurate.
  if (subtotal !== undefined && total !== undefined) {
    checks.push({ label: "subtotal + tax vs total", expected: total, actual: round2(subtotal + (tax ?? 0)) });
  }

  if (!checks.length) return PENDING;

  const mismatches = checks.filter((c) => !approxEqual(c.expected, c.actual));

  if (mismatches.length) {
    return {
      id: "arithmetic",
      title: "Line-item arithmetic does not add up",
      severity: "high",
      status: "triggered",
      explanation:
        "The extracted amounts are internally inconsistent, which can indicate altered figures. " +
        mismatches
          .map((m) => `${m.label}: expected ${m.expected.toFixed(2)}, got ${m.actual.toFixed(2)}`)
          .join("; ") +
        ".",
      evidence: { mismatches, checked: checks.map((c) => c.label) },
    };
  }

  return {
    id: "arithmetic",
    title: "Line-item arithmetic adds up",
    severity: "info",
    status: "passed",
    explanation: "The extracted line items, subtotal, tax and total are arithmetically consistent.",
    evidence: { checked: checks.map((c) => c.label) },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
