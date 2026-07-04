// Local open-model provider via Ollama (https://ollama.com) — free, realistic LLM behavior,
// nothing leaves the machine. Run e.g. `ollama pull qwen2.5` then `ollama serve`.
// Configure with OLLAMA_BASE_URL (default http://localhost:11434) and OLLAMA_MODEL.
import type { LLMProvider } from '../provider';

export const ollama: LLMProvider = {
  name: 'ollama',
  async complete({ system, user, temperature = 0 }) {
    const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL ?? 'qwen2.5';
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',          // ask for JSON; callers still parse tolerantly
        options: { temperature },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return data?.message?.content ?? '[]';
  },
};
