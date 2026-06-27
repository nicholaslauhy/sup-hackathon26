import type { ExtractedFields, Flag, ReceiptType } from "../types";
import { grabClaimFlags } from "./grab";
import { medicalClaimFlags } from "./medical";
import { purchaseClaimFlags } from "./purchase";

export function claimSpecificFlags(claimType: ReceiptType, fields: ExtractedFields): Flag[] {
  if (claimType === "medical") return medicalClaimFlags(fields);
  if (claimType === "purchase") return purchaseClaimFlags(fields);
  return grabClaimFlags(fields);
}
