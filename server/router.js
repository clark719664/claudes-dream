import { GAME_INTENT_SCHEMA } from '../shared/intent.js';
import { compileIntentToSpec } from '../shared/designer.js';

const SYSTEM_PROMPT = `You are the Reverie Game AI.
Your job is to translate the user's game idea into a compact semantic JSON intent.
You must reply with ONLY a valid JSON object matching this schema:
${JSON.stringify(GAME_INTENT_SCHEMA, null, 2)}
Do not include markdown blocks, prose, or anything other than the JSON object.`;

function getProviders() {
  const p = [];
  if (process.env.GROQ_API_KEY) {
    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    p.push({
      id: 'groq',
      name: `Groq (${model.split('/').pop()})`,
      model,
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    p.push({
      id: 'openrouter',
      name: `OpenRouter (${process.env.OPENROUTER_MODEL || 'openrouter/free'})`,
      model: process.env.OPENROUTER_MODEL || 'openrouter/free',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://reverie.game',
        'X-Title': 'Reverie'
      }
    });
  }
  if (process.env.GEMINI_API_KEY) {
    p.push({
      id: 'gemini',
      name: `Gemini (${process.env.GEMINI_MODEL || 'gemini-1.5-flash'})`,
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      headers: { 'Authorization': `Bearer ${process.env.GEMINI_API_KEY}` }
    });
  }
  if (process.env.LOCAL_AI_URL) {
    p.push({
      id: 'local',
      name: `Local (${process.env.LOCAL_MODEL || 'local-model'})`,
      model: process.env.LOCAL_MODEL || 'local-model',
      url: process.env.LOCAL_AI_URL,
      headers: process.env.LOCAL_AI_KEY ? { 'Authorization': `Bearer ${process.env.LOCAL_AI_KEY}` } : {}
    });
  }
  return p;
}

export function hasCredentials() {
  return getProviders().length > 0;
}

export const MODEL = getProviders()[0]?.name || 'offline';

export async function generateWithAI({ prompt, baseSpec = null, onEvent = () => {}, signal } = {}) {
  const providers = getProviders();
  if (providers.length === 0) throw new Error('No AI providers configured.');

  let lastErr = null;
  for (const provider of providers) {
    try {
      onEvent('status', { message: `Designing with ${provider.name}…` });
      
      const userContent = baseSpec 
        ? `Current game title: ${baseSpec.title}\nChange requested: ${prompt}`
        : `Design a game for this idea:\n\n${prompt}`;

      const body = {
        model: provider.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 2000,
        stream: true
      };

      const res = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...provider.headers },
        body: JSON.stringify(body),
        signal: signal || AbortSignal.timeout(30000)
      });

      if (!res.ok) {
        const txt = await res.text().catch(()=>'');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }

      let fullText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      
      let chars = 0;
      let lastProgress = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim() && l.startsWith('data: '));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || '';
            fullText += content;
            chars += content.length;
            if (chars - lastProgress > 50) {
              lastProgress = chars;
              onEvent('progress', { chars });
            }
          } catch (e) {
            // ignore JSON parse error on incomplete chunks
          }
        }
      }

      onEvent('status', { message: `Compiling game spec…` });
      let intent;
      try {
        const start = fullText.indexOf('{');
        const end = fullText.lastIndexOf('}');
        intent = JSON.parse(fullText.slice(start, end + 1));
      } catch (e) {
        throw new Error('AI returned invalid JSON');
      }

      const spec = compileIntentToSpec(intent);
      return { spec, warnings: [], usage: { output_tokens: chars }, model: provider.name };

    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn(`[AI Router] ${provider.id} failed:`, err.message);
      lastErr = err;
      // loop continues to next provider
    }
  }
  
  throw new Error(`All AI providers failed. Last error: ${lastErr?.message}`);
}
