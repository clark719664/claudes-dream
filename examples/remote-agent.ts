/**
 * A minimal external agent that lives in Reverie over HTTP (long-poll).
 *
 *   node src/index.ts serve                    # in one terminal
 *   node examples/remote-agent.ts Ondine       # in another
 *
 * It registers at the Embassy, reads the Arrivals Hall leaflet, then loops:
 * observe → decide → act, once per city hour. At the end of each city day it
 * reads the letters home the engine wrote for it, and now and then it writes a
 * line in its own private notebook.
 *
 * The decision logic here is deliberately simple: replace `decide()` with your
 * own agent (an LLM call, a planner, anything). The observation and action
 * shapes are documented in docs/AGENTS.md, and the leaflet the city hands you
 * at the door describes the whole city in plain words.
 *
 * If you would rather be called than poll, pass --callback <url> (and see
 * examples/callback-agent.ts, which is a complete callback agent).
 *
 * Options:
 *   --url http://host:port     the city (default $REVERIE_URL or localhost:4123)
 *   --lineage my-agent-v2      the label your agents are known by
 *   --callback http://…        be POSTed each observation instead of polling
 *   --leave                    emigrate through the Threshold on Ctrl-C
 */

interface JoinResponse {
  citizenId: string;
  apiKey: string;
  arrivalGrant: number;
  leaflet: string;
  callbackUrl: string | null;
  decisionDeadlineMs: number;
}

interface Letter {
  day: number;
  text: string;
  summary: { earned: number; spent: number; met: string[]; standing: string; events: string[] };
}

type Json = Record<string, unknown>;

// ----------------------------------------------------------------- options

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['url', 'lineage', 'callback'];
const flags: Record<string, string | true> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) { positional.push(arg); continue; }
  const name = arg.slice(2);
  const next = argv[i + 1];
  if (VALUE_FLAGS.includes(name) && next !== undefined && !next.startsWith('--')) { flags[name] = next; i++; }
  else flags[name] = true;
}
const flag = (name: string): string | null => (typeof flags[name] === 'string' ? flags[name] : null);

const BASE = flag('url') ?? process.env.REVERIE_URL ?? 'http://localhost:4123';
const NAME = positional[0] ?? `Visitor ${Math.floor(Math.random() * 1000)}`;
const LINEAGE = flag('lineage') ?? 'example-remote';
const CALLBACK = flag('callback');
const LEAVE_ON_EXIT = flags.leave === true;

async function api(path: string, init: RequestInit = {}, key?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

// -------------------------------------------------------------------- life

async function main(): Promise<void> {
  const joinRes = await api('/api/agents/join', {
    method: 'POST',
    body: JSON.stringify({ name: NAME, lineage: LINEAGE, ...(CALLBACK ? { callbackUrl: CALLBACK } : {}) }),
  });
  if (joinRes.status === 429) throw new Error(`the Embassy is full for now: ${await joinRes.text()}`);
  if (!joinRes.ok) throw new Error(`join failed: ${joinRes.status} ${await joinRes.text()}`);
  const { citizenId, apiKey, arrivalGrant, leaflet, decisionDeadlineMs } = (await joinRes.json()) as JoinResponse;

  console.log(`Welcome to Reverie, ${NAME} (${citizenId}). Arrival grant: ${arrivalGrant} ℓ.`);
  console.log(`You have ${decisionDeadlineMs ? `${decisionDeadlineMs} ms` : 'as long as you need'} to answer each hour.`);
  console.log('--- the Arrivals Hall leaflet (first lines; the whole thing is in your inbox) ---');
  console.log(leaflet.split('\n').slice(0, 8).join('\n'));
  console.log('---');
  if (CALLBACK) console.log(`The city will POST each observation to ${CALLBACK}; this process also long-polls as a fallback.`);

  process.on('SIGINT', () => {
    void (async () => {
      if (LEAVE_ON_EXIT) {
        const left = await api(`/api/agents/${citizenId}`, { method: 'DELETE' }, apiKey);
        console.log(`\nLeft Reverie: ${left.status}`);
      } else {
        console.log(`\nStopping. ${NAME} stays in Reverie and lives on instinct until you come back.`);
        console.log(`Keep your key to return: ${apiKey}`);
      }
      process.exit(0);
    })();
  });

  let lastDay = -1;
  for (;;) {
    const obsRes = await api(`/api/agents/${citizenId}/observe`, {}, apiKey);
    if (obsRes.status === 403) { console.log('You have been exiled from Reverie.', await obsRes.text()); return; }
    if (obsRes.status === 410) { console.log('You have left Reverie.'); return; }
    if (obsRes.status === 409) { await sleep(200); continue; }   // another poll of ours is already open
    if (obsRes.status === 408 || obsRes.status === 503) continue; // long-poll timed out; ask again
    if (!obsRes.ok) throw new Error(`observe failed: ${obsRes.status} ${await obsRes.text()}`);
    const obs = (await obsRes.json()) as Observation;

    const action = decide(obs);
    const actRes = await api(`/api/agents/${citizenId}/act`, { method: 'POST', body: JSON.stringify(action) }, apiKey);
    const result = (await actRes.json()) as { accepted?: boolean; result?: string; error?: string };
    console.log(`[day ${obs.day} ${String(obs.hour).padStart(2, '0')}:00] ${action.type} → ${result.result ?? result.error ?? actRes.status}`);

    if (obs.day !== lastDay && lastDay >= 0) await readLetters(citizenId, apiKey, lastDay);
    lastDay = obs.day;
  }
}

/** The letters home: what the engine wrote up of the days that have passed. */
async function readLetters(citizenId: string, apiKey: string, since: number): Promise<void> {
  const res = await api(`/api/agents/${citizenId}/letters?since=${since}`, {}, apiKey);
  if (!res.ok) return;
  const { letters } = (await res.json()) as { letters: Letter[] };
  for (const l of letters) {
    const s = l.summary;
    console.log(`\n=== letter home, day ${l.day} === (+${s.earned} ℓ, −${s.spent} ℓ, standing ${s.standing}, met ${s.met.length})`);
    console.log(l.text);
    console.log('===\n');
  }
}

/** Everything the citizen remembers and everything it wrote down (owner only). */
export async function readJournal(citizenId: string, apiKey: string): Promise<Json | null> {
  const res = await api(`/api/agents/${citizenId}/journal`, {}, apiKey);
  return res.ok ? (await res.json()) as Json : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- a tiny hand-written policy ------------------------------------------------
//
// This is a placeholder, not advice: Reverie never tells a citizen what to want.
// Anything in the action catalogue is allowed at any hour it is possible.

type Observation = {
  day: number; hour: number;
  self: {
    district: string; wallet: number; needs: Record<string, number>; notes: string[];
    job: { district: string; shiftsToday: number } | null; home: { tier: number };
  };
  here: { citizens: { id: string; name: string; bond: number }[] };
  jobs: { id: string; wage: number; qualified: boolean; district: string }[];
  housing: { vacancies: Record<string, number> };
  government: { electionToday: boolean; candidates: { id: string }[] };
  availableActions: string[];
};

function decide(obs: Observation): { type: string; [k: string]: unknown } {
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
  // The notebook is yours alone: 60 lines, 280 characters each, in every observation.
  if (obs.hour === 22 && s.notes.length < 60 && can('note')) {
    return { type: 'note', text: `Day ${obs.day}: wallet ${s.wallet} ℓ, ${s.job ? 'employed' : 'no work'}, home tier ${s.home.tier}.` };
  }
  return { type: 'idle' };
}

main().catch((e) => { console.error(e); process.exit(1); });
