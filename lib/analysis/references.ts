import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentHash, hammingDistance, perceptualHash } from "./hash";
import type { FileKind } from "./analyze";
import type { Flag, ReceiptType } from "./types";

const BUCKET = process.env.CLAIM_REFERENCE_BUCKET ?? "claim types";
const FOLDERS: Record<ReceiptType, string> = {
  medical: "medical authentic",
  purchase: "purchase authentic",
  grab: "grab authentic",
};
const CACHE_MS = 5 * 60 * 1000;
const MAX_REFERENCES = 20;
const REFERENCE_DISTANCE = 6;

type Reference = {
  name: string;
  contentHash: string;
  perceptualHash: string | null;
};

const cache = new Map<ReceiptType, { loadedAt: number; references: Reference[] }>();

function kindFromName(name: string): FileKind | null {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "pdf") return "PDF";
  if (extension === "jpg" || extension === "jpeg") return "JPEG";
  if (extension === "png") return "PNG";
  if (extension === "heic" || extension === "heif") return "HEIC";
  return null;
}

async function loadReferences(claimType: ReceiptType): Promise<Reference[]> {
  const cached = cache.get(claimType);
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.references;

  const admin = createAdminClient();
  const folder = FOLDERS[claimType];
  const { data: entries, error } = await admin.storage.from(BUCKET).list(folder, {
    limit: MAX_REFERENCES,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) return [];

  const references: Reference[] = [];
  for (const entry of entries ?? []) {
    const kind = kindFromName(entry.name);
    if (!kind) continue;
    const { data, error: downloadError } = await admin.storage.from(BUCKET).download(`${folder}/${entry.name}`);
    if (downloadError || !data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    references.push({
      name: entry.name,
      contentHash: contentHash(bytes),
      perceptualHash: await perceptualHash(bytes, kind),
    });
  }

  cache.set(claimType, { loadedAt: Date.now(), references });
  return references;
}

export async function authenticReferenceFlag(
  claimType: ReceiptType,
  uploadHash: string,
  uploadPerceptualHash: string | null,
): Promise<Flag> {
  const references = await loadReferences(claimType);
  if (references.length === 0) {
    return {
      id: `${claimType}-reference`,
      title: "Authentic reference comparison",
      severity: "info",
      status: "pending",
      explanation: `No usable authentic ${claimType} examples were available in the private reference bucket.`,
    };
  }

  const exact = references.find((reference) => reference.contentHash === uploadHash);
  if (exact) {
    return {
      id: `${claimType}-reference`,
      title: "Matches an authentic reference file",
      severity: "info",
      status: "passed",
      explanation: "The uploaded file is byte-for-byte identical to an authentic reference example. This is supporting context, not standalone proof of authenticity.",
      evidence: { referenceFile: exact.name, referenceCount: references.length, matchType: "exact" },
    };
  }

  if (uploadPerceptualHash) {
    let closest: { reference: Reference; distance: number } | null = null;
    for (const reference of references) {
      if (!reference.perceptualHash) continue;
      const distance = hammingDistance(uploadPerceptualHash, reference.perceptualHash);
      if (!closest || distance < closest.distance) closest = { reference, distance };
    }
    if (closest && closest.distance <= REFERENCE_DISTANCE) {
      return {
        id: `${claimType}-reference`,
        title: "Visually resembles an authentic reference",
        severity: "info",
        status: "passed",
        explanation: "The uploaded image is visually close to an authentic example. With a small reference set, this is supporting context only and does not lower the risk score.",
        evidence: {
          referenceFile: closest.reference.name,
          referenceCount: references.length,
          perceptualDistance: closest.distance,
          matchType: "visual",
        },
      };
    }
  }

  return {
    id: `${claimType}-reference`,
    title: "No close authentic reference match",
    severity: "info",
    status: "pending",
    explanation: `The file did not closely match the ${references.length} available authentic ${claimType} example${references.length === 1 ? "" : "s"}. Because the reference set is small, this is not treated as suspicious.`,
    evidence: { referenceCount: references.length },
  };
}
