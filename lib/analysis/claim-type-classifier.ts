import type { ReceiptType } from "./types";

export type DetectedReceiptType = ReceiptType | "unknown";

export type ClaimTypeDecision = {
  status: "match" | "mismatch" | "unknown";
  detectedType: DetectedReceiptType;
  confidence: number;
  source: "text" | "ai" | "none";
  reasons: string[];
};

const CLAIM_LABELS: Record<ReceiptType, string> = {
  grab: "Grab",
  medical: "medical",
  purchase: "purchase",
};

export const CLAIM_TYPE_PREFLIGHT_PROMPT = [
  "Classify the uploaded claim receipt before any fraud analysis is run.",
  "Return only the JSON schema result.",
  "Choose detectedType as one of: grab, medical, purchase, unknown.",
  "Use grab for Grab ride, GrabFood, GrabExpress, transport, delivery, booking, fare, pickup/drop-off, or Grab-branded receipts.",
  "Use medical for clinic, hospital, pharmacy, dental, doctor, patient, consultation, treatment, medication, MC, or medical invoice receipts.",
  "Use purchase for ordinary retail, restaurant, supplier, supermarket, office supplies, or general product/service purchase receipts that are not Grab or medical.",
  "Use unknown when the document is not a receipt, is illegible, or lacks enough visible evidence.",
  "Do not infer from the user's selected claim type. Classify only from visible document evidence.",
  "Be conservative: only use high confidence when the category is clearly supported by visible text or layout.",
].join(" ");

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function classifyClaimTypeFromText(rawText: string): ClaimTypeDecision {
  const text = rawText.toLowerCase();
  if (!text.trim()) {
    return { status: "unknown", detectedType: "unknown", confidence: 0, source: "none", reasons: ["No readable text was available."] };
  }

  const scores: Record<ReceiptType, { score: number; reasons: string[] }> = {
    grab: { score: 0, reasons: [] },
    medical: { score: 0, reasons: [] },
    purchase: { score: 0, reasons: [] },
  };

  const grabPatterns = [
    /\bgrab\b/, /\bgrabfood\b/, /\bgrabexpress\b/, /\bjustgrab\b/, /\bbooking id\b/,
    /\border id\b/, /\bpicked up\b/, /\bpick-?up\b/, /\bdrop-?off\b/, /\bfare\b/,
    /\bdriver fee\b/, /\bplatform (?:&|and)? ?partner fee\b/,
  ];
  const medicalPatterns = [
    /\bclinic\b/, /\bhospital\b/, /\bmedical\b/, /\bpharmacy\b/, /\bdental\b/,
    /\bdoctor\b/, /\bdr\.\b/, /\bpatient\b/, /\bconsultation\b/, /\btreatment\b/,
    /\bmedicine\b/, /\bmedication\b/, /\bmc\b/, /\bregistration\b/,
  ];
  const purchasePatterns = [
    /\bretail\b/, /\bsupermarket\b/, /\bstore\b/, /\binvoice\b/, /\breceipt\b/,
    /\bsubtotal\b/, /\bgst\b/, /\bqty\b/, /\bquantity\b/, /\bunit price\b/,
    /\bcashier\b/, /\bsalesperson\b/, /\bitem\b/, /\bpaid\b/,
  ];

  const grabCount = countMatches(text, grabPatterns);
  const medicalCount = countMatches(text, medicalPatterns);
  const purchaseCount = countMatches(text, purchasePatterns);

  scores.grab.score = grabCount * 22;
  scores.medical.score = medicalCount * 18;
  scores.purchase.score = purchaseCount * 10;

  if (/\bgrab\b/.test(text)) scores.grab.score += 45;
  if (/\bbooking id\b|\bpicked up\b|\bdrop-?off\b/.test(text)) scores.grab.score += 25;
  if (/\bclinic\b|\bhospital\b|\bpatient\b|\bconsultation\b/.test(text)) scores.medical.score += 30;
  if (/\bsubtotal\b|\bqty\b|\bcashier\b|\bsalesperson\b/.test(text)) scores.purchase.score += 12;

  if (grabCount) scores.grab.reasons.push("Grab transport/delivery terms were found.");
  if (medicalCount) scores.medical.reasons.push("Medical, clinic, patient, or treatment terms were found.");
  if (purchaseCount) scores.purchase.reasons.push("General purchase receipt terms were found.");

  const ranked = (Object.entries(scores) as [ReceiptType, { score: number; reasons: string[] }][])
    .sort((a, b) => b[1].score - a[1].score);
  const [bestType, best] = ranked[0];
  const [, second] = ranked[1];
  const margin = best.score - second.score;

  if (best.score < 35 || margin < 18) {
    return {
      status: "unknown",
      detectedType: "unknown",
      confidence: Math.min(60, Math.max(0, Math.round(best.score))),
      source: "text",
      reasons: ["Text signals were not strong enough to classify the claim type."],
    };
  }

  return {
    status: "unknown",
    detectedType: bestType,
    confidence: Math.min(95, Math.round(best.score)),
    source: "text",
    reasons: best.reasons.length ? best.reasons : [`Detected ${bestType} receipt terms.`],
  };
}

export function claimTypeMismatchMessage(selectedClaimType: ReceiptType) {
  return `Please upload a ${CLAIM_LABELS[selectedClaimType]} receipt.`;
}

export function finalizeDecision(selectedClaimType: ReceiptType, decision: ClaimTypeDecision): ClaimTypeDecision {
  if (decision.detectedType === "unknown" || decision.confidence < 70) {
    return { ...decision, status: "unknown" };
  }
  return {
    ...decision,
    status: decision.detectedType === selectedClaimType ? "match" : "mismatch",
  };
}
