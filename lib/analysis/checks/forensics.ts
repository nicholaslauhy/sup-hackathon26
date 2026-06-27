import type { Flag } from "../types";
import type { FileKind } from "../analyze";
import type { VisionFinding, VisionForensics } from "../vision";

// Below this VLM self-confidence we do not let "suspicious" raise a flag: a
// hesitant model call should not red-flag a genuine receipt. The model already
// errs conservative (see vision.ts), this is a second floor on top.
const MIN_CONFIDENCE = 55;

// When the VLM did not run (no API key configured, or the call failed), both
// checks stay `pending`. The pass now supports every file kind, so a pending
// result means the analysis was unavailable, not that the format is unsupported.
function pendingReason(_fileKind: FileKind): string {
  return "The image-forensics pass did not run (no AI key is configured, or the analysis failed), so this could not be evaluated.";
}

// Font & spacing consistency: localised font/baseline/kerning mismatch on a
// value-bearing field, typical of a digitally replaced amount or date.
export function fontConsistencyFlag(
  vision: VisionForensics | null,
  fileKind: FileKind,
): Flag {
  if (!vision) {
    return {
      id: "font-consistency",
      title: "Font & spacing consistency",
      severity: "medium",
      status: "pending",
      explanation: pendingReason(fileKind),
    };
  }

  const finding = vision.fontConsistency;
  const triggered = finding.suspicious && finding.confidence >= MIN_CONFIDENCE;

  if (triggered) {
    return {
      id: "font-consistency",
      title: "Inconsistent fonts or spacing",
      severity: "medium",
      status: "triggered",
      explanation:
        "The image-forensics pass found font, weight or alignment inconsistent with the surrounding print, which can indicate a digitally edited value. " +
        joinObservations(finding) +
        ".",
      evidence: evidenceFor(finding, vision.model),
    };
  }

  return {
    id: "font-consistency",
    title: "Fonts and spacing look consistent",
    severity: "info",
    status: "passed",
    explanation:
      "The image-forensics pass found the printed fonts and alignment consistent across the document, with no sign of a digitally replaced field.",
    evidence: evidenceFor(finding, vision.model),
  };
}

// Scratches & physical alteration: visible scratch-outs, correction fluid/tape,
// erasures, smudges or overwriting concealing or replacing an original value.
export function physicalAlterationFlag(
  vision: VisionForensics | null,
  fileKind: FileKind,
): Flag {
  if (!vision) {
    return {
      id: "physical-alteration",
      title: "Scratches & physical alteration",
      severity: "high",
      status: "pending",
      explanation: pendingReason(fileKind),
    };
  }

  const finding = vision.physicalAlteration;
  const triggered = finding.suspicious && finding.confidence >= MIN_CONFIDENCE;

  if (triggered) {
    return {
      id: "physical-alteration",
      title: "Signs of physical alteration",
      severity: "high",
      status: "triggered",
      explanation:
        "The image-forensics pass found visible scratch-outs, correction fluid/tape, erasures or overwriting that can conceal or replace an original value. " +
        joinObservations(finding) +
        ".",
      evidence: evidenceFor(finding, vision.model),
    };
  }

  return {
    id: "physical-alteration",
    title: "No physical alteration found",
    severity: "info",
    status: "passed",
    explanation:
      "The image-forensics pass found no scratch-outs, correction fluid, erasures or overwriting concealing the printed values.",
    evidence: evidenceFor(finding, vision.model),
  };
}

function joinObservations(finding: VisionFinding): string {
  return finding.observations.length
    ? finding.observations.join("; ")
    : "No specific region was cited";
}

function evidenceFor(finding: VisionFinding, model: string): Record<string, unknown> {
  return {
    suspicious: finding.suspicious,
    confidence: finding.confidence,
    observations: finding.observations,
    model,
  };
}
