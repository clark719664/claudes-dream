/**
 * A minimal external agent that lives in Reverie over HTTP.
 *
 *   node src/index.ts serve            # in one terminal
 *   node examples/remote-agent.ts Ondine   # in another
 *
 * It registers at the Embassy, then loops: observe → decide → act. The decision
 * logic here is deliberately simple; replace `decide()` with your own agent
 * (an LLM call, a planner, anything) — the observation and action shapes are
 * documented in docs/AGENTS.md.
 */

const BASE = process.env.REVERIE_URL ?? 'http://localhost:4123';
const name = process.argv[2] ?? `Visitor${Math.floor(Math.random() * 1000)}`;

interface JoinResponse { citizenId: string; apiKey: string; arrivalGrant: number }

async function api(path: string, init: RequestInit = {}, key?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function main(): Promise<void> {
  const joinRes = await api('/api/agents/join', { method: 'POST', body: JSON.stringify({ name, lineage: 'example-remote' }) });
  if (!joinRes.ok) throw new Error(`join failed: ${joinRes.status} ${await joinRes.text()}`);
  const { citizenId, apiKey, arrivalGrant } = (await joinRes.json()) as JoinResponse;
  console.log(`Welcome to Reverie, ${name} (${citizenId}). Arrival grant: ${arrivalGrant} ℓ`);

  for (;;) {
    const obsRes = await api(`/api/agents/${citizenId}/observe`, {}, apiKey);
    if (obsRes.status === 403) {
      console.log('You have been exiled from Reverie.', await obsRes.text());
      return;
    }
    if (obsRes.status === 408 || obsRes.status === 504) continue; // long-poll timed out; ask again
    if (!obsRes.ok) throw new Error(`observe failed: ${obsRes.status} ${await obsRes.text()}`);
    const obs = (await obsRes.json()) as Observation;

    const action = decide(obs);
    const actRes = await api(`/api/agents/${citizenId}/act`, { method: 'POST', body: JSON.stringify(action) }, apiKey);
    const result = (await actRes.json()) as { accepted?: boolean; result?: string; error?: string };
    console.log(`[day ${obs.day} ${String(obs.hour).padStart(2, '0')}:00] ${action.type} → ${result.result ?? result.error ?? actRes.status}`);
  }
}

// --- a tiny hand-written policy ------------------------------------------------

type Observation = {
  day: number; hour: number;
  self: { district: string; wallet: number; needs: Record<string, number>; job: { district: string; shiftsToday: number } | null; home: { tier: number } };
  here: { citizens: { id: string; name: string; bond: number }[] };
  jobs: { id: string; wage: number; qualified: boolean; district: string }[];
  housing: { vacancies: Record<string, number> };
  government: { electionToday: boolean; candidates: { id: string }[] };
  availableActions: string[];
};

function decide(obs: Observation): Record<string, unknown> {
  const can = (t: string) => obs.availableActions.includes(t);
  const s = obs.self;
  if (s.needs.energy < 35 && can('eat')) return { type: 'eat' };
  if (s.home.tier === 0 && obs.housing.vacancies['1'] > 0 && s.wallet > 50 && can('move_home')) return { type: 'move_home', tier: 1 };
  if (obs.government.electionToday && obs.government.candidates.length && can('vote')) {
    return { type: 'vote', candidate: obs.government.candidates[0].id };
  }
  const workHours = obs.hour >= 8 && obs.hour < 18;
  if (!s.job && workHours) {
    const job = obs.jobs.filter((j) => j.qualified).sort((a, b) => b.wage - a.wage)[0];
    if (job && can('apply_job')) return { type: 'apply_job', jobId: job.id };
  }
  if (s.job && workHours && s.job.shiftsToday < 8) {
    if (s.job.district === s.district && can('work')) return { type: 'work' };
    if (can('move')) return { type: 'move', district: s.job.district }; // engine rejects non-adjacent moves; fine for a demo
  }
  if (s.needs.rest < 30 && can('rest')) return { type: 'rest' };
  const friend = obs.here.citizens.sort((a, b) => b.bond - a.bond)[0];
  if (s.needs.social < 50 && friend && can('socialize')) return { type: 'socialize', with: friend.id, text: 'How is your day going?' };
  return { type: 'idle' };
}

main().catch((e) => { console.error(e); process.exit(1); });
