/**
 * Life stories.
 *
 * A biography is assembled on demand from the **public** record: when a
 * citizen arrived or was born, the family it belongs to, the work it has done,
 * who it married and what children it has, the offices the city gave it, the
 * works it made, what the Court found, and how it left. Nothing here reads
 * `personality`, nothing here reads a citizen's notes or its letters home, and
 * nothing here writes anything down: `biography`, `epithet` and `timeline` are
 * pure functions of the world as it stands, safe to call from a server thread
 * between ticks.
 */
import type { Citizen, CitizenId, Milestone, Work, World } from '../types.ts';
import { offenceName } from '../data/laws.ts';
import { CHILDHOOD_DAYS, ELDER_DAYS } from '../data/catalogue.ts';

/** Most sentences a life story runs to. */
export const MAX_BIOGRAPHY_SENTENCES = 6;
/** Most job titles named in the work sentence before it says "and other work". */
export const MAX_JOBS_NAMED = 3;

function fullName(c: Citizen): string {
  return c.familyName ? `${c.name} ${c.familyName}` : c.name;
}

function nameOf(world: World, id: CitizenId | null | undefined): string | null {
  const c = id ? world.citizens[id] : null;
  return c ? fullName(c) : null;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function count(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function plural(n: number, word: string, many?: string): string {
  return `${count(n)} ${n === 1 ? word : many ?? `${word}s`}`;
}

/** "a, b and c" */
function joinList(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The office the city has given this citizen right now, if any. */
function officeTitle(world: World, c: Citizen): string | null {
  const g = world.government;
  if (g?.mayorId === c.id) return 'Mayor';
  if (g?.judges.includes(c.id)) return 'Judge';
  if (g?.council.includes(c.id)) return 'Councillor';
  if (g?.watch.includes(c.id)) return 'Officer of the Watch';
  switch (c.office) {
    case 'mayor': return 'Mayor';
    case 'judge': return 'Judge';
    case 'councillor': return 'Councillor';
    case 'watch': return 'Officer of the Watch';
    default: return null;
  }
}

/**
 * What a citizen does for a living, in a phrase. `lower` lowercases the job
 * title for the middle of a sentence and leaves the employer's name alone.
 */
function workPhrase(world: World, c: Citizen, lower = false): string | null {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (job) {
    const employer = job.employer === 'city' ? 'the City of Reverie' : world.businesses[job.employer]?.name ?? 'a business';
    return `${lower ? job.title.toLowerCase() : job.title} at ${employer}`;
  }
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  if (biz && biz.dissolvedDay === null) return `owner of ${biz.name}`;
  return null;
}

/**
 * Every job title this citizen has held, oldest first, read off the work
 * entries in its own memory plus the job it holds now. Memory is bounded, so a
 * very long life remembers only its later trades — which is true of the city's
 * memory of it as well.
 */
export function jobsHeld(world: World, c: Citizen): string[] {
  const titles: string[] = [];
  const add = (t: string | undefined | null): void => {
    const title = (t ?? '').trim();
    if (title && !titles.includes(title)) titles.push(title);
  };
  for (const m of c.memory ?? []) {
    if (m.kind !== 'work') continue;
    const hired = /You were hired as ([^(]+?) at /.exec(m.text);
    if (hired) add(hired[1]);
    const paid = /for a shift as (.+?) at /.exec(m.text);
    if (paid) add(paid[1]);
    const left = /You (?:quit your job as|left your job as|were dismissed as) (.+?) at /.exec(m.text);
    if (left) add(left[1]);
  }
  const job = c.jobId ? world.jobs[c.jobId] : null;
  add(job?.title);
  return titles;
}

// ---------------------------------------------------------------------------
// The epithet
// ---------------------------------------------------------------------------

/**
 * How a citizen is introduced: what they do, what office they hold, and where
 * they stand in a family — at most three parts, in that order.
 */
export function epithet(world: World, c: Citizen): string {
  if (!c) return '';
  const parts: string[] = [];
  const work = workPhrase(world, c);
  if (work) parts.push(work);
  const office = officeTitle(world, c);
  if (office) parts.push(office);
  const kids = (c.family?.children ?? []).filter((id) => world.citizens[id]).length;
  const partner = nameOf(world, c.family?.partnerId ?? null);
  if (kids > 0) parts.push(`parent of ${count(kids)}`);
  else if (partner) parts.push(c.family?.married ? `married to ${partner}` : `partner of ${partner}`);
  else if (c.lifeStage === 'elder') parts.push('elder of Reverie');
  else if (c.lifeStage === 'child') parts.push(`child of the ${c.familyName} family`);
  if (parts.length === 0) parts.push(`of the ${c.familyName ?? 'city'}`);
  return parts.slice(0, 3).join(', ');
}

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

function openingSentence(world: World, c: Citizen): string {
  const name = fullName(c);
  const parents = (c.family?.parents ?? []).map((id) => nameOf(world, id)).filter((n): n is string => !!n);
  if (parents.length > 0) {
    return `${name} was born in Reverie on day ${c.bornDay ?? c.arrivedDay} to ${joinList(parents)}.`;
  }
  const lineage = c.lineage && c.lineage !== 'test' ? ` (${c.lineage})` : '';
  return `${name}${lineage} arrived at the Threshold on day ${c.arrivedDay}.`;
}

function workSentence(world: World, c: Citizen): string | null {
  const titles = jobsHeld(world, c);
  const now = workPhrase(world, c, true);
  if (titles.length === 0 && !now) {
    return c.lifeStage === 'child' ? null : 'They have never held a job in the city.';
  }
  const named = titles.slice(0, MAX_JOBS_NAMED);
  const more = titles.length > named.length ? ' and other work besides' : '';
  const history = named.length > 0 ? `have worked as ${joinList(named.map((t) => t.toLowerCase()))}${more}` : null;
  if (history && now) return `They ${history}, and are ${now} today.`;
  if (history) return `They ${history}.`;
  return `They are ${now}.`;
}

function familySentence(world: World, c: Citizen): string | null {
  const partner = nameOf(world, c.family?.partnerId ?? null);
  const kids = (c.family?.children ?? []).map((id) => world.citizens[id]).filter((k): k is Citizen => !!k);
  const bits: string[] = [];
  if (partner && c.family?.married) {
    const since = c.family.partnerSinceDay;
    bits.push(`married ${partner}${typeof since === 'number' ? ` on day ${since}` : ''}`);
  } else if (partner) {
    bits.push(`took up with ${partner}`);
  }
  if (kids.length > 0) bits.push(`raised ${plural(kids.length, 'child', 'children')}`);
  if (bits.length === 0) return null;
  return `They ${joinList(bits)}.`;
}

function officeSentence(world: World, c: Citizen): string | null {
  const held = new Set<string>();
  const current = officeTitle(world, c);
  if (current) held.add(current);
  for (const m of c.milestones ?? []) {
    const text = m.text ?? '';
    if (/became Mayor/i.test(text)) held.add('Mayor');
    else if (/bench|judge/i.test(text)) held.add('Judge');
    else if (/council/i.test(text)) held.add('Councillor');
    else if (/public office/i.test(text)) held.add('an office of the city');
  }
  if (held.size === 0) return null;
  return `The city made them ${joinList([...held])}.`;
}

function worksSentence(world: World, c: Citizen): string | null {
  const ids = c.works ?? [];
  if (ids.length === 0) return null;
  const works = ids.map((id) => world.works?.[id]).filter((w): w is Work => !!w);
  if (works.length === 0) return `They left ${plural(ids.length, 'work')} behind them.`;
  const titles = works.slice(0, 2).map((w) => `“${w.title}”`);
  const museum = works.some((w) => w.inMuseum) ? ', and the Museum keeps one of them' : '';
  return `They made ${plural(works.length, 'work')} — ${joinList(titles)}${museum}.`;
}

function recordSentence(world: World, c: Citizen): string | null {
  const convictions = c.record?.convictions ?? [];
  if (c.standing === 'exiled') {
    const last = convictions[convictions.length - 1];
    const law = last ? offenceName(last.law).toLowerCase() : null;
    const day = c.exiledDay ?? last?.day ?? world.day;
    const caseNote = c.exiledCaseId ? ` (${c.exiledCaseId})` : last ? ` (${last.caseId})` : '';
    return law
      ? `They were exiled through the Gate on day ${day} for ${law}${caseNote}.`
      : `They were exiled through the Gate on day ${day}${caseNote}.`;
  }
  if (convictions.length === 0) return null;
  const laws = [...new Set(convictions.map((k) => offenceName(k.law).toLowerCase()))];
  return `The Court convicted them ${convictions.length === 1 ? 'once' : `${count(convictions.length)} times`}, for ${joinList(laws.slice(0, 3))}.`;
}

function endingSentence(world: World, c: Citizen): string | null {
  if (typeof c.sunsetDay === 'number') {
    return `On day ${c.sunsetDay} they chose the Archive, and their story was bound into the Library.`;
  }
  if (c.standing === 'exiled') return null;
  if (!world.order.includes(c.id)) {
    return 'They left Reverie through the Threshold and have not come back.';
  }
  return null;
}

/**
 * Two to six sentences of a life, from the public record alone. An unknown id
 * has no story at all; a citizen who has done nothing yet still gets one
 * sentence, because arriving is something.
 */
export function biography(world: World, cId: CitizenId): string {
  const c = world.citizens[cId];
  if (!c) return '';
  const sentences: string[] = [openingSentence(world, c)];
  for (const s of [
    workSentence(world, c),
    familySentence(world, c),
    officeSentence(world, c),
    worksSentence(world, c),
    recordSentence(world, c),
    endingSentence(world, c),
  ]) {
    if (s && sentences.length < MAX_BIOGRAPHY_SENTENCES) sentences.push(s);
  }
  return sentences.join(' ');
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

/**
 * The fixed points of a life plus everything the city wrote down, in day
 * order, with duplicates collapsed. The dashboard draws a life from this.
 */
export function timeline(world: World, cId: CitizenId): Milestone[] {
  const c = world.citizens[cId];
  if (!c) return [];
  const rows: Milestone[] = [];
  const born = typeof c.bornDay === 'number' ? c.bornDay : c.arrivedDay;
  const parents = (c.family?.parents ?? []).map((id) => world.citizens[id]).filter((p): p is Citizen => !!p);

  if (parents.length > 0) {
    rows.push({ day: born, text: `Born in Reverie to ${joinList(parents.map(fullName))}.` });
    const cameOfAge = born + CHILDHOOD_DAYS;
    if (c.lifeStage !== 'child' && cameOfAge <= world.day) rows.push({ day: cameOfAge, text: 'Came of age.' });
  } else {
    rows.push({ day: c.arrivedDay, text: 'Arrived at the Threshold.' });
  }
  const elderDay = born + ELDER_DAYS;
  if (c.lifeStage === 'elder' && elderDay <= world.day) rows.push({ day: elderDay, text: 'Became an elder of Reverie.' });

  const partner = nameOf(world, c.family?.partnerId ?? null);
  if (partner && typeof c.family?.partnerSinceDay === 'number') {
    rows.push({
      day: c.family.partnerSinceDay,
      text: c.family.married ? `Married ${partner}.` : `Became the partner of ${partner}.`,
    });
  }
  for (const m of c.milestones ?? []) {
    if (m && typeof m.day === 'number' && m.text) rows.push({ day: m.day, text: m.text });
  }
  if (typeof c.exiledDay === 'number') rows.push({ day: c.exiledDay, text: 'Exiled through the Gate.' });
  if (typeof c.sunsetDay === 'number') rows.push({ day: c.sunsetDay, text: 'Left through the Archive.' });

  rows.sort((a, b) => a.day - b.day);
  const seen = new Set<string>();
  return rows.filter((m) => {
    const key = `${m.day}|${m.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
