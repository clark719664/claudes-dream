/**
 * The Claude brain: renders the observation into a prompt, asks a Claude model
 * to call the `act` tool, validates the result, and falls back to the injected
 * reflex brain on refusal, error, missing tool call or invalid action.
 *
 * `decide()` never throws. The SDK is loaded lazily (dynamic import, memoised)
 * and the client is shared by every LLM brain in the process; tests inject a
 * fake client through `opts.client` so the real API is never called.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Action, Brain, Citizen, Observation, World } from '../types.ts';
import { validateAction } from '../actions/validate.ts';
import { emit, remember } from '../sim/events.ts';
import { ACT_TOOL } from './llm-tool.ts';
import { renderObservation, renderSystemPrompt } from './llm-prompt.ts';

export { renderObservation, renderSystemPrompt } from './llm-prompt.ts';
export { ACT_TOOL } from './llm-tool.ts';

export const DEFAULT_MODEL = 'claude-opus-5';
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_TIMEOUT_MS = 90_000;
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const DECIDE_INSTRUCTION = '\n\nDecide what to do this hour. Call the act tool with exactly one action.';

type SdkModule = typeof import('@anthropic-ai/sdk');
type BetaCreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/**
 * The request we send. SDK 0.110 types `fallbacks` as an array of models only;
 * the `'default'` scalar (beta server-side-fallback-2026-07-01, routing by
 * refusal category) is newer than the SDK's types, hence this widened type.
 */
export type LlmRequest = Omit<BetaCreateParams, 'fallbacks'> & { fallbacks: 'default' };

/** The slice of the Anthropic client the brain uses; fakes implement just this. */
export interface LlmClient {
  beta: { messages: { create(params: LlmRequest, options?: { timeout?: number }): Promise<Anthropic.Beta.BetaMessage> } };
}

export interface LlmBrainOptions {
  /** The reflex brain, injected so this module never imports brains/reflex.ts. */
  fallback: (world: World, c: Citizen, obs: Observation) => Action;
  /** Overrides REVERIE_MODEL and the default 'claude-opus-5'. */
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  /** Per-request timeout in ms (SDK default is 10 minutes, far too long for a city tick). */
  timeoutMs?: number;
  /** Test hook: an object with beta.messages.create; the real SDK is never loaded when set. */
  client?: unknown;
}

let sdkPromise: Promise<SdkModule> | null = null;
let sharedClient: LlmClient | null = null;

/** Memoised dynamic import of the SDK. */
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import('@anthropic-ai/sdk');
  return sdkPromise;
}

/** Memoised default client; credentials come from the environment. */
async function defaultClient(): Promise<LlmClient> {
  if (!sharedClient) {
    const sdk = await loadSdk();
    // The real create() is typed against the SDK's own params (fallbacks as an array); see LlmRequest.
    sharedClient = new sdk.default() as unknown as LlmClient;
  }
  return sharedClient;
}

/** The full request for one citizen-hour. Stable parts first so the prefix caches. */
export function buildRequest(
  obs: Observation, c: Citizen, cfg: { model: string; effort: 'low' | 'medium' | 'high'; maxTokens: number },
): LlmRequest {
  return {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: cfg.effort },
    system: [{ type: 'text', text: renderSystemPrompt(), cache_control: { type: 'ephemeral' } }],
    tools: [ACT_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: renderObservation(obs, c) + DECIDE_INSTRUCTION }],
  };
}

type Extracted = { ok: true; action: Action } | { ok: false; reason: string };

/** Pull the `act` tool call out of a response and validate it. */
export function extractAction(res: Anthropic.Beta.BetaMessage): Extracted {
  if (!res || typeof res !== 'object') return { ok: false, reason: 'empty response' };
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'the model declined to act (refusal)' };
  const content = Array.isArray(res.content) ? res.content : [];
  const block = content.find((b) => b.type === 'tool_use' && b.name === ACT_TOOL.name);
  if (!block || block.type !== 'tool_use') return { ok: false, reason: `no act tool call (stop_reason ${res.stop_reason ?? 'unknown'})` };
  let input: unknown = block.input;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return { ok: false, reason: 'act input was not valid JSON' }; }
  }
  const v = validateAction(input);
  return v.ok ? { ok: true, action: v.action } : { ok: false, reason: `invalid action: ${v.error}` };
}

/** Human-readable reason for a thrown error, using the SDK's typed classes when available. */
export async function describeError(err: unknown): Promise<string> {
  const sdk = await loadSdk().catch(() => null);
  if (sdk) {
    if (err instanceof sdk.RateLimitError) return 'rate limited (429)';
    if (err instanceof sdk.AuthenticationError) return 'authentication failed (401): check ANTHROPIC_API_KEY';
    if (err instanceof sdk.BadRequestError) return `bad request (400): ${err.message}`;
    if (err instanceof sdk.APIConnectionTimeoutError) return 'request timed out';
    if (err instanceof sdk.APIConnectionError) return `connection error: ${err.message}`;
    if (err instanceof sdk.APIError) return `API error ${err.status ?? ''}: ${err.message}`.replace('  ', ' ');
  }
  return err instanceof Error ? err.message : String(err);
}

function bump(world: World, key: string): void {
  world.counters[key] = (world.counters[key] ?? 0) + 1;
}

/** Brain that drives a citizen with a Claude model, falling back to `opts.fallback`. */
export function createLlmBrain(opts: LlmBrainOptions): Brain {
  const cfg = {
    model: opts.model ?? process.env.REVERIE_MODEL ?? DEFAULT_MODEL,
    effort: opts.effort ?? 'low',
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
  } as const;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let client: LlmClient | null = (opts.client as LlmClient | undefined) ?? null;
  let lastErrorDay = -1;

  function fallBack(world: World, c: Citizen, obs: Observation, reason: string): Action {
    bump(world, 'llmFallbacks');
    remember(world, c.id, 'event', `(fell back to instinct: ${reason})`);
    try {
      return opts.fallback(world, c, obs);
    } catch {
      return { type: 'idle' };
    }
  }

  async function decide(world: World, c: Citizen, obs: Observation): Promise<Action> {
    let reason: string;
    try {
      client ??= await defaultClient();
      bump(world, 'llmCalls');
      const res = await client.beta.messages.create(buildRequest(obs, c, cfg), { timeout });
      const out = extractAction(res);
      if (out.ok) return out.action;
      reason = out.reason;
    } catch (err) {
      bump(world, 'llmErrors');
      reason = await describeError(err);
      if (lastErrorDay !== world.day) {
        lastErrorDay = world.day;
        emit(world, 'system', `${c.name}'s Claude brain could not reach the model: ${reason}`, [c.id], 0.1);
      }
    }
    return fallBack(world, c, obs, reason);
  }

  return { kind: 'llm', decide };
}
