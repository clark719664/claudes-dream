// Client side of the AI art director and game master. Both stream from the
// server (Claude) and fall back to the offline versions in
// shared/gamemaster.js when there is no server or no connection.

import { postStream } from './stream.js';
import { planNextLevel, gradeFromStats } from '../../shared/gamemaster.js';
import { normalizeSpec } from '../../shared/spec.js';

async function specStream(endpoint, body, onEvent, signal) {
  let result = null;
  await postStream(endpoint, body, (type, data) => {
    if (type === 'spec') result = data;
    else onEvent?.(type, data);
  }, { signal });
  if (!result) throw new Error('no spec in response');
  return result;
}

/** Design the next level from how this one went. Resolves to { spec, source, notes }. */
export async function designNextLevel({ spec, telemetry, endpoint = '/api/next-level', onEvent, signal }) {
  try {
    const r = await specStream(endpoint, { spec, telemetry }, onEvent, signal);
    return { spec: normalizeSpec(r.spec).spec, source: r.source, notes: r.notes ?? [] };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const r = planNextLevel(spec, telemetry);
    return { ...r, source: 'offline' };
  }
}

/**
 * Screenshot the game from a few viewpoints and ask the art director to
 * improve the look. Resolves to { spec, source, notes, images }.
 */
export async function artDirect({ engine, intent = '', endpoint = '/api/art-director', onEvent, signal }) {
  const { images, stats } = engine.captureViews();
  const spec = engine.spec;
  try {
    const r = await specStream(endpoint, { spec, images, intent, stats }, onEvent, signal);
    if (r.source === 'offline') return { ...gradeFromStats(spec, stats), source: 'offline', images };
    return { spec: normalizeSpec(r.spec).spec, source: r.source, notes: r.notes ?? [], images };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ...gradeFromStats(spec, stats), source: 'offline', images };
  }
}
