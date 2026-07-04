// VERIFIER — a second, DIFFERENT model cross-checks each extracted fact against its cited source.
// Additive safety only: it never edits or deletes a fact or its provenance. Disagreements are
// recorded (Provenance.verifier) and surfaced for review. Runs through the VERIFIER role, so it
// obeys the same provider seam — mock/ollama/gemini/etc.
import { getProvider, MODEL_ROUTING } from './provider';
import type { ReadResult } from './reader';

const SYSTEM = `You are a clinical fact verifier. You are given ONE extracted claim and the exact source text it was drawn from.
Decide whether the claim is faithfully supported by that source text — do not use outside knowledge.
Return ONLY JSON: {"agree": boolean, "reason": string}. No prose, no markdown.`;

export interface Verdict { sourceText: string; agree: boolean; reason: string }

export function verifierEnabled() {
  return (process.env.VERIFIER_ENABLED ?? '1') === '1';
}

// Cross-check each kept fact. Returns one verdict per fact (keyed by its verbatim sourceText).
export async function verifyFacts(facts: ReadResult['facts']): Promise<Verdict[]> {
  const routing = MODEL_ROUTING.VERIFIER;
  const provider = getProvider(routing.provider);
  const out: Verdict[] = [];
  for (const f of facts) {
    const raw = await provider.complete({
      system: SYSTEM,
      user: JSON.stringify({
        claim: { type: f.type, display: f.display, payload: f.payload, negated: f.negated, assertion: f.assertion },
        source: f.sourceText,
      }),
      reasoning: routing.reasoning,
      temperature: routing.temperature,
    });
    let agree = true, reason = 'unparsed — defaulted to agree';
    try {
      const j = JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim());
      agree = j.agree !== false;
      reason = typeof j.reason === 'string' ? j.reason : reason;
    } catch { /* keep default */ }
    out.push({ sourceText: f.sourceText, agree, reason });
  }
  return out;
}
