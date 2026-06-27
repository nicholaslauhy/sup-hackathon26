import type { ExtractedFields, Flag } from "../types";
import { arithmeticFlag, missingFieldsFlag } from "./shared";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function taxConsistencyFlag(fields: ExtractedFields): Flag {
  if (!finite(fields.subtotal) || !finite(fields.tax) || !finite(fields.total)) {
    return {
      id: "purchase-tax",
      title: "Purchase tax consistency",
      severity: "medium",
      status: "pending",
      explanation: "Subtotal, tax, and total were not all legible enough to verify the tax calculation.",
    };
  }
  const expected = fields.subtotal + fields.tax;
  const mismatch = Math.abs(expected - fields.total) > 0.02;
  return mismatch
    ? {
        id: "purchase-tax",
        title: "Tax and total do not reconcile",
        severity: "high",
        status: "triggered",
        explanation: "The displayed subtotal plus tax does not match the displayed total.",
        evidence: { subtotal: fields.subtotal, tax: fields.tax, expectedTotal: Number(expected.toFixed(2)), displayedTotal: fields.total },
      }
    : {
        id: "purchase-tax",
        title: "Tax and total reconcile",
        severity: "info",
        status: "passed",
        explanation: "The displayed subtotal plus tax matches the displayed total.",
        evidence: { subtotal: fields.subtotal, tax: fields.tax, total: fields.total },
      };
}

export function purchaseClaimFlags(fields: ExtractedFields): Flag[] {
  return [
    missingFieldsFlag("purchase-identifiers", "Purchase receipt identifiers", [
      { label: "merchant", value: fields.merchant },
      { label: "purchase date", value: fields.date },
      { label: "receipt number", value: fields.receiptNumber },
    ]),
    arithmeticFlag(fields, "purchase-arithmetic"),
    taxConsistencyFlag(fields),
  ];
}
