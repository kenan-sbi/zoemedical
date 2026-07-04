import { Queue } from 'bullmq';
import IORedis from 'ioredis';
export const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
export const pipeline = new Queue('pipeline', { connection });
export async function enqueueDocument(documentId: string) {
  return pipeline.add('ingest', { documentId }, {
    attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000,
  });
}
