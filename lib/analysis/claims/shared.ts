import type { ExtractedFields, Flag, LineItem } from "../types";

const MONEY_TOLERANCE = 0.02;

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function missingFieldsFlag(
  id: string,
  title: string,
  fields: { label: string; value: unknown }[],
): Flag {
  const missing = fields.filter(({ value }) => value === null || value === undefined || value === "").map(({ label }) => label);
  if (missing.length === 0) {
    return {
      id,
      title,
      severity: "info",
      status: "passed",
      explanation: "The expected identifying fields for this claim type were found.",
    };
  }
  return {
    id,
    title,
    severity: "medium",
    status: "triggered",
    explanation: `Expected identifying information is missing: ${missing.join(", ")}.`,
    evidence: { missingFields: missing.join(", ") },
  };
}

export function arithmeticFlag(fields: ExtractedFields, id = "arithmetic"): Flag {
  const items = fields.lineItems ?? [];
  const itemAmounts = items.map((item) => item.amount).filter(finite);
  const itemTotal = itemAmounts.reduce((sum, amount) => sum + amount, 0);
  const discount = finite(fields.discount) ? fields.discount : 0;
  const expectedSubtotal = itemTotal - discount;
  const subtotalMismatch = itemAmounts.length > 0
    && finite(fields.subtotal)
    && Math.abs(expectedSubtotal - fields.subtotal) > MONEY_TOLERANCE;
  const expectedTotal = (finite(fields.subtotal) ? fields.subtotal : 0) + (finite(fields.tax) ? fields.tax : 0);
  const totalMismatch = finite(fields.subtotal)
    && finite(fields.total)
    && Math.abs(expectedTotal - fields.total) > MONEY_TOLERANCE;

  const lineMismatch = items.find((item: LineItem) =>
    finite(item.quantity)
    && finite(item.unitPrice)
    && Math.abs(item.quantity * item.unitPrice - item.amount) > MONEY_TOLERANCE
  );

  if (subtotalMismatch || totalMismatch || lineMismatch) {
    return {
      id,
      title: "Receipt arithmetic mismatch",
      severity: "high",
      status: "triggered",
      explanation: "One or more displayed amounts do not reconcile with the extracted line items, subtotal, tax, or total.",
      evidence: {
        lineItemsTotal: Number(itemTotal.toFixed(2)),
        discount,
        displayedSubtotal: fields.subtotal ?? null,
        displayedTax: fields.tax ?? null,
        displayedTotal: fields.total ?? null,
        mismatchedLine: lineMismatch?.description ?? null,
      },
    };
  }

  if (itemAmounts.length === 0 || !finite(fields.total)) {
    return {
      id,
      title: "Line-item arithmetic",
      severity: "high",
      status: "pending",
      explanation: "There was not enough legible amount data to verify the receipt arithmetic.",
    };
  }

  return {
    id,
    title: "Receipt arithmetic reconciles",
    severity: "info",
    status: "passed",
    explanation: "The extracted line items and displayed totals reconcile within the currency tolerance.",
    evidence: { lineItemsTotal: Number(itemTotal.toFixed(2)), displayedTotal: fields.total },
  };
}

export function layoutFlag(concerns: string[] | undefined): Flag {
  if (!concerns) {
    return {
      id: "font-consistency",
      title: "Font & spacing consistency",
      severity: "medium",
      status: "pending",
      explanation: "Layout consistency could not be assessed.",
    };
  }
  if (concerns.length > 0) {
    return {
      id: "font-consistency",
      title: "Layout inconsistencies observed",
      severity: "medium",
      status: "triggered",
      explanation: "The visual extraction identified inconsistent typography, alignment, or spacing that warrants human review.",
      evidence: { concerns: concerns.join("; ") },
    };
  }
  return {
    id: "font-consistency",
    title: "Layout appears consistent",
    severity: "info",
    status: "passed",
    explanation: "No material font, alignment, or spacing inconsistency was identified.",
  };
}
