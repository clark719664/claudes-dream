// Claude as a living character.
//
// Each reply streams back to the game as it is written. The character's
// powers are Claude tools run by the SDK's tool runner: when Claude calls
// one, the (validated, clamped) action is sent to the game straight away, the
// game applies it (points, healing, a beacon, weather, time of day...), and
// Claude is told what happened so it can react in character.

import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { NPC_TOOLS, validateAction, describeAction, characterPrompt } from '../shared/npc.js';
import { MODEL } from './claude.js';

export const NPC_EFFORT = process.env.REVERIE_NPC_EFFORT || 'low';
const MAX_HISTORY = 16;

function historyMessages(history, message) {
  const turns = [];
  for (const h of (Array.isArray(history) ? history : []).slice(-MAX_HISTORY)) {
    const role = h?.role === 'assistant' ? 'assistant' : 'user';
    const text = String(h?.text ?? '').slice(0, 1200).trim();
    if (!text) continue;
    // merge consecutive turns from the same side; the API wants them alternating
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += `\n${text}`;
    else turns.push({ role, content: text });
  }
  while (turns.length && turns[0].role === 'assistant') turns.shift();
  if (turns.length && turns[turns.length - 1].role === 'user') turns[turns.length - 1].content += `\n${message}`;
  else turns.push({ role: 'user', content: message });
  return turns;
}

/**
 * Talk to a character. onEvent(type, data) receives 'text' deltas and
 * 'action' ({ name, input }) events. Resolves to { text, actions }.
 */
export async function talkToCharacter({ character, world, history = [], message, onEvent = () => {}, signal } = {}) {
  const client = new Anthropic();
  const actions = [];
  let text = '';
  const tools = character.powers.map((name) => ({
    ...betaTool({
      name,
      description: NPC_TOOLS[name].description,
      inputSchema: NPC_TOOLS[name].input_schema,
      run: async (input) => {
        // inputs stream eagerly, so validate them here before anything happens in the game
        const checked = validateAction(name, input);
        if (!checked.ok) throw new Error(`INVALID_INPUT: ${checked.error}`);
        if (actions.length >= 3) return 'You have already done enough for now.';
        actions.push({ name, input: checked.input });
        onEvent('action', { name, input: checked.input });
        return describeAction(name, checked.input);
      },
    }),
    eager_input_streaming: true,
  }));

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 2048,
    max_iterations: 4,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: NPC_EFFORT },
    system: characterPrompt(character, world),
    tools,
    messages: historyMessages(history, message),
    stream: true,
  }, { signal });

  for await (const stream of runner) {
    stream.on('text', (delta) => {
      text += delta;
      onEvent('text', { text: delta });
    });
    const reply = await stream.finalMessage();
    // never run tools from a turn that was cut off or refused
    if (reply.stop_reason === 'refusal' || reply.stop_reason === 'max_tokens') break;
    if (reply.content.some((b) => b.type === 'text') && text && !text.endsWith(' ')) {
      text += ' ';
      onEvent('text', { text: ' ' });
    }
  }
  return { text: text.trim(), actions };
}
