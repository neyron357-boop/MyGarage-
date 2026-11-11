/*
 * Handing a file to the phone: its share sheet (WhatsApp, Telegram, AirDrop, "Save Image" / "Save to
 * Files"…), or — where files cannot be shared (a PC, plain http) — a download. Sharing must start
 * right in the tap (iOS refuses it after a wait): have the file ready before the button is pressed.
 */

export function canShareFile(file: File | undefined): boolean {
  return !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Share the file, or download it where sharing files is not possible (or fails). */
export function shareOrDownload(file: File): void {
  if (!canShareFile(file)) return downloadFile(file);
  navigator.share({ files: [file] }).catch((e: unknown) => {
    if ((e as Error)?.name !== 'AbortError') downloadFile(file);
  });
}
