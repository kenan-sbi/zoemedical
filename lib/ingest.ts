// Ingest helpers: store an uploaded file + dispatch it, and extract source text for the Reader.
// (Extraction contract lives in reader.ts and is not touched.)
import { createHash } from 'crypto';
import { prisma } from './db';
import { getOCRProvider } from './ocr';
import { putObject, getObject } from './storage';

// Persist a file to object storage, create Document + ProcessingJob, and dispatch it for extraction.
// Storage backend (Supabase Storage vs local disk) is chosen inside lib/storage.
export async function storeUpload(buf: Buffer, filename: string, mimeType: string, patientId: string) {
  const hash = createHash('sha256').update(buf).digest('hex');
  const safe = filename.replace(/[^\w.\-]/g, '_');
  const storageKey = `uploads/${hash}__${safe}`;
  await putObject(storageKey, buf, mimeType);

  const doc = await prisma.document.create({ data: { patientId, filename, mimeType, storageKey, hash } });
  await prisma.processingJob.create({ data: { documentId: doc.id } });
  const { dispatchDocument } = await import('./dispatch'); // lazy: breaks the ingest<->pipeline cycle
  await dispatchDocument(doc.id);
  return doc.id;
}

// Resolve the plain text of a document for extraction — via the OCR provider seam.
// Swap engines with OCR_PROVIDER; no change here or in the worker.
export async function extractDocumentText(doc: {
  mimeType: string; filename: string; storageKey: string | null; ocrBlocks: unknown;
}): Promise<{ text: string; source: string }> {
  if (doc.storageKey) {
    const buf = await getObject(doc.storageKey);
    const result = await getOCRProvider().extract({ buf, mimeType: doc.mimeType, filename: doc.filename });
    if (result.text) return { text: result.text, source: result.source };
  }
  // Fallback: OCR output pre-populated on doc.ocrBlocks.text.
  return { text: (doc.ocrBlocks as any)?.text ?? '', source: 'ocrBlocks' };
}
