// Pipeline worker (local dev / self-hosted): consumes the BullMQ queue and runs the shared
// processDocument() pipeline. On Vercel this worker isn't used — the upload routes run
// processDocument() inline via waitUntil instead. Run as a separate process: `npm run worker`.
import { Worker } from 'bullmq';
import { connection } from '../lib/queue';
import { processDocument } from '../lib/pipeline/process';

new Worker('pipeline', async (job) => processDocument(job.data.documentId), { connection: connection as any, concurrency: 3 });

console.log('extract worker up');
