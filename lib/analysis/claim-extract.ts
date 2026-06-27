import "server-only";
import type { ExtractedFields, ReceiptType } from "./types";
import type { FileKind } from "./analyze";

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "merchant", "date", "currency", "receiptNumber", "subtotal", "tax", "total",
    "discount", "paymentMethod", "address", "lineItems", "layoutConcerns", "medical", "grab",
  ],
  properties: {
    merchant: { type: ["string", "null"] },
    date: { type: ["string", "null"], description: "ISO 8601 when possible" },
    currency: { type: ["string", "null"] },
    receiptNumber: { type: ["string", "null"] },
    subtotal: { type: ["number", "null"] },
    tax: { type: ["number", "null"] },
    total: { type: ["number", "null"] },
    discount: { type: ["number", "null"] },
    paymentMethod: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice", "amount"],
        properties: {
          description: { type: "string" },
          quantity: { type: ["number", "null"] },
          unitPrice: { type: ["number", "null"] },
          amount: { type: "number" },
        },
      },
    },
    layoutConcerns: {
      type: "array",
      items: { type: "string" },
      description: "Only visible font, spacing, alignment, overwrite, or scratch-out concerns. Empty when none.",
    },
    medical: {
      type: "object",
      additionalProperties: false,
      required: ["clinicName", "doctorName", "patientName", "registrationNumber", "visitDateTime"],
      properties: {
        clinicName: { type: ["string", "null"] },
        doctorName: { type: ["string", "null"] },
        patientName: { type: ["string", "null"] },
        registrationNumber: { type: ["string", "null"] },
        visitDateTime: { type: ["string", "null"], description: "ISO 8601 when possible" },
      },
    },
    grab: {
      type: "object",
      additionalProperties: false,
      required: [
        "receiptKind", "bookingId", "orderId", "serviceType", "pickup", "dropoff",
        "deliveryAddress", "tripDateTime", "orderDateTime", "receiptDateTime",
        "fare", "tolls", "platformFee", "lineItemsComplete",
      ],
      properties: {
        receiptKind: {
          type: ["string", "null"],
          enum: ["transport", "food_delivery", "parcel_delivery", "other", null],
        },
        bookingId: { type: ["string", "null"] },
        orderId: { type: ["string", "null"] },
        serviceType: { type: ["string", "null"] },
        pickup: { type: ["string", "null"] },
        dropoff: { type: ["string", "null"] },
        deliveryAddress: { type: ["string", "null"] },
        tripDateTime: { type: ["string", "null"], description: "ISO 8601 when possible" },
        orderDateTime: { type: ["string", "null"], description: "ISO 8601 when possible" },
        receiptDateTime: { type: ["string", "null"], description: "ISO 8601 when possible" },
        fare: { type: ["number", "null"] },
        tolls: { type: ["number", "null"] },
        platformFee: { type: ["number", "null"] },
        lineItemsComplete: {
          type: ["boolean", "null"],
          description: "True only when every visible monetary row contributing to the displayed total was captured in lineItems.",
        },
      },
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

export async function extractClaimFields(
  bytes: Buffer,
  fileKind: FileKind,
  claimType: ReceiptType,
): Promise<ExtractedFields | null> {
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
            {
              type: "input_text",
              text: [
                `Extract this ${claimType} claim receipt into the supplied schema.`,
                "Transcribe only visible information. Use null for absent or illegible scalar fields and [] when no line items or layout concerns are visible.",
                "Do not infer fraud and do not invent registration numbers, booking IDs, routes, dates, or amounts.",
                "For medical claims, prioritize clinic/provider, visit, registration, and treatment details.",
                "For purchase claims, prioritize merchant, receipt number, quantities, unit prices, discounts, tax, and totals.",
                "For Grab claims, first classify receiptKind as transport, food_delivery, parcel_delivery, or other.",
                "For transport, prioritize booking ID, service type, pickup/drop-off, trip/receipt timestamps, and every displayed monetary charge row.",
                "For GrabFood or delivery, prioritize order ID, merchant, order/receipt timestamps, delivery address, items, quantities, item prices, delivery fee, service/platform fee, small-order fee, discounts, promotions, tax, tips, and total. Do not require transport route fields.",
                "For parcel delivery, prioritize booking/order ID, pickup/drop-off or delivery address, timestamps, base charge, distance/surcharge, tolls, discounts, tax, and total.",
                "For every Grab receipt, put every displayed monetary row contributing to the total into lineItems. Use the signed contribution shown by the receipt: charges are positive and discounts/promotions are negative.",
                "Set grab.lineItemsComplete to true only when every visible monetary row contributing to the displayed total is captured in lineItems. Set it false when any row is illegible, omitted, summarized ambiguously, or when lineItems is empty despite a visible breakdown.",
              ].join(" "),
            },
            fileInput,
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "receipt_claim_extraction",
            strict: true,
            schema: EXTRACTION_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const text = outputText(body);
    if (!text) return null;
    return JSON.parse(text) as ExtractedFields;
  } catch {
    return null;
  }
}
