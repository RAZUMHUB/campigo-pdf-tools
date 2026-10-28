export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 2000;

export type PlacedImage = { src: string; mime: "image/png" | "image/jpeg"; ratio: number };

/**
 * Decodes a PNG/JPEG, applies its EXIF orientation, caps its size, and re-encodes it so that
 * what is previewed is exactly what gets embedded in the PDF.
 */
export async function loadImage(file: File): Promise<PlacedImage> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Choose a PNG or JPG image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is larger than 20 MB.");

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const shrink = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * shrink));
    canvas.height = Math.max(1, Math.round(bitmap.height * shrink));
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const context = canvas.getContext("2d")!;
    if (mime === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { src: canvas.toDataURL(mime, 0.92), mime, ratio: canvas.width / canvas.height };
  } finally {
    bitmap.close();
  }
}
