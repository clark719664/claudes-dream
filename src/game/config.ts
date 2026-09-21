/** Every tunable the game balances on. Kept in one file so the whole
 *  difficulty curve can be re-tuned without touching the simulation. */
export const CFG = {
  /** Playfield is a fixed virtual grid; the renderer scales it to the device. */
  cols: 7,
  rows: 11,
  /** A block crossing this row ends the run. */
  dangerRow: 10,

  ball: {
    radius: 0.085,      // in cell widths
    baseSpeed: 0.63,    // cells per tick
    maxSpeed: 1.15,
    /** Speed multiplier applied on each resonance pierce. */
    pierceBoost: 1.055,
    /** Gap between balls leaving the launcher, in ticks. */
    launchGap: 5,
    maxTrail: 9,
    /**
     * A ball burns one unit of energy per bounce and burns out at zero, so a
     * volley cannot ricochet forever. Resonance pierces cost nothing and
     * refund a unit, which is what makes colour-chaining extend a volley.
     */
    energy: 11,
    energyCap: 17,
    resonanceRefund: 1,
    /** Safety net so a pathological volley can never stall a run. */
    timeoutTicks: 60 * 16,
  },

  launcher: {
    minAngle: 14,       // degrees from horizontal; can't shoot sideways
    maxPreviewBounces: 2,
  },

  cascade: {
    /** Connected same-hue blocks of at least this size auto-detonate. */
    threshold: 5,
    /** Score multiplier per extra chain step. */
    chainStep: 0.75,
  },

  scoring: {
    block: 10,
    resonance: 25,
    cascadeBlock: 30,
    pierceStreakBonus: 15,
    waveClear: 400,
  },

  shards: {
    perBlock: 0.5,
    perCascadeBlock: 1.5,
    perWave: 12,
    /** A full-board clear is the big payout that keeps players chasing. */
    perfectClear: 150,
  },

  waves: {
    /** Starting balls in the volley. */
    startingBalls: 4,
    /** Pickups stop mattering past this, so the volley cannot snowball. */
    maxBalls: 12,
    /** Waves per extra row inserted per turn; the main difficulty ramp. */
    doubleRowEvery: 16,
    maxRowsPerWave: 3,
    /** Rows pre-filled when a run begins. */
    openingRows: 5,
    /** HP of a fresh block grows with the wave number. */
    hpBase: 1,
    hpPerWave: 0.16,
    hpMax: 9,
    /** Probability a spawned cell is empty; tightens as waves go on. */
    gapChanceStart: 0.36,
    gapChanceEnd: 0.16,
    gapTightenOver: 30,
    stoneChanceStart: 0.0,
    stoneChanceEnd: 0.22,
    prismChance: 0.035,
    bombChance: 0.05,
    extraBallEvery: 4,
  },

  packs: {
    /** Shard price of the standard pack. */
    standardCost: 250,
    standardCards: 3,
    premiumCost: 900,
    premiumCards: 5,
    /** Dust you get for a sticker you already own. */
    dupeDust: { 1: 5, 2: 12, 3: 30, 4: 90, 5: 300 } as Record<number, number>,
    /** Dust price to craft a specific sticker outright. */
    craftCost: { 1: 25, 2: 60, 3: 150, 4: 450, 5: 1500 } as Record<number, number>,
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
  prism: { core: '#ffffff', glow: '#ffffff' },
  bg: '#080a14',
  danger: '#ff2e63',
} as const;
