/** Every tunable the game balances on, in one file. */
export const CFG = {
  /** A square board reads best in portrait with the tray underneath. */
  cols: 8,
  rows: 8,
  /** Pieces offered at once. A fresh set arrives when all three are gone. */
  traySize: 3,

  clear: {
    /**
     * Clearing several lines with one piece is the whole skill of the game, so
     * the multiplier for doing it is steep.
     */
    comboStep: 0.8,
    /** Extra multiplier per consecutive clearing placement. */
    streakStep: 0.25,
    maxStreakBonus: 3,
  },

  scoring: {
    perTilePlaced: 2,
    perTileCleared: 14,
    lineBonus: 140,
    gemBonus: 250,
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

  /** Junk that seeps into empty cells on the later levels. */
  creep: {
    stoneChance: 0.18,
    gemChance: 0.06,
    bombChance: 0.08,
  },

  classic: {
    /** Shards earned per point, so an endless run still feeds the album. */
    shardsPerPoint: 1 / 400,
    maxShardsPerRun: 400,
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
  gem: { core: '#e8ecff', glow: '#ffffff' },
  crate: { core: '#a9743f', glow: '#d19a63' },
  bg: '#080a14',
  danger: '#ff2e63',
} as const;
