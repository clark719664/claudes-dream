import type { Perks } from './stickers';

/**
 * The player level: a single long track that rises from everything you do, with
 * rewards hung off it.
 *
 * This is the Monopoly Go shape, and it exists because the 24 authored levels
 * are finite. Without a track like this, a player who finishes them has nothing
 * left to climb and Classic is just a scoreboard. With it, every Classic run
 * and every replay still moves a bar, and the next thing unlocking is always
 * visible and always close.
 */
export interface Unlock {
  level: number;
  label: string;
  detail: string;
  icon: string;
  /** Feature gates open a screen; perk gates change how the game plays. */
  kind: 'feature' | 'perk';
  apply?: (p: Perks) => void;
  feature?: 'packs' | 'gifting' | 'premium-packs';
}

export const UNLOCKS: Unlock[] = [
  {
    level: 2,
    kind: 'feature',
    feature: 'packs',
    icon: '🎴',
    label: 'Sticker packs',
    detail: 'Spend Prism Shards on packs in the shop.',
  },
  {
    level: 3,
    kind: 'perk',
    icon: '➕',
    label: '+1 move',
    detail: 'Every level gives you one more piece to place.',
    apply: (p) => {
      p.extraMoves += 1;
    },
  },
  {
    level: 4,
    kind: 'feature',
    feature: 'gifting',
    icon: '🤝',
    label: 'Gifting',
    detail: 'Send a spare sticker to a friend as a code.',
  },
  {
    level: 5,
    kind: 'perk',
    icon: '🗑️',
    label: 'Discard',
    detail: 'Throw away one piece that has nowhere to go, once per game.',
    apply: (p) => {
      p.discards += 1;
    },
  },
  {
    level: 7,
    kind: 'feature',
    feature: 'premium-packs',
    icon: '💎',
    label: 'Prismatic packs',
    detail: 'Five stickers, at least one Epic or better.',
  },
  {
    level: 8,
    kind: 'perk',
    icon: '🀄',
    label: 'Fourth tray slot',
    detail: 'Four pieces to choose from instead of three, forever.',
    apply: (p) => {
      p.extraTraySlots += 1;
    },
  },
  {
    level: 10,
    kind: 'perk',
    icon: '➕',
    label: '+2 moves',
    detail: 'Two more pieces on every level.',
    apply: (p) => {
      p.extraMoves += 2;
    },
  },
  {
    level: 12,
    kind: 'perk',
    icon: '✦',
    label: 'Bigger bombs',
    detail: 'Bombs blow a 5×5 hole instead of 3×3.',
    apply: (p) => {
      p.bombRadius = Math.max(p.bombRadius, 2);
    },
  },
  {
    level: 15,
    kind: 'perk',
    icon: '🗑️',
    label: 'Second discard',
    detail: 'Two pieces a game can be thrown away.',
    apply: (p) => {
      p.discards += 1;
    },
  },
  {
    level: 18,
    kind: 'perk',
    icon: '◆',
    label: '+25% shards',
    detail: 'Every payout is a quarter bigger.',
    apply: (p) => {
      p.shardMultiplier += 0.25;
    },
  },
  {
    level: 22,
    kind: 'perk',
    icon: '➕',
    label: '+3 moves',
    detail: 'Three more pieces on every level.',
    apply: (p) => {
      p.extraMoves += 3;
    },
  },
  {
    level: 26,
    kind: 'perk',
    icon: '🀄',
    label: 'Fifth tray slot',
    detail: 'Five pieces to choose from. The board rarely corners you now.',
    apply: (p) => {
      p.extraTraySlots += 1;
    },
  },
  {
    level: 30,
    kind: 'perk',
    icon: '◆',
    label: '+50% shards',
    detail: 'Half again on every payout.',
    apply: (p) => {
      p.shardMultiplier += 0.25;
    },
  },
];

export const MAX_LEVEL = 30;

/**
 * XP needed to go from `level` to the next one. Deliberately shallow early —
 * the first few rewards should arrive inside the first session — and steepening
 * after, so the track still has somewhere to go at level 20.
 */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  return Math.round(120 + Math.pow(level, 1.55) * 55);
}

export function levelFromXp(totalXp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let remaining = totalXp;
  while (level < MAX_LEVEL) {
    const needed = xpToNext(level);
    if (remaining < needed) return { level, into: remaining, needed };
    remaining -= needed;
    level++;
  }
  return { level: MAX_LEVEL, into: 0, needed: Infinity };
}

/** XP for finishing a level, first time or not. */
export function xpForLevelClear(stars: number, firstClear: boolean): number {
  return (firstClear ? 100 : 25) + stars * 30;
}

/** XP for a Classic run, capped so a single monster run cannot skip the track. */
export function xpForClassic(score: number): number {
  return Math.min(250, Math.floor(score / 220));
}

export function unlocksAt(level: number): Unlock[] {
  return UNLOCKS.filter((u) => u.level === level);
}

export function unlockedFeatures(level: number): Set<string> {
  const open = new Set<string>();
  for (const u of UNLOCKS) {
    if (u.level <= level && u.feature) open.add(u.feature);
  }
  return open;
}

export function applyLevelPerks(level: number, perks: Perks): void {
  for (const u of UNLOCKS) {
    if (u.level <= level) u.apply?.(perks);
  }
}

/** The next thing waiting, for the "coming up" line on the home screen. */
export function nextUnlock(level: number): Unlock | null {
  return UNLOCKS.find((u) => u.level > level) ?? null;
}
