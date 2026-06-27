import type { Flag } from "@/lib/analysis/types";

export type MoneyLineRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MoneyLine = {
  label: string;
  amount: number;
  region?: MoneyLineRegion;
};

type ArithmeticBasis = "subtotal_plus_tax" | "item_sum";

function almostEqual(a: number, b: number, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}

function currency(value: number) {
  return `$${value.toFixed(2)}`;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function isRegistrationOrMetadataLine(label: string) {
  return includesAny(label, [
    "invoice #",
    "invoice no",
    "invoice number",
    "cashier",
    "salesperson",
    "printed by",
    "phone",
    "gst #",
    "vat #",
    "tax invoice",
    "till",
    "table",
    "date",
    "time",
  ]);
}

function isSubtotalLine(label: string) {
  return includesAny(label, ["subtotal", "sub total"]);
}

function isTaxLine(label: string) {
  if (isRegistrationOrMetadataLine(label)) return false;
  return includesAny(label, ["gst", "tax", "vat"]);
}

function paymentKeywordScore(label: string) {
  if (includesAny(label, ["tendered", "change", "cash", "card", "visa", "master", "amex", "eftpos", "paid", "payment", "received"])) {
    return 100;
  }

  return 0;
}

function payableKeywordScore(label: string) {
  if (paymentKeywordScore(label) > 0) return -1;
  if (includesAny(label, ["grand total", "net total", "amount due", "amount payable"])) return 100;
  if (includesAny(label, ["balance due", "balance payable"])) return 95;
  if (label === "total" || label.startsWith("total ")) return 90;
  if (includesAny(label, ["total due", "payable total"])) return 88;
  if (label.includes("total") && !isSubtotalLine(label)) return 80;
  return -1;
}

function isPaymentLine(label: string) {
  return paymentKeywordScore(label) > 0;
}

function isPayableLine(label: string) {
  return payableKeywordScore(label) > 0;
}

function findFirstByLabel(lines: MoneyLine[], predicate: (label: string) => boolean): MoneyLine | null {
  for (const line of lines) {
    const label = normalized(line.label);
    if (predicate(label)) return line;
  }

  return null;
}

function findBestPayableLine(lines: MoneyLine[]): MoneyLine | null {
  const best = lines.reduce<{ line: MoneyLine; score: number; index: number } | null>((current, line, index) => {
    const score = payableKeywordScore(normalized(line.label));
    if (score < 0) return current;

    if (!current || score > current.score || (score === current.score && index > current.index)) {
      return { line, score, index };
    }

    return current;
  }, null);

  return best ? best.line : null;
}

function isItemLine(line: MoneyLine) {
  const label = normalized(line.label);
  if (!label) return false;
  if (isRegistrationOrMetadataLine(label)) return false;
  if (isSubtotalLine(label)) return false;
  if (isTaxLine(label)) return false;
  if (isPayableLine(label)) return false;
  if (isPaymentLine(label)) return false;
  if (includesAny(label, ["service charge", "rounding", "discount", "promo", "member savings"])) return false;
  return true;
}

function sum(values: number[]) {
  return Number(values.reduce((acc, value) => acc + value, 0).toFixed(2));
}

function buildMismatchFlag(options: {
  title: string;
  explanation: string;
  calculatedAmount: number;
  printedAmount: number;
  targetLabel: string;
  targetRegion?: MoneyLineRegion;
  checked: string[];
  basis: ArithmeticBasis;
}): Flag {
  const { title, explanation, calculatedAmount, printedAmount, targetLabel, targetRegion, checked, basis } = options;
  const basisLabel = basis === "subtotal_plus_tax" ? "subtotal plus tax" : "sum of item lines";

  return {
    id: "arithmetic-total-mismatch",
    title,
    status: "triggered",
    severity: "high",
    explanation,
    evidence: {
      checked,
      mismatches: [
        {
          label: targetLabel,
          targetLineLabel: targetLabel,
          calculationBasis: basisLabel,
          actualLabel: basis === "subtotal_plus_tax" ? "Expected from subtotal + tax" : "Expected from item sum",
          expectedLabel: `Printed ${targetLabel}`,
          actual: calculatedAmount,
          expected: printedAmount,
        },
      ],
      regions: targetRegion
        ? [
          {
            ...targetRegion,
            label: `Mismatch: ${targetLabel} shows ${currency(printedAmount)}. Expected ${currency(calculatedAmount)}.`,
            shape: "box",
          },
        ]
        : [],
    },
  };
}

function buildPassedFlag(checked: string[], explanation: string): Flag {
  return {
    id: "arithmetic-total",
    title: "Receipt amount check passed",
    status: "passed",
    severity: "low",
    explanation,
    evidence: { checked },
  };
}

function buildPendingFlag(checked: string[], explanation: string): Flag {
  return {
    id: "arithmetic-total",
    title: "Receipt amount check incomplete",
    status: "pending",
    severity: "medium",
    explanation,
    evidence: { checked },
  };
}

export function createArithmeticTotalFlags(lines: MoneyLine[]): Flag[] {
  const subtotal = findFirstByLabel(lines, isSubtotalLine);
  const tax = findFirstByLabel(lines, isTaxLine);
  const payable = findBestPayableLine(lines);
  const itemLines = lines.filter(isItemLine);
  const itemSum = itemLines.length > 0 ? sum(itemLines.map((line) => line.amount)) : null;

  if (subtotal && tax && payable) {
    const calculated = Number((subtotal.amount + tax.amount).toFixed(2));
    const printed = Number(payable.amount.toFixed(2));
    const checked = [
      `Subtotal ${currency(subtotal.amount)} + tax ${currency(tax.amount)} = ${currency(calculated)}`,
      `Printed ${payable.label} = ${currency(printed)}`,
    ];

    if (almostEqual(calculated, printed)) {
      return [buildPassedFlag(checked, "Subtotal plus tax matches the printed payable amount.")];
    }

    return [buildMismatchFlag({
      title: "Subtotal plus tax does not match the payable amount",
      explanation: `Subtotal plus tax should be ${currency(calculated)}, but the printed ${payable.label} is ${currency(printed)}.`,
      calculatedAmount: calculated,
      printedAmount: printed,
      targetLabel: payable.label,
      targetRegion: payable.region,
      checked,
      basis: "subtotal_plus_tax",
    })];
  }

  if (itemSum !== null && payable) {
    const printed = Number(payable.amount.toFixed(2));
    const checked = [
      `Sum of item lines = ${currency(itemSum)}`,
      `Printed ${payable.label} = ${currency(printed)}`,
      "Ignored payment lines such as tendered / change when computing the expected amount.",
    ];

    if (almostEqual(itemSum, printed)) {
      return [buildPassedFlag(checked, "The sum of item lines matches the printed payable amount.")];
    }

    return [buildMismatchFlag({
      title: "Line items do not match the payable amount",
      explanation: `The sum of item lines should be ${currency(itemSum)}, but the printed ${payable.label} is ${currency(printed)}.`,
      calculatedAmount: itemSum,
      printedAmount: printed,
      targetLabel: payable.label,
      targetRegion: payable.region,
      checked,
      basis: "item_sum",
    })];
  }

  return [buildPendingFlag([
    subtotal ? `Found subtotal ${currency(subtotal.amount)}` : "Subtotal not found",
    tax ? `Found tax ${currency(tax.amount)}` : "Tax not found",
    payable ? `Found payable amount ${currency(payable.amount)}` : "Payable amount not found",
    itemSum !== null ? `Computed item sum ${currency(itemSum)}` : "Item lines not found",
  ], "Not enough reliable receipt amount lines were extracted to run the arithmetic check.")];
}

export const demoTamperedMartMoneyLines: MoneyLine[] = [
  { label: "Widget A", amount: 40.0, region: { x: 0.08, y: 0.38, width: 0.3, height: 0.06 } },
  { label: "Widget B", amount: 25.0, region: { x: 0.08, y: 0.47, width: 0.3, height: 0.06 } },
  { label: "Subtotal", amount: 65.0, region: { x: 0.08, y: 0.55, width: 0.35, height: 0.06 } },
  { label: "GST", amount: 5.85, region: { x: 0.08, y: 0.63, width: 0.32, height: 0.06 } },
  { label: "TOTAL", amount: 999.0, region: { x: 0.08, y: 0.71, width: 0.38, height: 0.07 } },
];
