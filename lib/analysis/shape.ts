import "server-only";
import sharp from "sharp";

// A lightweight, no-extra-dependency proxy for "is this a photo of a document".
// True rectangle/contour detection needs OpenCV; instead we read the luminance
// distribution, which separates paper-and-ink documents from ordinary photos:
// a receipt is a bright paper field with a small fraction of dark ink, whereas
// a scene/portrait is dominated by midtones. Approximate by design.
export type DocumentShape = {
  brightFraction: number; // share of near-white pixels (paper)
  darkFraction: number; // share of near-black pixels (ink)
  aspectRatio: number; // height / width
  documentLike: boolean;
};

const BRIGHT = 200; // >= this grey level counts as paper
const DARK = 80; // <= this grey level counts as ink

export async function documentShapeSignal(bytes: Buffer): Promise<DocumentShape | null> {
  try {
    const meta = await sharp(bytes).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const aspectRatio = width ? round3(height / width) : 0;

    // Downscale to keep the pixel scan cheap; greyscale for luminance.
    const { data, info } = await sharp(bytes)
      .greyscale()
      .resize(256, 256, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels || 1;
    const pixels = info.width * info.height;
    let bright = 0;
    let dark = 0;
    for (let p = 0; p < pixels; p++) {
      const v = data[p * channels];
      if (v >= BRIGHT) bright++;
      else if (v <= DARK) dark++;
    }

    const brightFraction = pixels ? round3(bright / pixels) : 0;
    const darkFraction = pixels ? round3(dark / pixels) : 0;

    // Paper-dominant frame is the strong signal: a receipt sits on a bright
    // field, a scene/portrait does not. Ink is intentionally not required on the
    // low end — sparse receipts have very little dark area — only capped so a
    // near-black image is not mistaken for paper.
    const documentLike = brightFraction >= 0.5 && darkFraction <= 0.6;

    return { brightFraction, darkFraction, aspectRatio, documentLike };
  } catch {
    return null;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
