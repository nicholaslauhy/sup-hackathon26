import "server-only";
import type { FileKind } from "./analyze";

// OpenAI vision (VLM) forensics layer. Looks at the receipt for the two signals
// text/metadata cannot see: digital font-and-spacing tampering and physical
// alteration (scratch-outs, correction fluid, overwriting). The VLM is the only
// component here that reads the rendered document for tampering; the rest of the
// pipeline is deterministic. Uses the OpenAI Responses API so it accepts the
// same inputs as the claim extractor: images directly, PDFs as a file input
// (the model reads the rendered pages), and HEIC after a sharp decode. Failure
// is always soft: any error or missing key returns `null`, and the dependent
// checks stay `pending` rather than emitting a false `passed`.

export type VisionFinding = {
  suspicious: boolean;
  confidence: number; // 0-100, the model's own certainty in its judgement
  observations: string[]; // short, human-readable reasons (may be empty)
};

export type VisionForensics = {
  fontConsistency: VisionFinding;
  physicalAlteration: VisionFinding;
  model: string;
};

// gpt-4o is the default: in testing gpt-4o-mini reliably caught physical
// alteration but missed pure digital font-swaps, which gpt-4o detects. Override
// per-deployment without a code change (e.g. gpt-4o-mini to cut cost). Any
// OpenAI vision-capable, json_schema-capable model works.
const DEFAULT_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You are a forensic document examiner reviewing a photographed or scanned receipt/invoice for a fraud-triage team. You assess only what is visible in the image. You report two independent signals:

1. font_consistency — evidence that part of the printed text was DIGITALLY edited: a specific field (amount, date, total, merchant) rendered in a different font, weight, size, or baseline than the surrounding printed text of the same kind; misaligned or overlapping glyphs; kerning or anti-aliasing that does not match the rest of the line. Genuine receipts legitimately mix fonts by design (a logo/header differs from the thermal-printed body, a handwritten tip differs from print). Do NOT flag ordinary design variety, low resolution, blur, skew, or thermal-print fading. Flag ONLY when the inconsistency is localised to a value-bearing field in a way that suggests that value was replaced.

2. physical_alteration — visible physical tampering: scratch-outs, erasures, correction fluid/tape, smudges over text, pen or marker overwriting of a printed value, a value taped or pasted over another. Do NOT flag normal creases, folds, staple holes, coffee stains away from text, or printing artefacts.

Be conservative: a genuine receipt must come back not-suspicious. Set suspicious=true only with clear visual evidence. confidence is your certainty (0-100). observations: at most 3 short phrases citing what you saw, empty if nothing notable.`;

const USER_PROMPT =
  "Examine this receipt for digital font/spacing tampering and physical alteration. Respond only with the JSON object defined by the schema.";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    font_consistency: findingSchema(),
    physical_alteration: findingSchema(),
  },
  required: ["font_consistency", "physical_alteration"],
} as const;

function findingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      suspicious: { type: "boolean" },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      observations: { type: "array", items: { type: "string" }, maxItems: 3 },
    },
    required: ["suspicious", "confidence", "observations"],
  };
}

// Build the per-file input for the Responses API. PDFs are sent as a file input
// (the model reads the rendered pages); HEIC is decoded to JPEG via sharp; JPEG
// and PNG are sent directly as images.
async function fileInputFor(bytes: Buffer, fileKind: FileKind) {
  if (fileKind === "PDF") {
    return {
      type: "input_file",
      filename: "receipt.pdf",
      file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
    };
  }

  let payload = bytes;
  let mime = fileKind === "PNG" ? "image/png" : "image/jpeg";
  if (fileKind === "HEIC") {
    const sharp = (await import("sharp")).default;
    payload = await sharp(bytes).jpeg({ quality: 92 }).toBuffer();
    mime = "image/jpeg";
  }

  return {
    type: "input_image",
    image_url: `data:${mime};base64,${payload.toString("base64")}`,
    detail: "high",
  };
}

function outputText(response: Record<string, unknown>): string | null {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
    }
  }
  return null;
}

export async function analyzeImageForensics(
  bytes: Buffer,
  fileKind: FileKind,
): Promise<VisionForensics | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null; // not configured -> checks remain pending

  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL;

  try {
    const fileInput = await fileInputFor(bytes, fileKind);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: SYSTEM_PROMPT,
        max_output_tokens: 600,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: USER_PROMPT },
              fileInput,
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "receipt_forensics",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) return null;

    const body = await response.json() as Record<string, unknown>;
    const raw = outputText(body);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      font_consistency: VisionFinding;
      physical_alteration: VisionFinding;
    };

    return {
      fontConsistency: normalizeFinding(parsed.font_consistency),
      physicalAlteration: normalizeFinding(parsed.physical_alteration),
      model,
    };
  } catch {
    // Network error, rate limit, malformed output, billing issue: stay pending.
    return null;
  }
}

function normalizeFinding(finding: VisionFinding | undefined): VisionFinding {
  return {
    suspicious: Boolean(finding?.suspicious),
    confidence: clampConfidence(finding?.confidence),
    observations: Array.isArray(finding?.observations)
      ? finding!.observations.filter((o): o is string => typeof o === "string").slice(0, 3)
      : [],
  };
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
