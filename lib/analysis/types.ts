// Frozen analysis result contract. Every downstream piece (scoring engine,
// API, UI, stored `result` JSONB) depends only on these shapes. When OpenAI
// credits arrive, the VLM fills in `extracted` and flips `pending` flags to
// `triggered`/`passed` -- no shape change required.

export type ReceiptType = "medical" | "purchase" | "grab";

export type Tier = "green" | "amber" | "red";

export type Severity = "info" | "low" | "medium" | "high";

// `pending` = this check needs the VLM and has not been evaluated yet.
export type FlagStatus = "triggered" | "passed" | "pending";

export type Flag = {
  id: string; // stable id, e.g. "duplicate", "exif-editor", "arithmetic"
  title: string;
  severity: Severity;
  status: FlagStatus;
  explanation: string;
  evidence?: Record<string, unknown>; // failing math, metadata field, region, etc.
};

export type LineItem = {
  description: string;
  quantity?: number | null;
  unitPrice?: number | null;
  amount: number;
};

export type ExtractedFields = {
  merchant?: string;
  date?: string;
  currency?: string;
  receiptNumber?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  lineItems?: LineItem[];
  discount?: number;
  paymentMethod?: string;
  address?: string;
  layoutConcerns?: string[];
  medical?: {
    clinicName?: string;
    doctorName?: string;
    patientName?: string;
    registrationNumber?: string;
    visitDateTime?: string;
  };
  grab?: {
    receiptKind?: "transport" | "food_delivery" | "parcel_delivery" | "other" | null;
    bookingId?: string;
    orderId?: string;
    serviceType?: string;
    pickup?: string;
    dropoff?: string;
    deliveryAddress?: string;
    tripDateTime?: string;
    orderDateTime?: string;
    receiptDateTime?: string;
    fare?: number;
    tolls?: number;
    platformFee?: number;
    lineItemsComplete?: boolean | null;
  };
};

export type AnalysisResult = {
  schemaVersion: 1;
  tier: Tier;
  score: number; // 0-100, higher = more suspicious
  flags: Flag[];
  extracted: ExtractedFields | null; // null until the VLM is wired
  summary: string;
  analyzedAt: string; // ISO timestamp
};

export const SCHEMA_VERSION = 1 as const;
