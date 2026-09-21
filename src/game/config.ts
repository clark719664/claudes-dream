/** Every tunable the game balances on, in one file. */
export const CFG = {
  /** A square board reads best in portrait with the tray underneath. */
  cols: 8,
  rows: 8,
  /** Pieces offered at once. A fresh set arrives when all three are gone. */
  traySize: 3,

  clear: {
    /** Touching same-colour tiles needed to clear as a group. */
    groupThreshold: 5,
    /** Extra multiplier per simultaneous clear beyond the first. */
    comboStep: 0.6,
    /** Extra multiplier per consecutive clearing placement. */
    streakStep: 0.25,
    maxStreakBonus: 2.5,
  },

  scoring: {
    perTilePlaced: 2,
    perTileCleared: 14,
    lineBonus: 120,
    groupBonus: 90,
    blastBonus: 40,
    movesLeftBonus: 200,
  },

  shards: {
    perStar: 60,
    levelClear: 80,
    /** First clear pays more, so replaying an easy level cannot be farmed. */
    firstClearBonus: 120,
  },

  packs: {
    standardCost: 250,
    standardCards: 3,
    premiumCost: 900,
    premiumCards: 5,
    /** Dust you get for a sticker you already own. */
    dupeDust: { 1: 5, 2: 12, 3: 30, 4: 90, 5: 300 } as Record<number, number>,
    /** Dust price to craft a specific sticker outright. */
    craftCost: { 1: 25, 2: 60, 3: 150, 4: 450, 5: 1500 } as Record<number, number>,
  },

  /** Rows pushed in from the top on levels that advance. */
  siege: {
    hpBase: 1,
    gapChance: 0.28,
    stoneChance: 0.14,
    prismChance: 0.05,
    bombChance: 0.07,
  },
} as const;

export const PALETTE = {
  hues: [
    { core: '#ff4d6d', glow: '#ff8fa3', name: 'Ruby' },
    { core: '#4cc9f0', glow: '#8ae3ff', name: 'Cyan' },
    { core: '#b5e848', glow: '#d8ff8a', name: 'Lime' },
    { core: '#ffb703', glow: '#ffd978', name: 'Amber' },
    { core: '#c77dff', glow: '#e2b8ff', name: 'Violet' },
  ],
  stone: { core: '#5a6478', glow: '#8b95a8' },
  prism: { core: '#e8ecff', glow: '#ffffff' },
  crate: { core: '#a9743f', glow: '#d19a63' },
  bg: '#080a14',
  danger: '#ff2e63',
} as const;
