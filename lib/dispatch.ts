// Route a freshly-created document into the processing pipeline, picking the mechanism by env:
//   - REDIS_URL present (local dev / self-hosted): enqueue to BullMQ; the worker consumes it.
//   - No REDIS_URL (serverless / Vercel): run processDocument() inline via waitUntil.
// The queue module is imported LAZILY so Vercel (no Redis) never constructs an ioredis client.
import { runBackground } from './background';
import { processDocument } from './pipeline/process';

export async function dispatchDocument(documentId: string): Promise<void> {
  if (process.env.REDIS_URL) {
    const { enqueueDocument } = await import('./queue');
    await enqueueDocument(documentId);
  } else {
    runBackground(processDocument(documentId));
  }
}
