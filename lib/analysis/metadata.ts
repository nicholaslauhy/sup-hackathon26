import "server-only";
import type { Flag } from "./types";

// Editor / generator signatures that commonly appear in tampered or
// synthetic documents. Matched case-insensitively against metadata strings.
const EDITOR_SIGNATURES = [
  "photoshop",
  "gimp",
  "illustrator",
  "canva",
  "pixelmator",
  "affinity",
  "snapseed",
  "lightroom",
  "inkscape",
  "figma",
];

function matchEditor(value: string | undefined | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return EDITOR_SIGNATURES.find((sig) => lower.includes(sig)) ?? null;
}

// EXIF checks for JPEG/PNG. A genuine phone/camera photo of a receipt carries
// camera make/model and an original timestamp; a screenshot, export, or
// AI-generated image usually does not, and an edited one names the editor.
export async function imageMetadataFlags(bytes: Buffer, fileKind: string): Promise<Flag[]> {
  const flags: Flag[] = [];
  let exif: Record<string, unknown> = {};
  try {
    const exifr = (await import("exifr")).default;
    exif = (await exifr.parse(bytes)) ?? {};
  } catch {
    exif = {};
  }

  const software = (exif.Software ?? exif.CreatorTool) as string | undefined;
  const editor = matchEditor(software);
  if (editor) {
    flags.push({
      id: "exif-editor",
      title: "Edited in image software",
      severity: "high",
      status: "triggered",
      explanation: `Metadata names ${editor} as the editing software, suggesting the image was altered after capture.`,
      evidence: { software },
    });
  } else {
    flags.push({
      id: "exif-editor",
      title: "No editor signature in metadata",
      severity: "info",
      status: "passed",
      explanation: "No known image-editor signature was found in the file metadata.",
      evidence: software ? { software } : undefined,
    });
  }

  const make = exif.Make as string | undefined;
  const model = exif.Model as string | undefined;
  const originalDate = (exif.DateTimeOriginal ?? exif.CreateDate) as unknown;
  const hasCameraData = Boolean(make || model);
  const hasOriginalDate = Boolean(originalDate);

  if (!hasCameraData && !hasOriginalDate) {
    flags.push({
      id: "exif-camera",
      title: "No camera metadata",
      severity: "medium",
      status: "triggered",
      explanation:
        "The image has no camera make/model or original capture timestamp. This is typical of screenshots, exports, and AI-generated images rather than a photo of a physical receipt.",
      evidence: { fileKind },
    });
  } else {
    flags.push({
      id: "exif-camera",
      title: "Camera metadata present",
      severity: "info",
      status: "passed",
      explanation: "The image carries camera and/or capture-time metadata consistent with a real photo.",
      evidence: {
        make: make ?? null,
        model: model ?? null,
        dateTimeOriginal: originalDate ? String(originalDate) : null,
      },
    });
  }

  return flags;
}

// PDF metadata checks via pdf-lib (pure JS, no native deps).
export async function pdfMetadataFlags(bytes: Buffer): Promise<Flag[]> {
  const flags: Flag[] = [];
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });

    const producer = doc.getProducer();
    const creator = doc.getCreator();
    const creationDate = doc.getCreationDate();
    const modDate = doc.getModificationDate();

    const editor = matchEditor(producer) ?? matchEditor(creator);
    if (editor) {
      flags.push({
        id: "pdf-producer",
        title: "Created with image/design software",
        severity: "high",
        status: "triggered",
        explanation: `The PDF producer/creator names ${editor}, which is unusual for a genuine merchant-issued invoice.`,
        evidence: { producer: producer ?? null, creator: creator ?? null },
      });
    } else {
      flags.push({
        id: "pdf-producer",
        title: "Producer metadata",
        severity: "info",
        status: "passed",
        explanation: producer || creator
          ? "The PDF producer/creator does not match known editing software."
          : "No producer/creator metadata was found in the PDF.",
        evidence: { producer: producer ?? null, creator: creator ?? null },
      });
    }

    if (creationDate && modDate && modDate.getTime() - creationDate.getTime() > 60_000) {
      flags.push({
        id: "pdf-modified",
        title: "Modified after creation",
        severity: "medium",
        status: "triggered",
        explanation: "The PDF's modification date is later than its creation date, indicating it was edited after it was first produced.",
        evidence: { created: creationDate.toISOString(), modified: modDate.toISOString() },
      });
    } else {
      flags.push({
        id: "pdf-modified",
        title: "No post-creation edit detected",
        severity: "info",
        status: "passed",
        explanation: "The PDF creation and modification timestamps are consistent.",
        evidence: {
          created: creationDate ? creationDate.toISOString() : null,
          modified: modDate ? modDate.toISOString() : null,
        },
      });
    }
  } catch {
    flags.push({
      id: "pdf-producer",
      title: "PDF metadata unreadable",
      severity: "low",
      status: "triggered",
      explanation: "The PDF structure could not be parsed for metadata, which can indicate a malformed or manipulated file.",
    });
  }

  return flags;
}
