// Run async work that must outlive the HTTP response.
// On Vercel, waitUntil() keeps the serverless function alive until the work settles (within the
// function's max duration). Locally, the persistent dev/server process keeps a floating promise
// running. Errors are swallowed here — the pipeline records its own failure on the ProcessingJob.
export function runBackground(work: Promise<unknown>): void {
  const p = Promise.resolve(work).catch((e) => console.error('[background]', e));
  try {
    // Lazy require so local dev without @vercel/functions still runs.
    const { waitUntil } = require('@vercel/functions');
    waitUntil(p);
  } catch {
    void p; // fire-and-forget; the process stays alive to finish it
  }
}
