import "server-only";
import type { AnalysisResult, ExtractedFields, Flag, ReceiptType, Tier } from "./types";
import { SCHEMA_VERSION } from "./types";
import { claimSpecificFlags } from "./claims";
import { extractClaimFields } from "./claim-extract";
import { arithmeticFlag } from "./checks/arithmetic";
import { fontConsistencyFlag, physicalAlterationFlag } from "./checks/forensics";
import { receiptDocumentFlag } from "./checks/receipt-document";
import { extractFields, type ExtractResult } from "./extract";
import { imageMetadataFlags, pdfMetadataFlags } from "./metadata";
import { authenticReferenceFlag } from "./references";
import { scoreFromFlags, tierFromScore } from "./score";
import { documentShapeSignal, type DocumentShape } from "./shape";
import { analyzeImageForensics } from "./vision";

export type FileKind = "PDF" | "JPEG" | "PNG" | "HEIC";

export type DuplicateMatch = {
  exact: boolean;
  receiptId: string;
  fileName: string;
  uploadedBy: string;
  distance?: number;
};

export type AnalyzeInput = {
  bytes: Buffer;
  fileKind: FileKind;
  claimType: ReceiptType;
  contentHash: string;
  perceptualHash: string | null;
  duplicate: DuplicateMatch | null;
};

function duplicateFlag(match: DuplicateMatch | null): Flag {
  if (!match) {
    return {
      id: "duplicate",
      title: "No duplicate submission found",
      severity: "info",
      status: "passed",
      explanation: "This document has not been submitted before.",
    };
  }
  return {
    id: "duplicate",
    title: match.exact ? "Exact duplicate submission" : "Near-duplicate submission",
    severity: "high",
    status: "triggered",
    explanation: match.exact
      ? "An identical file has already been submitted, which may indicate a re-submitted or recycled receipt."
      : `A near-identical image has already been submitted (perceptual distance ${match.distance}), which may indicate a lightly altered re-submission.`,
    evidence: {
      matchedReceiptId: match.receiptId,
      matchedFileName: match.fileName,
      distance: match.distance ?? 0,
    },
  };
}

function pendingClaimFlags(claimType: ReceiptType): Flag[] {
  if (claimType === "medical") {
    return [
      {
        id: "medical-identifiers",
        title: "Clinic, visit, and receipt identifiers",
        severity: "medium",
        status: "pending",
        explanation: "Structured claim extraction was unavailable, so clinic, visit, receipt, and registration details could not be evaluated.",
      },
      {
        id: "medical-timing",
        title: "Medical visit timing",
        severity: "low",
        status: "pending",
        explanation: "Structured claim extraction was unavailable, so visit timing could not be evaluated.",
      },
    ];
  }
  if (claimType === "purchase") {
    return [
      {
        id: "purchase-identifiers",
        title: "Merchant and receipt identifiers",
        severity: "medium",
        status: "pending",
        explanation: "Structured claim extraction was unavailable, so merchant, date, and receipt identifiers could not be evaluated.",
      },
      {
        id: "purchase-tax",
        title: "Purchase tax consistency",
        severity: "medium",
        status: "pending",
        explanation: "Structured claim extraction was unavailable, so the detailed purchase calculation could not be evaluated.",
      },
    ];
  }
  return [
    {
      id: "grab-identifiers",
      title: "Grab receipt identifiers",
      severity: "medium",
      status: "pending",
      explanation: "Structured claim extraction was unavailable, so booking/order identifiers could not be evaluated.",
    },
    {
      id: "grab-location",
      title: "Grab location consistency",
      severity: "medium",
      status: "pending",
      explanation: "Structured claim extraction was unavailable, so route or delivery details could not be evaluated.",
    },
    {
      id: "grab-timing",
      title: "Grab event and receipt timing",
      severity: "medium",
      status: "pending",
      explanation: "Structured claim extraction was unavailable, so event and receipt timestamps could not be evaluated.",
    },
    {
      id: "grab-arithmetic",
      title: "Grab charge arithmetic",
      severity: "high",
      status: "pending",
      explanation: "Structured claim extraction was unavailable, so the complete signed charge rows could not be evaluated.",
    },
  ];
}

