// Ingest helpers: store an uploaded file + enqueue it, and extract source text for the Reader.
// (Extraction contract lives in reader.ts and is not touched.)
import { createHash } from 'crypto';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { prisma } from './db';
import { enqueueDocument } from './queue';
import { getOCRProvider } from './ocr';

// Persist a file to local storage, create Document + ProcessingJob, and enqueue it.
// TODO(storage): swap local ./uploads for S3-compatible object storage at the PHI boundary.
export async function storeUpload(buf: Buffer, filename: string, mimeType: string, patientId: string) {
  const hash = createHash('sha256').update(buf).digest('hex');
  const safe = filename.replace(/[^\w.\-]/g, '_');
  const storageKey = `uploads/${hash}__${safe}`;
  await mkdir(join(process.cwd(), 'uploads'), { recursive: true });
  await writeFile(join(process.cwd(), storageKey), buf);

  const doc = await prisma.document.create({ data: { patientId, filename, mimeType, storageKey, hash } });
  await prisma.processingJob.create({ data: { documentId: doc.id } });
  await enqueueDocument(doc.id);
  return doc.id;
}

// Resolve the plain text of a document for extraction — via the OCR provider seam.
// Swap engines with OCR_PROVIDER; no change here or in the worker.
export async function extractDocumentText(doc: {
  mimeType: string; filename: string; storageKey: string | null; ocrBlocks: unknown;
}): Promise<{ text: string; source: string }> {
  if (doc.storageKey) {
    const buf = await readFile(resolve(process.cwd(), doc.storageKey));
    const result = await getOCRProvider().extract({ buf, mimeType: doc.mimeType, filename: doc.filename });
    if (result.text) return { text: result.text, source: result.source };
  }
  // Fallback: OCR output pre-populated on doc.ocrBlocks.text.
  return { text: (doc.ocrBlocks as any)?.text ?? '', source: 'ocrBlocks' };
}
