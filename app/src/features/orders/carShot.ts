/*
 * The car's photo taken by «＋» → «Фото номера» (v0.28) on its way to "New job": a file does not travel in the address,
 * so it waits here under an id the address carries (`/orders/new?photo=…`). One at a time: a new one takes the place
 * of the last; "New job" lets it go once the job is made.
 */
const held = new Map<string, File>();

export function holdCarShot(file: File): string {
  held.clear();
  const id = String(Date.now());
  held.set(id, file);
  return id;
}

export const heldCarShot = (id: string | null | undefined): File | undefined => (id ? held.get(id) : undefined);

export const dropCarShot = (id: string) => void held.delete(id);