function mergeExtractedFields(
  common: ExtractedFields | null,
  claim: ExtractedFields | null,
): ExtractedFields | null {
  if (!common) return claim;
  if (!claim) return common;
  return {
    ...common,
    ...claim,
    lineItems: claim.lineItems?.length ? claim.lineItems : common.lineItems,
    medical: claim.medical ?? common.medical,
    grab: claim.grab ?? common.grab,
  };
}

function buildSummary(tier: Tier, flags: Flag[]): string {
  const triggered = flags.filter((flag) => flag.status === "triggered");
  const pending = flags.filter((flag) => flag.status === "pending").length;
  const tail = pending
    ? ` ${pending} check${pending === 1 ? "" : "s"} are pending and not yet included.`
    : "";

  if (tier === "red") {
    return `High risk: ${triggered.length} red flag${triggered.length === 1 ? "" : "s"} found. Recommend manual review before processing.${tail}`;
  }
  if (tier === "amber") {
    return `Some risk: ${triggered.length} flag${triggered.length === 1 ? "" : "s"} worth a look before approving.${tail}`;
  }
  return `Low risk: no deterministic red flags found in the available checks.${tail}`;
}

export async function analyzeReceipt(input: AnalyzeInput): Promise<AnalysisResult> {
  const flags: Flag[] = [duplicateFlag(input.duplicate)];

  if (input.fileKind === "PDF") {
    flags.push(...(await pdfMetadataFlags(input.bytes)));
  } else if (input.fileKind === "JPEG" || input.fileKind === "PNG") {
    flags.push(...(await imageMetadataFlags(input.bytes, input.fileKind)));
  } else if (input.fileKind === "HEIC") {
    flags.push({
      id: "exif-camera",
      title: "HEIC metadata not analysed",
      severity: "info",
      status: "pending",
      explanation: "HEIC metadata extraction is not yet supported in this build; only exact-duplicate detection ran on this file.",
    });
  }

  let extractResult: ExtractResult | null = null;
  if (input.fileKind !== "HEIC") {
    extractResult = await extractFields(input.bytes, input.fileKind);
  }

  let shape: DocumentShape | null = null;
  if (input.fileKind === "JPEG" || input.fileKind === "PNG") {
    shape = await documentShapeSignal(input.bytes);
  }

  // Image-forensics runs on every supported file kind: images directly, PDFs
  // via the Responses file input, and HEIC after a sharp decode. Failure stays
  // soft (null -> the dependent checks remain pending).
  const vision = await analyzeImageForensics(input.bytes, input.fileKind);

  const [claimExtracted, referenceFlag] = await Promise.all([
    extractClaimFields(input.bytes, input.fileKind, input.claimType),
    authenticReferenceFlag(input.claimType, input.contentHash, input.perceptualHash),
  ]);

  const commonExtracted = extractResult?.fields ?? null;
  const extracted = mergeExtractedFields(commonExtracted, claimExtracted);
  const confidence = extractResult?.confidence ?? 0;

  // Preserve the teammate pipeline: document gate first, followed by common
  // deterministic/OCR and image-forensics checks.
  flags.unshift(receiptDocumentFlag(extractResult, shape));
  flags.push(referenceFlag);
  // The VLM (claim extraction) reads structured amounts far more reliably than
  // OCR. When it ran, feed its merged fields at high confidence so the line-item
  // arithmetic and round-amount checks evaluate the VLM numbers instead of the
  // noisy OCR ones; otherwise fall back to the OCR extraction unchanged.
  const moneyFields = claimExtracted ? extracted : commonExtracted;
  const moneyConfidence = claimExtracted ? 95 : confidence;
  flags.push(arithmeticFlag(moneyFields, moneyConfidence));
  flags.push(fontConsistencyFlag(vision, input.fileKind));
  flags.push(physicalAlterationFlag(vision, input.fileKind));

  // Layer the selected claim type on top. Failure of structured extraction is
  // soft: the claim checks remain pending and never invent a pass or failure.
  flags.push(...(
    claimExtracted
      ? claimSpecificFlags(input.claimType, claimExtracted)
      : pendingClaimFlags(input.claimType)
  ));

  const score = scoreFromFlags(flags);
  const tier = tierFromScore(score);

  return {
    schemaVersion: SCHEMA_VERSION,
    tier,
    score,
    flags,
    extracted,
    summary: buildSummary(tier, flags),
    analyzedAt: new Date().toISOString(),
  };
}
