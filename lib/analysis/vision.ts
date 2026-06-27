import "server-only";
import type { FileKind } from "./analyze";

// OpenAI vision (VLM) forensics layer. Looks at the receipt *image* for the two
// signals text/metadata cannot see: digital font-and-spacing tampering and
// physical alteration (scratch-outs, correction fluid, overwriting). The VLM is
// the only component here that reads pixels for tampering; the rest of the
// pipeline is deterministic. Failure is always soft: any error, missing key, or
// unsupported file returns `null`, and the dependent checks stay `pending`
// rather than emitting a false `passed`.

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

function mimeFor(fileKind: FileKind): string | null {
  if (fileKind === "JPEG") return "image/jpeg";
  if (fileKind === "PNG") return "image/png";
  return null; // PDF rasterisation / HEIC decode not wired yet -> no vision pass
}

const SYSTEM_PROMPT = `You are a forensic document examiner reviewing a photographed or scanned receipt/invoice for a fraud-triage team. You assess only what is visible in the image. You report two independent signals:

1. font_consistency — evidence that part of the printed text was DIGITALLY edited: a specific field (amount, date, total, merchant) rendered in a different font, weight, size, or baseline than the surrounding printed text of the same kind; misaligned or overlapping glyphs; kerning or anti-aliasing that does not match the rest of the line. Genuine receipts legitimately mix fonts by design (a logo/header differs from the thermal-printed body, a handwritten tip differs from print). Do NOT flag ordinary design variety, low resolution, blur, skew, or thermal-print fading. Flag ONLY when the inconsistency is localised to a value-bearing field in a way that suggests that value was replaced.

2. physical_alteration — visible physical tampering: scratch-outs, erasures, correction fluid/tape, smudges over text, pen or marker overwriting of a printed value, a value taped or pasted over another. Do NOT flag normal creases, folds, staple holes, coffee stains away from text, or printing artefacts.

Be conservative: a genuine receipt must come back not-suspicious. Set suspicious=true only with clear visual evidence. confidence is your certainty (0-100). observations: at most 3 short phrases citing what you saw, empty if nothing notable.`;

const USER_PROMPT =
  "Examine this receipt image for digital font/spacing tampering and physical alteration. Respond only with the JSON object defined by the schema.";

const RESPONSE_SCHEMA = {
  name: "receipt_forensics",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      font_consistency: findingSchema(),
      physical_alteration: findingSchema(),
    },
    required: ["font_consistency", "physical_alteration"],
  },
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

export async function analyzeImageForensics(
  bytes: Buffer,
  fileKind: FileKind,
): Promise<VisionForensics | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null; // not configured -> checks remain pending

  const mime = mimeFor(fileKind);
  if (!mime) return null; // only raster images are supported for now

  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL;

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });

    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: USER_PROMPT },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
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
