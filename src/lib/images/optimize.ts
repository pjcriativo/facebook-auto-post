import sharp from "sharp";

export const MAX_POST_IMAGE_BYTES = 50 * 1024;
export const TARGET_POST_IMAGE_BYTES = 42 * 1024;

export interface OptimizedPostImage {
  bytes: Buffer;
  width: number;
  quality: number;
}

/**
 * Produces a Facebook-ready square JPEG under the strict 50 KB storage budget.
 * Simple template art normally stays at 1080 px; photographic backgrounds are
 * progressively reduced only when quality changes alone cannot meet the cap.
 */
export async function optimizePostImage(input: Buffer | Uint8Array): Promise<OptimizedPostImage> {
  const widths = [1080, 960, 840, 720, 600, 480];
  const qualities = [76, 68, 60, 52, 44, 36, 28, 22, 18];
  let smallest: OptimizedPostImage | null = null;

  for (const width of widths) {
    const pipeline = sharp(input)
      .rotate()
      .resize(width, width, { fit: "cover", position: sharp.strategy.attention })
      .flatten({ background: "#000000" });
    for (const quality of qualities) {
      const bytes = await pipeline
        .clone()
        .jpeg({ quality, progressive: true, chromaSubsampling: "4:2:0", mozjpeg: true })
        .toBuffer();
      const candidate = { bytes, width, quality };
      if (!smallest || bytes.length < smallest.bytes.length) smallest = candidate;
      if (bytes.length <= TARGET_POST_IMAGE_BYTES) return candidate;
      if (bytes.length <= MAX_POST_IMAGE_BYTES && quality <= 52) return candidate;
    }
  }

  if (smallest && smallest.bytes.length <= MAX_POST_IMAGE_BYTES) return smallest;
  throw new Error("Não foi possível reduzir a arte para o limite de 50 KB sem torná-la ilegível.");
}
