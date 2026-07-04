// Register LLM providers here. Import this once at worker/server startup.
// Free stand-ins (mock, ollama) let the whole pipeline run with no paid API. Real providers
// (gemini now; add openai/claude adapters the same way) plug in via env — see MODEL_ROUTING.
import { registerProvider, LLMProvider, MODEL_ROUTING } from './provider';
import { mock } from './providers/mock';
import { ollama } from './providers/ollama';

// Real provider: Google Gemini. Model is env-configurable (default flash = free-tier friendly).
const gemini: LLMProvider = {
  name: 'gemini',
  async complete({ system, user, temperature = 0, json }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY missing (set it, or use LLM_PROVIDER=mock/ollama)');
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const generationConfig: any = { temperature };
    if (json !== false) generationConfig.responseMimeType = 'application/json'; // prose callers pass json:false
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig,
        }) });
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  },
};

// TODO: add OpenAI / Claude adapters here as additional plug-ins (esp. a DIFFERENT model for the Verifier).
registerProvider(mock);
registerProvider(ollama);
registerProvider(gemini);

// Log the ACTUAL provider each role will use at startup (once per process).
const keyPresent = !!process.env.GEMINI_API_KEY;
console.log(`[llm] providers: mock, ollama, gemini | GEMINI_API_KEY: ${keyPresent ? 'present' : 'MISSING'}`);
for (const role of ['READER', 'VERIFIER', 'ANALYZER'] as const) {
  const want = MODEL_ROUTING[role].provider;
  const eff = want === 'gemini' && !keyPresent ? 'mock (fallback: no key)' : want;
  const model = eff.startsWith('gemini') ? ` [${process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'}]` : '';
  console.log(`[llm]   ${role} -> ${eff}${model}`);
}
