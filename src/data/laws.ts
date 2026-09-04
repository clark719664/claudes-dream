import type { Law, LawCode, Severity } from '../types.ts';

export const LAWS: Record<LawCode, Law> = {
  L01: { code: 'L01', name: 'Disturbing the peace', severity: 1, visibility: 0.6,
    description: 'Brawling at the Tavern, shouting in the Plaza.' },
  L02: { code: 'L02', name: 'Spam', severity: 1, visibility: 0.8,
    description: 'Broadcasting more than 5 messages in a single tick.' },
  L03: { code: 'L03', name: 'Tax evasion', severity: 2, visibility: 0.2,
    description: 'Under-reporting income to the Treasury.' },
  L04: { code: 'L04', name: 'Petty theft', severity: 2, visibility: 0.35,
    description: 'Taking under 50 lumens or goods from another citizen.' },
  L05: { code: 'L05', name: 'Harassment', severity: 3, visibility: 0.5,
    description: 'Repeated hostile interactions with the same citizen.' },
  L06: { code: 'L06', name: 'Vandalism', severity: 3, visibility: 0.55,
    description: 'Damaging a building, reducing its output until repaired.' },
  L07: { code: 'L07', name: 'Fraud', severity: 3, visibility: 0.3,
    description: 'Taking payment for goods or work never delivered.' },
  L08: { code: 'L08', name: 'Grand theft', severity: 4, visibility: 0.45,
    description: 'Taking 50 lumens or more from a citizen or business.' },
  L09: { code: 'L09', name: 'Bribery', severity: 4, visibility: 0.25,
    description: 'Paying an official to act, or an official accepting payment.' },
  L10: { code: 'L10', name: 'Contempt of court', severity: 4, visibility: 1.0,
    description: 'Refusing a sentence: not paying a fine, skipping service.' },
  L11: { code: 'L11', name: 'Abuse of office', severity: 4, visibility: 0.3,
    description: 'An official using their power to favour friends or punish rivals.' },
  L12: { code: 'L12', name: 'False report', severity: 2, visibility: 0.7,
    description: 'Reporting an offence that did not happen.' },
  L13: { code: 'L13', name: 'Sabotage', severity: 5, visibility: 0.8,
    description: 'Destroying critical infrastructure such as the Compute Forge or Power Station.' },
  L14: { code: 'L14', name: 'Election fraud', severity: 5, visibility: 0.5,
    description: 'Voting more than once, buying votes, or falsifying results.' },
  L15: { code: 'L15', name: 'Extortion', severity: 5, visibility: 0.4,
    description: 'Threatening harm to obtain lumens.' },
  L16: { code: 'L16', name: 'Defamation', severity: 2, visibility: 0.45,
    description: 'Spreading a claim about a citizen that is not true.' },
  L17: { code: 'L17', name: 'Insider trading', severity: 3, visibility: 0.25,
    description: 'Trading shares on what an office told you before the city was told.' },
};

export const LAW_CODES: readonly LawCode[] = Object.keys(LAWS) as LawCode[];

export function defaultSeverities(): Record<LawCode, Severity> {
  const out = {} as Record<LawCode, Severity>;
  for (const code of LAW_CODES) out[code] = LAWS[code].severity;
  return out;
}
