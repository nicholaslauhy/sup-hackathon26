import "server-only";
import { createHash } from "node:crypto";

// SHA-256 of the raw file bytes. Identical files produce an identical hash,
// which is exact-duplicate detection.
export function contentHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Perceptual hash (dhash) for JPEG/PNG: resize to 9x8 greyscale and compare
// adjacent pixels. Near-identical images yield near-identical hashes, so small
// edits/re-saves still collide. Returns null for formats we cannot decode here
// (HEIC, PDF) -- those rely on the exact content hash only.
export async function perceptualHash(bytes: Buffer, fileKind: string): Promise<string | null> {
  if (fileKind !== "JPEG" && fileKind !== "PNG") return null;
  try {
    // Imported lazily so the rest of the analyzer works even if sharp's native
    // binary is unavailable on a given machine.
    const sharp = (await import("sharp")).default;
    const width = 9;
    const height = 8;
    const raw = await sharp(bytes)
      .greyscale()
      .resize(width, height, { fit: "fill" })
      .raw()
      .toBuffer();

    let bits = "";
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width - 1; col++) {
        const left = raw[row * width + col];
        const right = raw[row * width + col + 1];
        bits += left < right ? "1" : "0";
      }
    }

    // Pack 64 bits into a 16-char hex string.
    let hex = "";
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

// Hamming distance between two equal-length hex perceptual hashes.
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}
