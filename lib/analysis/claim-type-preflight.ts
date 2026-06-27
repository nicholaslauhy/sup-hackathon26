import "server-only";
import type { FileKind } from "./analyze";
import {
  CLAIM_TYPE_PREFLIGHT_PROMPT,
  classifyClaimTypeFromText,
  finalizeDecision,
  type ClaimTypeDecision,
  type DetectedReceiptType,
} from "./claim-type-classifier";
import { extractFields } from "./extract";
import type { ReceiptType } from "./types";

type AiClassification = {
  detectedType?: DetectedReceiptType;
  confidence?: number;
  reasons?: string[];
};

const CLAIM_TYPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["detectedType", "confidence", "reasons"],
  properties: {
    detectedType: {
      type: "string",
      enum: ["grab", "medical", "purchase", "unknown"],
      description: "The visible receipt category. Use unknown when the document is too unclear or does not fit these categories.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "Confidence in the category, where 100 is certain.",
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description: "Short visible evidence, such as branding, booking ID, clinic terms, or product line items.",
    },
  },
} as const;

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

async function imageInput(bytes: Buffer, fileKind: FileKind) {
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

async function classifyWithAi(bytes: Buffer, fileKind: FileKind): Promise<ClaimTypeDecision | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const fileInput = fileKind === "PDF"
      ? {
          type: "input_file",
          filename: "receipt.pdf",
          file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
        }
      : await imageInput(bytes, fileKind);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_RECEIPT_MODEL ?? "gpt-5-mini",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: CLAIM_TYPE_PREFLIGHT_PROMPT },
            fileInput,
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "claim_type_preflight",
            strict: true,
            schema: CLAIM_TYPE_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const text = outputText(body);
    if (!text) return null;

    const parsed = JSON.parse(text) as AiClassification;
    const detectedType = parsed.detectedType ?? "unknown";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter((reason): reason is string => typeof reason === "string") : [];
    if (!["grab", "medical", "purchase", "unknown"].includes(detectedType)) return null;

    return {
      status: "unknown",
      detectedType,
      confidence,
      source: "ai",
      reasons: reasons.length ? reasons : ["AI classified the visible receipt type."],
    };
  } catch {
    return null;
  }
}

export async function validateSelectedClaimType(input: {
  bytes: Buffer;
  fileKind: FileKind;
  selectedClaimType: ReceiptType;
}): Promise<ClaimTypeDecision> {
  let textDecision: ClaimTypeDecision | null = null;

  if (input.fileKind !== "HEIC") {
    const extracted = await extractFields(input.bytes, input.fileKind);
    textDecision = classifyClaimTypeFromText(extracted.rawText);
    const finalizedText = finalizeDecision(input.selectedClaimType, textDecision);
    if (finalizedText.status === "mismatch" || finalizedText.status === "match") return finalizedText;
  }

  const aiDecision = await classifyWithAi(input.bytes, input.fileKind);
  if (aiDecision) return finalizeDecision(input.selectedClaimType, aiDecision);

  return textDecision
    ? finalizeDecision(input.selectedClaimType, textDecision)
    : {
        status: "unknown",
        detectedType: "unknown",
        confidence: 0,
        source: "none",
        reasons: ["Claim type could not be classified before analysis."],
      };
}
