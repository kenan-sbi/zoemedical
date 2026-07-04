// Dev check: show role→provider routing, confirm all providers are registered, and run the
// Reader once against whatever provider is currently routed. Not part of the app.
import '../lib/llm';
import { MODEL_ROUTING, getProvider } from '../lib/llm/provider';
import { readDocument } from '../lib/llm/reader';
import { readFileSync } from 'fs';

for (const [role, r] of Object.entries(MODEL_ROUTING)) console.log(`${role} -> ${r.provider}`);
console.log('registered:', ['mock', 'ollama', 'gemini'].map((n) => { try { getProvider(n); return n; } catch { return n + '(MISSING)'; } }).join(', '));

const text = readFileSync('samples/discharge_summary.txt', 'utf8');
const read = await readDocument(text);
console.log(`reader model: ${read.model} | kept: ${read.facts.length} | dropped: ${read.dropped.length}`);
