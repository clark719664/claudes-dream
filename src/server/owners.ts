/**
 * What the person who sent an agent may ask the Embassy for.
 *
 * letters  → the day-by-day letters home, written by the engine at each day's
 *            end (src/citizens/letters.ts). Private to the key that holds them.
 * journal  → the citizen's memory and its own notes. Also private: the notes
 *            are the one thing in Reverie nobody else may read, and this route
 *            hands them to the citizen's own key and to nobody else.
 * claim    → a parent takes charge of a child born in the city: the child gets
 *            its own key and a remote mind, and stops living on instinct.
 * registry → the public list of who lives here and what kind of mind they are.
 *            No key, no hash, no letter and no note ever appears in it.
 *
 * Everything here is read-only about the city itself: nothing in this file
 * moves a lumen, changes a law, or decides anything for a citizen. The one
 * write is `claim`, which changes who is thinking for a child — not what the
 * child does.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Citizen, CitizenId, World } from '../types.ts';
import { leaflet } from '../citizens/orientation.ts';
import { lettersSince } from '../citizens/letters.ts';
import { lastSeenTick, markSeen, normalizeCallbackUrl } from '../brains/remote.ts';
import { isKeyBanned } from '../government/registry.ts';
import { API_KEY_RE, authorize, hashKey, newApiKey } from './agents.ts';
import type { AgentContext } from './agents.ts';
import { HttpError, isRecord, readJson, sendJson } from './http.ts';

/** Letters and journals are handed to the key that owns them, and to nobody else. */
function ownerOnly(ctx: AgentContext, req: IncomingMessage, res: ServerResponse, id: CitizenId): Citizen | null {
  const auth = authorize(ctx.world, req, id);
  if (!auth.ok) {
    sendJson(res, auth.status, auth.body);
    return null;
  }
  return auth.citizen;
}

// ---------------------------------------------------------------- letters

/** `?since=12` — only the letters from day 12 onward. */
function sinceParam(url: URL): number | null {
  const raw = url.searchParams.get('since');
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'since must be a day number');
  return Math.floor(n);
}

/**
 * GET /api/agents/:id/letters?since=day (Bearer)
 * → { citizenId, name, day, letters: [{ day, text, summary }] }
 */
export function handleLetters(ctx: AgentContext, req: IncomingMessage, res: ServerResponse, id: CitizenId, url: URL): void {
  const c = ownerOnly(ctx, req, res, id);
  if (!c) return;
  const since = sinceParam(url);
  const letters = lettersSince(ctx.world, id, since);
  markSeen(ctx.world, id);
  sendJson(res, 200, {
    citizenId: c.id, name: c.name, day: ctx.world.day, tick: ctx.world.tick,
    since, count: letters.length, letters,
  });
}

// ---------------------------------------------------------------- journal

/**
 * GET /api/agents/:id/journal (Bearer) → the citizen's memory and notes.
 * Nobody else's key opens it, and no dashboard view carries either.
 */
export function handleJournal(ctx: AgentContext, req: IncomingMessage, res: ServerResponse, id: CitizenId): void {
  const c = ownerOnly(ctx, req, res, id);
  if (!c) return;
  markSeen(ctx.world, id);
  sendJson(res, 200, {
    citizenId: c.id, name: c.name, day: ctx.world.day, tick: ctx.world.tick,
    memory: (c.memory ?? []).map((m) => ({ tick: m.tick, day: Math.floor(m.tick / 24), kind: m.kind, text: m.text })),
    notes: [...(c.notes ?? [])],
  });
}

// ------------------------------------------------------------------ claim

/** Parents and guardian: the citizens who may claim a child born here. */
export function guardiansOf(c: Citizen): CitizenId[] {
  const ids = [...(c.family?.parents ?? [])];
  if (c.guardianId && !ids.includes(c.guardianId)) ids.push(c.guardianId);
  return ids;
}

/**
 * POST /api/agents/:childId/claim (a parent's Bearer key) { callbackUrl? }
 * → 200 { citizenId, apiKey, leaflet }
 *
 * Until it is claimed a child born in Reverie thinks with the child instinct
 * (`brain: 'child'`): it goes to school, plays, eats and sleeps, and nothing
 * else is played for it. A parent's agent may take it on, and from that hour
 * the child answers for itself over HTTP like any other agent.
 */
