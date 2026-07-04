import { Queue } from 'bullmq';
import IORedis from 'ioredis';
export const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
// `as any`: bullmq bundles its own ioredis copy, so the top-level ioredis instance is a structurally
// identical but nominally different type. Cast bridges the two (runtime is fine).
export const pipeline = new Queue('pipeline', { connection: connection as any });
export async function enqueueDocument(documentId: string) {
  return pipeline.add('ingest', { documentId }, {
    attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000,
  });
}
