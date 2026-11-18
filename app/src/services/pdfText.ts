import type { TextItem } from '../domain/obdReport';

/*
 * The text of a PDF with the position of every piece (pdf.js, loaded only when a PDF is read — it is
 * large). Used to read a scanner's report and the garage's invoices and quotations.
 */
let loading: Promise<typeof import('pdfjs-dist')> | undefined;
function loadPdfjs() {
  loading ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    return pdfjs;
  })();
  return loading;
}

/** Start loading pdf.js now (a tap that will open the file picker): the file is read at once when picked. */
export function warmPdfText(): void {
  void loadPdfjs().catch(() => (loading = undefined));
}

/**
 * The text of a PDF and how many pages it has (an empty page has no text, v0.45) — with its spaces set as pieces of
 * their own (" "): two words that touch are two words (domain/docImport.ts `rowsOf`).
 */
export async function pdfTextPages(file: Blob): Promise<{ items: TextItem[]; pages: number }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const items: TextItem[] = [];
  try {
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      for (const it of content.items) {
        if ('str' in it && it.str.length) items.push({ page, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5]), str: it.str.trim() ? it.str : ' ', w: Math.round(it.width * 10) / 10 });
      }
    }
    return { items, pages: doc.numPages };
  } finally {
    void task.destroy();
  }
}

export async function pdfTextItems(file: Blob): Promise<TextItem[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const items: TextItem[] = [];
  try {
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      for (const it of content.items) {
        if ('str' in it && it.str.trim()) items.push({ page, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5]), str: it.str, w: Math.round(it.width * 10) / 10 });
      }
    }
  } finally {
    void task.destroy();
  }
  return items;
}
