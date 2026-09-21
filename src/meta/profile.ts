import * as storage from '../core/storage';
import {
  CHARGE_REGEN_MINUTES,
  MAX_CHARGES,
  SECTORS,
  chargesForClassic,
  chargesForLevel,
} from './circuit';
import {
  applyLevelPerks,
  levelFromXp,
  unlockedFeatures,
  xpForClassic,
  xpForLevelClear,
} from './progression';
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
  /** Total experience, which drives the player level and its unlock track. */
  xp: number;
  /** The Circuit: charges to spend, lumens to build with, and where you are. */
  charges: number;
  lumens: number;
  sector: number;
  node: number;
  /** Beacons raised in the current sector. */
  beacons: number;
  /** Set when the last landing was a Prism, doubling the next one. */
  primed: boolean;
  /** Epoch ms the charge meter was last topped up. */
  chargedAt: number;
  sectorsDone: number;
  /** Per level: best score and best star rating earned. */
  levels: Record<number, { stars: 0 | 1 | 2 | 3; score: number }>;
  bestScore: number;
  bestChain: number;
  /** Classic mode: the endless high-score run. */
  classicBest: number;
  classicBestLines: number;
  classicRuns: number;
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
    xp: 0,
    charges: 10,
    lumens: 0,
    sector: 0,
    node: 0,
    beacons: 0,
    primed: false,
    chargedAt: Date.now(),
    sectorsDone: 0,
    levels: {},
    bestScore: 0,
    bestChain: 0,
    classicBest: 0,
    classicBestLines: 0,
    classicRuns: 0,
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

/**
 * Everything the player has earned, folded into one object: the player level's
 * unlock track first, then any completed album pages on top. The two are
 * deliberately separate ladders — the track rewards showing up, the album
 * rewards collecting — and they stack.
 */
export function activePerks(): Perks {
  const perks = basePerks();
  applyLevelPerks(playerLevel(), perks);
  for (const set of SETS) {
    if (isSetComplete(set.id)) set.bonus.apply(perks);
  }
  return perks;
}

// ---------------------------------------------------------------- circuit --

/**
 * Charges tick back up over time.
 *
 * This is the only timer in the game and it deliberately gates the Circuit
 * alone. Levels and Classic are always free and unlimited — they are how you
 * *earn* Charges — so a player who wants to keep playing never hits a wall,
 * and a player who wants a reason to come back tomorrow has one.
 */
export function regenerateCharges(now = Date.now()): void {
  if (profile.charges >= MAX_CHARGES) {
    profile.chargedAt = now;
    return;
  }
  const period = CHARGE_REGEN_MINUTES * 60_000;
  const earned = Math.floor((now - profile.chargedAt) / period);
  if (earned <= 0) return;
  profile.charges = Math.min(MAX_CHARGES, profile.charges + earned);
  profile.chargedAt =
    profile.charges >= MAX_CHARGES ? now : profile.chargedAt + earned * period;
  saveProfile();
}

/** Milliseconds until the next Charge arrives, or 0 when the meter is full. */
export function msToNextCharge(now = Date.now()): number {
  if (profile.charges >= MAX_CHARGES) return 0;
  return Math.max(0, profile.chargedAt + CHARGE_REGEN_MINUTES * 60_000 - now);
}

export function addCharges(n: number): void {
  profile.charges = Math.max(0, Math.min(MAX_CHARGES, profile.charges + n));
  saveProfile();
}

export function addLumens(n: number): void {
  profile.lumens = Math.max(0, Math.round(profile.lumens + n));
}

export function currentSector() {
  return SECTORS[Math.min(profile.sector, SECTORS.length - 1)];
}

export function circuitComplete(): boolean {
  return profile.sector >= SECTORS.length;
}

export function playerLevel(): number {
  return levelFromXp(profile.xp).level;
}

export function levelProgress(): { level: number; into: number; needed: number } {
  return levelFromXp(profile.xp);
}

export function hasFeature(feature: 'packs' | 'gifting' | 'premium-packs'): boolean {
  return unlockedFeatures(playerLevel()).has(feature);
}

/** Award XP and report any levels crossed, so the UI can celebrate them. */
export function addXp(amount: number): { gained: number; from: number; to: number } {
  const from = playerLevel();
  profile.xp += Math.max(0, Math.round(amount));
  const to = playerLevel();
  saveProfile();
  return { gained: amount, from, to };
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

/** Returns whether this run beat the stored high score. */
export function classicXp(score: number): number {
  return xpForClassic(score);
}

export function classicCharges(score: number): number {
  return chargesForClassic(score);
}

export function levelCharges(stars: number, firstClear: boolean): number {
  return chargesForLevel(stars, firstClear);
}

export function levelClearXp(stars: number, firstClear: boolean): number {
  return xpForLevelClear(stars, firstClear);
}

export function recordClassic(score: number, lines: number, tiles: number): boolean {
  profile.classicRuns++;
  profile.blocksBroken += tiles;
  profile.classicBestLines = Math.max(profile.classicBestLines, lines);
  const best = score > profile.classicBest;
  if (best) profile.classicBest = score;
  saveProfile();
  return best;
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
