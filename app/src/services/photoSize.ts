/**
 * A photo with its long side at `side` px (decoded off the main thread); none when it is that small already, or the
 * browser cannot read it. Used for a card's photo (1080 px — sharp across a phone, a third of the original's bytes):
 * made where the photo is, kept beside it, and sent to the garage's server with it (v0.41.3).
 */
export async function shrinkPhoto(blob: Blob, side: number): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined' || !blob.type.startsWith('image/')) return undefined;
  try {
    const bmp = await createImageBitmap(blob);
    const scale = side / Math.max(bmp.width, bmp.height);
    if (scale >= 0.85) {
      bmp.close();
      return undefined;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = (await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))) ?? undefined;
    // Safari keeps a canvas's memory until it is emptied.
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } catch {
    return undefined;
  }
}

/** The side of a card's photo. */
export const CARD_SIDE = 1080;

/**
 * A photo's card to send with it: made at the card's size; a small photo is its own card (made again it would only
 * grow); none when it cannot be read and is large (the server or another device makes one).
 */
export async function cardOf(blob: Blob): Promise<Blob | undefined> {
  return (await shrinkPhoto(blob, CARD_SIDE)) ?? (blob.size <= 400 * 1024 ? blob : undefined);
}
