import "server-only";
import type { ExtractedFields, LineItem } from "./types";
import type { FileKind } from "./analyze";

// Open-source extraction layer. Turns a receipt's bytes into the frozen
// `ExtractedFields` shape using a text-first pipeline:
//
//   1. Digital PDFs carry a real text layer -> read it with pdfjs (fast, exact).
//   2. Images (JPEG/PNG) and scanned/empty PDFs -> OCR with tesseract.js.
//
// The parsed numbers feed the deterministic arithmetic / round-amount checks.
// `confidence` (0-100) lets callers keep a check `pending` rather than emit a
// false `passed` when the text was too poor to trust.

export type ExtractResult = {
  fields: ExtractedFields;
  confidence: number; // 0-100, source-dependent (text-layer = high, OCR = engine score)
  source: "pdf-text" | "ocr" | "none";
  rawText: string;
};

const EMPTY: ExtractResult = { fields: {}, confidence: 0, source: "none", rawText: "" };

export async function extractFields(bytes: Buffer, fileKind: FileKind): Promise<ExtractResult> {
  let rawText = "";
  let confidence = 0;
  let source: ExtractResult["source"] = "none";

  try {
    if (fileKind === "PDF") {
      const text = await pdfTextLayer(bytes);
      if (text.trim().length >= 40) {
        rawText = text;
        confidence = 95; // embedded text layer is exact, not estimated
        source = "pdf-text";
      } else {
        // Scanned / image-only PDF: no usable text layer. Rasterising a PDF in
        // Node needs a canvas/native dep, so OCR fallback is deferred. Return
        // low confidence so dependent checks stay `pending`.
        rawText = text;
        confidence = 0;
        source = "none";
      }
    } else if (fileKind === "JPEG" || fileKind === "PNG") {
      const ocr = await ocrImage(bytes);
      rawText = ocr.text;
      confidence = ocr.confidence;
      source = "ocr";
    }
    // HEIC is never passed here (caller skips it).
  } catch {
    return EMPTY;
  }

  if (!rawText.trim()) return { ...EMPTY, source };

  return { fields: parseReceiptText(rawText), confidence, source, rawText };
}

// --- text acquisition -------------------------------------------------------

async function pdfTextLayer(bytes: Buffer): Promise<string> {
  // Legacy build is the Node-compatible entry point for pdfjs.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdfjs emits text fragments with no newlines of their own; `hasEOL` marks
    // where a visual line ends, which the line-based parser depends on.
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join(""),
    );
  }
  await doc.cleanup();
  return pages.join("\n");
}

async function ocrImage(bytes: Buffer): Promise<{ text: string; confidence: number }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(bytes);
    return { text: data.text, confidence: Math.round(data.confidence) };
  } finally {
    await worker.terminate();
  }
}

// --- parsing ----------------------------------------------------------------

// Lines that describe a payment summary rather than a purchased line item.
const SUMMARY_KEYWORDS = /\b(sub-?total|total|tax|gst|vat|service charge|rounding|change|cash|card|balance|amount due|paid)\b/i;
const TOTAL_LINE = /\b(grand total|total|amount due|balance due)\b/i;
const SUBTOTAL_LINE = /\bsub-?total\b/i;
const TAX_LINE = /\b(gst|vat|sales tax|tax)\b/i;
const NON_ITEM_CONTEXT =
  /\b(?:km|kilomet(?:er|re)s?|mins?|minutes?|hours?|gmail|https?|www|booking id|order id|paid by|passenger|profile)\b/i;

export function parseReceiptText(text: string): ExtractedFields {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const fields: ExtractedFields = {};

  const currency = detectCurrency(text);
  if (currency) fields.currency = currency;

  const date = detectDate(text);
  if (date) fields.date = date;

  const merchant = detectMerchant(lines);
  if (merchant) fields.merchant = merchant;

  // Summary amounts: take the right-most money value on a matching line.
  const total = lastAmountOnMatch(lines, TOTAL_LINE, SUBTOTAL_LINE);
  const subtotal = lastAmountOnMatch(lines, SUBTOTAL_LINE);
  const tax = lastAmountOnMatch(lines, TAX_LINE);
  if (total !== undefined) fields.total = total;
  if (subtotal !== undefined) fields.subtotal = subtotal;
  if (tax !== undefined) fields.tax = tax;

  const lineItems = detectLineItems(lines);
  if (lineItems.length) fields.lineItems = lineItems;

  return fields;
}

// Money tokens. Deliberately requires two decimal places: bare integers on a
// receipt are usually quantities, postcodes, phone numbers or document IDs
// (e.g. "RMC-2026-048172"), and reading those as money produces phantom line
// items that break the arithmetic check. Missing cents -> no amount -> the
// dependent check stays `pending`, which is the safe failure mode.
function amountsInLine(line: string): number[] {
  const tokens = line.match(/\d[\d,]*\.\d{2}\b/g) ?? [];
  return tokens
    .map((t) => Number(t.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

function lastAmountOnMatch(lines: string[], match: RegExp, exclude?: RegExp): number | undefined {
  // Iterate bottom-up: receipts print the authoritative total last.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!match.test(line)) continue;
    if (exclude && exclude.test(line)) continue;
    const amounts = amountsInLine(line);
    if (amounts.length) return amounts[amounts.length - 1];
  }
  return undefined;
}

function detectCurrency(text: string): string | undefined {
  const map: Array<[RegExp, string]> = [
    [/\b(SGD|S\$)\b/i, "SGD"],
    [/\b(MYR|RM)\b/i, "MYR"],
    [/\bUSD\b/i, "USD"],
    [/\bEUR\b/i, "EUR"],
    [/\bGBP\b/i, "GBP"],
    [/€/, "EUR"],
    [/£/, "GBP"],
    [/\$/, "USD"],
  ];
  for (const [re, code] of map) {
    if (re.test(text)) return code;
  }
  return undefined;
}

function detectDate(text: string): string | undefined {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/, // ISO
    /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/, // 24/06/2026
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}\b/i,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return undefined;
}

function detectMerchant(lines: string[]): string | undefined {
  // First line that reads like a name: has letters, isn't a date or a money row.
  for (const line of lines.slice(0, 6)) {
    if (!/[A-Za-z]{3,}/.test(line)) continue;
    if (SUMMARY_KEYWORDS.test(line)) continue;
    if (detectDate(line)) continue;
    if (amountsInLine(line).length && line.replace(/[\d.,$€£\s]/g, "").length < 3) continue;
    return line;
  }
  return undefined;
}

function detectLineItems(lines: string[]): LineItem[] {
  const items: LineItem[] = [];
  for (const line of lines) {
    if (SUMMARY_KEYWORDS.test(line)) continue;
    if (NON_ITEM_CONTEXT.test(line)) continue;
    const amounts = amountsInLine(line);
    if (!amounts.length) continue;
    const amount = amounts[amounts.length - 1];
    const description = line
      .replace(/\d[\d,]*\.\d{2}/g, "")
      .replace(/[$€£]|SGD|MYR|RM|USD/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (description.replace(/[^A-Za-z]/g, "").length < 2) continue;
    items.push({ description, amount });
  }
  return items;
}
