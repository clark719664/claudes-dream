import * as storage from '../core/storage';
import { SETS, STICKERS, STICKERS_BY_ID, basePerks, stickersInSet, type Perks } from './stickers';

export interface Profile {
  version: number;
  playerId: string;
  shards: number;
  dust: number;
  /** stickerId -> number owned (>1 means duplicates available to gift). */
  owned: Record<string, number>;
  /** Packs won but not yet opened. */
  unopened: { kind: 'standard' | 'premium'; reason: string }[];
  /** Per level: best score and best star rating earned. */
  levels: Record<number, { stars: 0 | 1 | 2 | 3; score: number }>;
  bestScore: number;
  bestChain: number;
  runs: number;
  blocksBroken: number;
  /** UTC day string of the last claimed daily reward. */
  lastDailyClaim: string;
  dailyStreak: number;
  /** Gift codes already redeemed on this device, so one code can't be reused. */
  redeemed: string[];
  /** Daily-challenge day string -> best score, for the share card. */
  dailyBest: Record<string, number>;
  muted: boolean;
  seenIntro: boolean;
}

function fresh(): Profile {
  return {
    version: 1,
    playerId: Math.random().toString(36).slice(2, 8).toUpperCase(),
    shards: 0,
    dust: 0,
    owned: {},
    unopened: [],
    levels: {},
    bestScore: 0,
    bestChain: 0,
    runs: 0,
    blocksBroken: 0,
    lastDailyClaim: '',
    dailyStreak: 0,
    redeemed: [],
    dailyBest: {},
    muted: false,
    seenIntro: false,
  };
}

export let profile: Profile = fresh();

export function loadProfile(): Profile {
  profile = storage.load(fresh());
  // Drop any sticker ids that no longer exist in the catalogue.
  for (const id of Object.keys(profile.owned)) {
    if (!STICKERS_BY_ID.has(id)) delete profile.owned[id];
  }
  return profile;
}

export function saveProfile(): void {
  storage.save(profile);
}

export function resetProfile(): void {
  storage.wipe();
  profile = fresh();
  saveProfile();
}

export function ownedCount(stickerId: string): number {
  return profile.owned[stickerId] ?? 0;
}

export function hasSticker(stickerId: string): boolean {
  return ownedCount(stickerId) > 0;
}

export function duplicatesOf(stickerId: string): number {
  return Math.max(0, ownedCount(stickerId) - 1);
}

export function isSetComplete(setId: string): boolean {
  return stickersInSet(setId).every((st) => hasSticker(st.id));
}

export function setProgress(setId: string): { owned: number; total: number } {
  const all = stickersInSet(setId);
  return { owned: all.filter((st) => hasSticker(st.id)).length, total: all.length };
}

export function albumProgress(): { owned: number; total: number } {
  const owned = STICKERS.filter((st) => hasSticker(st.id)).length;
  return { owned, total: STICKERS.length };
}

/** Every completed set's bonus, folded into one perk object. */
export function activePerks(): Perks {
  const perks = basePerks();
  for (const set of SETS) {
    if (isSetComplete(set.id)) set.bonus.apply(perks);
  }
  return perks;
}

export function addShards(n: number): void {
  profile.shards = Math.max(0, Math.round(profile.shards + n));
}

export function addDust(n: number): void {
  profile.dust = Math.max(0, Math.round(profile.dust + n));
}

export function grantSticker(stickerId: string): void {
  profile.owned[stickerId] = ownedCount(stickerId) + 1;
}

export function queuePack(kind: 'standard' | 'premium', reason: string): void {
  profile.unopened.push({ kind, reason });
}

export function todayKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function dayNumber(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000);
}

export interface DailyReward {
  streak: number;
  shards: number;
  pack: 'standard' | 'premium' | null;
}

/** What the daily check-in is worth right now, or null if already claimed. */
export function pendingDaily(): DailyReward | null {
  const today = todayKey();
  if (profile.lastDailyClaim === today) return null;
  const streak = continuesStreak(today) ? profile.dailyStreak + 1 : 1;
  return {
    streak,
    shards: 40 + Math.min(6, streak) * 25,
    pack: streak % 7 === 0 ? 'premium' : streak % 3 === 0 ? 'standard' : null,
  };
}

function continuesStreak(today: string): boolean {
  if (!profile.lastDailyClaim) return false;
  return dayNumber(today) - dayNumber(profile.lastDailyClaim) === 1;
}

export function claimDaily(): DailyReward | null {
  const reward = pendingDaily();
  if (!reward) return null;
  profile.lastDailyClaim = todayKey();
  profile.dailyStreak = reward.streak;
  addShards(reward.shards);
  if (reward.pack) queuePack(reward.pack, `Day ${reward.streak} streak`);
  saveProfile();
  return reward;
}

export function starsFor(levelId: number): 0 | 1 | 2 | 3 {
  return profile.levels[levelId]?.stars ?? 0;
}

export function bestScoreFor(levelId: number): number {
  return profile.levels[levelId]?.score ?? 0;
}

export function isCleared(levelId: number): boolean {
  return starsFor(levelId) > 0;
}

/** A level opens once the one before it has been cleared. Level 1 is always open. */
export function isUnlocked(levelId: number): boolean {
  return levelId <= 1 || isCleared(levelId - 1);
}

export function totalStars(): number {
  return Object.values(profile.levels).reduce((a, l) => a + l.stars, 0);
}

export function highestUnlocked(levelIds: number[]): number {
  let best = levelIds[0] ?? 1;
  for (const id of levelIds) if (isUnlocked(id)) best = id;
  return best;
}

export interface LevelRecord {
  levelId: number;
  won: boolean;
  score: number;
  stars: 0 | 1 | 2 | 3;
  bestChain: number;
  blocksBroken: number;
}

export function recordLevel(r: LevelRecord): {
  firstClear: boolean;
  improvedStars: boolean;
  newBest: boolean;
} {
  profile.runs++;
  profile.blocksBroken += r.blocksBroken;
  profile.bestChain = Math.max(profile.bestChain, r.bestChain);
  profile.bestScore = Math.max(profile.bestScore, r.score);

  if (!r.won) {
    saveProfile();
    return { firstClear: false, improvedStars: false, newBest: false };
  }

  const prev = profile.levels[r.levelId];
  const firstClear = !prev;
  const improvedStars = !!prev && r.stars > prev.stars;
  const newBest = !prev || r.score > prev.score;

  profile.levels[r.levelId] = {
    stars: Math.max(prev?.stars ?? 0, r.stars) as 0 | 1 | 2 | 3,
    score: Math.max(prev?.score ?? 0, r.score),
  };
  saveProfile();
  return { firstClear, improvedStars, newBest };
}