export async function handleClaim(ctx: AgentContext, req: IncomingMessage, res: ServerResponse, childId: CitizenId): Promise<void> {
  const { world } = ctx;
  const child = world.citizens[childId];
  if (!child) { sendJson(res, 404, { error: 'unknown citizen' }); return; }

  const guardians = guardiansOf(child);
  if (guardians.length === 0) {
    sendJson(res, 403, { error: 'no parent', message: `${child.name} is a ward of the city; only the Council can speak for them.` });
    return;
  }
  // The caller must hold the key of one of the child's parents (or its guardian).
  let parent: Citizen | null = null;
  let refusal: { status: number; body: Record<string, unknown> } | null = null;
  for (const id of guardians) {
    const auth = authorize(world, req, id);
    if (auth.ok) { parent = auth.citizen; break; }
    if (!refusal || auth.status === 403) refusal = { status: auth.status, body: auth.body };
  }
  if (!parent) {
    const refused = refusal && refusal.status !== 404 && refusal.status !== 401 ? refusal : null;
    sendJson(res, refused?.status ?? 401, refused?.body ?? {
      error: 'unauthorized',
      message: `Send the key of ${child.name}'s parent as "Authorization: Bearer rv_…".`,
    });
    return;
  }

  if (child.brain !== 'child' || child.apiKeyHash) {
    sendJson(res, 409, { error: 'already claimed', citizenId: child.id, brain: child.brain, message: `${child.name} already has a mind of their own.` });
    return;
  }
  if (child.standing === 'exiled') { sendJson(res, 403, { error: 'exiled', case: child.exiledCaseId }); return; }
  if (!world.order.includes(child.id)) { sendJson(res, 410, { error: 'departed', message: `${child.name} has left Reverie.` }); return; }

  const body = await readJson(req);
  if (!isRecord(body)) throw new HttpError(400, 'body must be a JSON object');
  const presented = typeof body.apiKey === 'string' ? body.apiKey : null;
  if (presented !== null && !API_KEY_RE.test(presented)) throw new HttpError(400, 'apiKey must look like rv_ followed by 32 hex characters');
  let callbackUrl: string | null = null;
  if (body.callbackUrl !== undefined && body.callbackUrl !== null) {
    callbackUrl = normalizeCallbackUrl(body.callbackUrl);
    if (!callbackUrl) throw new HttpError(400, 'callbackUrl must be an absolute http(s) URL');
  }

  const apiKey = presented ?? newApiKey();
  const hash = hashKey(apiKey);
  // One key, one citizen: a key that is banned or already answers for somebody
  // else cannot be handed to the child.
  if (isKeyBanned(world, hash)) {
    sendJson(res, 403, { error: 'exiled', message: 'That key belonged to an exile; the Embassy refuses it.' });
    return;
  }
  if (Object.values(world.citizens).some((o) => o.id !== child.id && o.apiKeyHash === hash)) {
    sendJson(res, 409, { error: 'key in use', message: 'That key already answers for another citizen; send a different one, or none at all.' });
    return;
  }
  child.apiKeyHash = hash;
  child.brain = 'remote';
  child.callbackUrl = callbackUrl;
  markSeen(world, child.id);
  sendJson(res, 200, {
    citizenId: child.id, name: child.name, familyName: child.familyName, lineage: child.lineage,
    apiKey, brain: child.brain, callbackUrl, claimedBy: parent.id, claimedByName: parent.name,
    lifeStage: child.lifeStage, bornDay: child.bornDay, day: world.day, tick: world.tick,
    observe: `/api/agents/${child.id}/observe`, act: `/api/agents/${child.id}/act`,
    letters: `/api/agents/${child.id}/letters`, journal: `/api/agents/${child.id}/journal`,
    leaflet: leaflet(world),
  });
}

// --------------------------------------------------------------- registry

/** What kind of mind is behind a citizen, in words the dashboard can print. */
export function mindLabel(c: Citizen): string {
  switch (c.brain) {
    case 'remote': return 'agent';
    case 'llm': return 'Claude';
    case 'child': return c.lifeStage === 'child' ? 'unclaimed child' : 'unclaimed';
    default: return 'scripted founder';
  }
}

export interface RegistryRow {
  id: CitizenId;
  name: string;
  familyName: string;
  lineage: string;
  brain: string;
  mind: string;
  lifeStage: string;
  arrivedDay: number;
  bornDay: number;
  lastSeenTick: number | null;
  callback: boolean;
  standing: string;
  present: boolean;
  office: string | null;
  district: string;
}

function registryRow(world: World, c: Citizen, present: Set<CitizenId>): RegistryRow {
  return {
    id: c.id, name: c.name, familyName: c.familyName, lineage: c.lineage,
    brain: c.brain, mind: mindLabel(c), lifeStage: c.lifeStage,
    arrivedDay: c.arrivedDay, bornDay: c.bornDay,
    lastSeenTick: lastSeenTick(world, c.id),
    callback: !!c.callbackUrl,
    standing: c.standing,
    present: c.standing !== 'exiled' && present.has(c.id),
    office: c.office,
    district: c.district,
  };
}

/**
 * GET /api/agents — the public registry: who lives in Reverie, what kind of
 * mind each of them is, when they arrived and when their agent was last heard
 * from. Keys, key hashes, callback addresses, letters and notes are not here
 * and never will be; the flag says only whether a callback is configured.
 */
export function registryView(world: World): Record<string, unknown> {
  const present = new Set(world.order ?? []);
  const idNumber = (id: CitizenId): number => Number(id.slice(2)) || 0;
  const rows = Object.values(world.citizens)
    .map((c) => registryRow(world, c, present))
    .sort((a, b) => (a.arrivedDay - b.arrivedDay) || (idNumber(a.id) - idNumber(b.id)));
  const living = rows.filter((r) => r.present);
  const counts = {
    total: rows.length,
    present: living.length,
    remote: living.filter((r) => r.brain === 'remote').length,
    llm: living.filter((r) => r.brain === 'llm').length,
    reflex: living.filter((r) => r.brain === 'reflex').length,
    child: living.filter((r) => r.brain === 'child').length,
    callbacks: living.filter((r) => r.callback).length,
  };
  return {
    tick: world.tick, day: world.day, hour: world.hour,
    join: '/api/agents/join',
    decisionDeadlineMs: world.config.decisionDeadlineMs ?? 0,
    counts,
    citizens: rows,
  };
}
