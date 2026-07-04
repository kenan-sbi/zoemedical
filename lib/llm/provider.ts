// Provider abstraction: every model implements this, so swapping models is a config change,
// never a call-site change. Add adapters (Gemini/Claude/OpenAI) that implement LLMProvider.

export interface LLMProvider {
  name: string;
  // returns raw text; the caller enforces the structured-output + citation contract
  complete(opts: {
    system: string;
    user: string;
    reasoning?: boolean; // OFF for extraction (Reader), ON for analysis (Analyzer)
    temperature?: number;
    json?: boolean;      // default true (structured output); set false for prose (e.g. the summary)
  }): Promise<string>;
}

// Role -> provider binding. Change models here in ONE place, or via env with no code change.
// LLM_PROVIDER sets the default for every role; <ROLE>_PROVIDER overrides one role.
// Default prefers Gemini when GEMINI_API_KEY is set, else the offline mock. Reader = faithful
// extraction (reasoning off); Verifier = a DIFFERENT model; Analyzer = reasoning on.
const DEFAULT_PROVIDER = process.env.LLM_PROVIDER ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'mock');
export const MODEL_ROUTING = {
  READER:   { provider: process.env.READER_PROVIDER   ?? DEFAULT_PROVIDER, reasoning: false, temperature: 0 },
  VERIFIER: { provider: process.env.VERIFIER_PROVIDER ?? DEFAULT_PROVIDER, reasoning: false, temperature: 0 },
  ANALYZER: { provider: process.env.ANALYZER_PROVIDER ?? DEFAULT_PROVIDER, reasoning: true,  temperature: 0.2 },
};

// --- registry ---
const providers: Record<string, LLMProvider> = {};
export function registerProvider(p: LLMProvider) { providers[p.name] = p; }
export function getProvider(name: string): LLMProvider {
  // Graceful fallback: a role routed to gemini with no API key uses the mock instead of failing.
  if (name === 'gemini' && !process.env.GEMINI_API_KEY && providers['mock']) {
    console.warn('[llm] GEMINI_API_KEY not set — falling back to mock for this role (set it in .env to enable Gemini).');
    name = 'mock';
  }
  const p = providers[name];
  if (!p) throw new Error(`LLM provider not registered: ${name}. Register it in lib/llm/index.ts`);
  return p;
}
