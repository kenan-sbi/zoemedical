// OCR provider seam — same pattern as the LLM seam. The pipeline calls getOCRProvider().extract();
// swapping OCR engines is an env change (OCR_PROVIDER), never a call-site change.
//   builtin — reads .txt directly + text-based PDFs via pdf-parse (default; no cost)
//   stub    — returns empty text (use to bypass OCR)
// TODO(OCR): add real engines for scanned/image PDFs behind this same interface —
//            e.g. Tesseract (local/free), Mistral OCR, or a vision LLM. Plug in via OCR_PROVIDER.

import { fixArabic } from '../text';

export interface OCRResult { text: string; source: string; blocks?: unknown[] }
export interface OCRInput { buf: Buffer; mimeType: string; filename: string }
export interface OCRProvider { name: string; extract(input: OCRInput): Promise<OCRResult> }

const providers: Record<string, OCRProvider> = {};
export function registerOCRProvider(p: OCRProvider) { providers[p.name] = p; }
export function getOCRProvider(name = process.env.OCR_PROVIDER ?? 'builtin'): OCRProvider {
  const p = providers[name];
  if (!p) throw new Error(`OCR provider not registered: ${name}`);
  return p;
}

const builtin: OCRProvider = {
  name: 'builtin',
  async extract({ buf, mimeType, filename }) {
    const name = filename.toLowerCase();
    if (mimeType === 'text/plain' || name.endsWith('.txt')) {
      return { text: buf.toString('utf8'), source: 'txt' };
    }
    if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
      const { PDFParse } = (await import('pdf-parse')) as any;
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        const result = await parser.getText();
        // Repair reversed/presentation-form Arabic from the PDF text layer before extraction.
        return { text: fixArabic((result?.text ?? '').trim()), source: 'pdf' };
      } finally {
        await parser.destroy();
      }
    }
    // Scanned images / unknown types: no text layer. Real OCR plugs in here (see TODO above).
    return { text: '', source: 'unsupported' };
  },
};

const stub: OCRProvider = {
  name: 'stub',
  async extract() { return { text: '', source: 'stub' }; },
};

registerOCRProvider(builtin);
registerOCRProvider(stub);
