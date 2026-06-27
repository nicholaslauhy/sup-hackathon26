import type { ExtractedFields, Flag } from "../types";

// See arithmetic.ts: below this extraction confidence we keep the flag
// `pending` rather than emit a false `passed`.
const MIN_CONFIDENCE = 40;

const PENDING: Flag = {
  id: "round-numbers",
  title: "Suspiciously round amounts",
  severity: "low",
  status: "pending",
  explanation:
    "Could not extract the amounts with enough confidence to check for unusually round figures. Surfaced for manual review.",
};

// A genuine receipt rarely lands on a whole multiple of 10 after tax. Exact
// whole-ten / whole-hundred totals are a weak signal of a fabricated amount.
function isSuspiciouslyRound(amount: number): boolean {
  if (amount <= 0) return false;
  return amount % 10 === 0;
}

export function roundNumbersFlag(fields: ExtractedFields | null, confidence: number): Flag {
  if (!fields || confidence < MIN_CONFIDENCE || fields.total === undefined) return PENDING;

  const total = fields.total;
  const subtotal = fields.subtotal;
  const roundFields = [
    { label: "total", value: total },
    ...(subtotal !== undefined ? [{ label: "subtotal", value: subtotal }] : []),
  ].filter((f) => isSuspiciouslyRound(f.value));

  if (roundFields.length) {
    return {
      id: "round-numbers",
      title: "Suspiciously round amounts",
      severity: "low",
      status: "triggered",
      explanation:
        "An unusually round figure was found (" +
        roundFields.map((f) => `${f.label} ${f.value.toFixed(2)}`).join(", ") +
        "), which is uncommon on genuine itemised receipts.",
      evidence: { roundFields },
    };
  }

  return {
    id: "round-numbers",
    title: "No suspiciously round amounts",
    severity: "info",
    status: "passed",
    explanation: "The extracted amounts do not land on unusually round figures.",
    evidence: { total, subtotal: subtotal ?? null },
  };
}
