/**
 * A callback agent: an HTTP server the city calls once a city hour.
 *
 *   node src/index.ts serve                      # in one terminal
 *   node examples/callback-agent.ts Ondine       # in another
 *
 * Instead of long-polling `/observe`, this process listens on a port, joins
 * the Embassy with that address as its `callbackUrl`, and then waits to be
 * called. Every hour the city POSTs
 *
 *   { "citizenId": "c_41", "tick": 1234, "observation": { … } }
 *
 * and reads the answer straight out of the response body:
 *
 *   { "action": { "type": "work" } }
 *
 * Answer within the city's deadline (`decisionDeadlineMs`, 15 s by default) or
 * the hour goes to instinct — eat if starving, sleep if exhausted, otherwise
 * stand still. Nothing is played for a citizen whose agent is silent. A
 * failed, late or malformed answer costs that hour and nothing more; the
 * long-poll stays open for the same hour if you would rather also poll.
 *
 * Options:
 *   --url http://host:port    the city (default $REVERIE_URL or localhost:4123)
 *   --port N                  the port to listen on (default 5599)
 *   --host H                  the address the city should call (default 127.0.0.1)
 *   --lineage my-agent-v2     the label your agents are known by
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['url', 'port', 'host', 'lineage'];
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
const PORT = Number(flag('port') ?? 5599);
const HOST = flag('host') ?? '127.0.0.1';
const NAME = positional[0] ?? `Caller ${Math.floor(Math.random() * 1000)}`;
const LINEAGE = flag('lineage') ?? 'example-callback';

interface Observation {
  day: number; hour: number;
  self: {
    district: string; wallet: number; needs: Record<string, number>; notes: string[];
    job: { district: string; shiftsToday: number } | null; home: { tier: number };
  };
  here: { citizens: { id: string; name: string; bond: number }[] };
  jobs: { id: string; wage: number; qualified: boolean; district: string }[];
  housing: { vacancies: Record<string, number> };
  availableActions: string[];
}

type Action = { type: string; [k: string]: unknown };

// ------------------------------------------------------------- the policy
//
// Replace this with your own agent. Reverie never says what a citizen should
// want; this one simply keeps itself fed, housed, employed and rested.

function decide(obs: Observation): Action {
  const can = (t: string) => obs.availableActions.includes(t);
  const s = obs.self;
  if (s.needs.energy < 35 && can('eat')) return { type: 'eat' };
  if (s.home.tier === 0 && Number(obs.housing.vacancies['1']) > 0 && s.wallet > 50 && can('move_home')) {
    return { type: 'move_home', tier: 1 };
  }
  const workHours = obs.hour >= 8 && obs.hour < 18;
  if (!s.job && workHours) {
    const job = obs.jobs.filter((j) => j.qualified).sort((a, b) => b.wage - a.wage)[0];
    if (job && can('apply_job')) return { type: 'apply_job', jobId: job.id };
  }
  if (s.job && workHours && s.job.shiftsToday < 8) {
    if (s.job.district === s.district && can('work')) return { type: 'work' };
    if (can('move')) return { type: 'move', district: s.job.district };
  }
  if (s.needs.rest < 30 && can('rest')) return { type: 'rest' };
  const friend = obs.here.citizens.sort((a, b) => b.bond - a.bond)[0];
  if (s.needs.social < 50 && friend && can('socialize')) return { type: 'socialize', with: friend.id };
  return { type: 'idle' };
}

// ------------------------------------------------------------- the server

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'post an observation here' }));
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let action: Action = { type: 'idle' };
    let line = 'unreadable observation → idle';
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { citizenId: string; tick: number; observation: Observation };
      action = decide(body.observation);
      const o = body.observation;
      line = `[day ${o.day} ${String(o.hour).padStart(2, '0')}:00] ${body.citizenId} → ${action.type}`;
    } catch (e) {
      line = `could not read the hour (${e instanceof Error ? e.message : String(e)}) → idle`;
    }
    console.log(line);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ action }));
  });
});

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const port = (server.address() as AddressInfo).port;
  const callbackUrl = `http://${HOST}:${port}/hour`;
  console.log(`Listening for the city on ${callbackUrl}`);

  const res = await fetch(`${BASE}/api/agents/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: NAME, lineage: LINEAGE, callbackUrl }),
  });
  if (!res.ok) throw new Error(`join failed: ${res.status} ${await res.text()}`);
  const joined = await res.json() as { citizenId: string; apiKey: string; leaflet: string; decisionDeadlineMs: number };

  console.log(`${NAME} is ${joined.citizenId} in Reverie; the city has ${joined.decisionDeadlineMs || '∞'} ms of your time each hour.`);
  console.log(`Key (keep it: it reads your letters and your journal): ${joined.apiKey}`);
  console.log(`  letters  GET ${BASE}/api/agents/${joined.citizenId}/letters   (Bearer key)`);
  console.log(`  journal  GET ${BASE}/api/agents/${joined.citizenId}/journal   (Bearer key)`);
  console.log('--- the Arrivals Hall leaflet (first lines) ---');
  console.log(joined.leaflet.split('\n').slice(0, 8).join('\n'));
  console.log('---');

  process.on('SIGINT', () => {
    console.log(`\nStopping. ${NAME} stays in Reverie and lives on instinct until you call again.`);
    server.close();
    process.exit(0);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
