export type Rarity = 1 | 2 | 3 | 4 | 5;

export interface Sticker {
  id: string;
  name: string;
  set: string;
  rarity: Rarity;
  glyph: string;
  flavour: string;
}

/** A permanent, gameplay-affecting reward for finishing an album page. */
export interface SetBonus {
  label: string;
  apply: (p: Perks) => void;
}

export interface Perks {
  extraMoves: number;
  /** A fourth slot in the tray — the strongest thing you can have in a fitting game. */
  extraTraySlot: boolean;
  /** Lets a piece you cannot use be thrown away, once per level. */
  discards: number;
  bombRadius: number;
  shardMultiplier: number;
}

export function basePerks(): Perks {
  return {
    extraMoves: 0,
    extraTraySlot: false,
    discards: 0,
    bombRadius: 1,
    shardMultiplier: 1,
  };
}

export interface StickerSet {
  id: string;
  name: string;
  accent: string;
  bonus: SetBonus;
}

export const SETS: StickerSet[] = [
  {
    id: 'menagerie',
    name: 'Neon Menagerie',
    accent: '#4cc9f0',
    bonus: {
      label: '+1 move on every level',
      apply: (p) => {
        p.extraMoves += 1;
      },
    },
  },
  {
    id: 'deepspace',
    name: 'Deep Space',
    accent: '#c77dff',
    bonus: {
      label: 'A fourth piece in the tray, always',
      apply: (p) => {
        p.extraTraySlot = true;
      },
    },
  },
  {
    id: 'arcade',
    name: 'Arcade Legends',
    accent: '#b5e848',
    bonus: {
      label: 'Throw away one piece you cannot use, every level',
      apply: (p) => {
        p.discards += 1;
      },
    },
  },
  {
    id: 'carnival',
    name: 'Cursed Carnival',
    accent: '#ff4d6d',
    bonus: {
      label: 'Bombs blow a 5×5 hole instead of 3×3',
      apply: (p) => {
        p.bombRadius = Math.max(p.bombRadius, 2);
      },
    },
  },
  {
    id: 'founders',
    name: 'Founders',
    accent: '#ffb703',
    bonus: {
      label: '+25% Prism Shards from every level',
      apply: (p) => {
        p.shardMultiplier += 0.25;
      },
    },
  },
];

function s(
  id: string,
  set: string,
  name: string,
  rarity: Rarity,
  glyph: string,
  flavour: string,
): Sticker {
  return { id: `${set}:${id}`, set, name, rarity, glyph, flavour };
}

export const STICKERS: Sticker[] = [
  // --- Neon Menagerie -----------------------------------------------------
  s('voltfox', 'menagerie', 'Voltfox', 1, '🦊', 'Chases anything that sparks.'),
  s('glowmoth', 'menagerie', 'Glowmoth', 1, '🦋', 'Drawn to the brightest cascade.'),
  s('neonkoi', 'menagerie', 'Neon Koi', 2, '🐟', 'Swims upstream through falling walls.'),
  s('staticstag', 'menagerie', 'Static Stag', 2, '🦌', 'Antlers hum before a big chain.'),
  s('pixelowl', 'menagerie', 'Pixel Owl', 3, '🦉', 'Sees the ricochet three bounces out.'),
  s('lumenlynx', 'menagerie', 'Lumen Lynx', 3, '🐆', 'Never misses a resonance.'),
  s('teslatoad', 'menagerie', 'Tesla Toad', 4, '🐸', 'One hop, seven blocks.'),
  s('aurorawhale', 'menagerie', 'Aurora Whale', 5, '🐋', 'Sings the colour that shatters everything.'),

  // --- Deep Space ---------------------------------------------------------
  s('iondrift', 'deepspace', 'Ion Drift', 1, '✨', 'The long quiet between waves.'),
  s('cometttail', 'deepspace', 'Comet Tail', 1, '☄️', 'Still burning on the way out.'),
  s('ringworld', 'deepspace', 'Ringworld', 2, '🪐', 'Built by someone with patience.'),
  s('pulsar', 'deepspace', 'Pulsar', 2, '📡', 'Counts your combo in milliseconds.'),
  s('nebulabloom', 'deepspace', 'Nebula Bloom', 3, '🌌', 'Every colour at once, briefly.'),
  s('quasar', 'deepspace', 'Quasar', 3, '💫', 'Loud enough to be seen.'),
  s('blackhole', 'deepspace', 'Black Hole', 4, '🕳️', 'Gravity, but rude about it.'),
  s('longdark', 'deepspace', 'The Long Dark', 5, '🌑', 'Where the un-cleared walls go.'),

  // --- Arcade Legends -----------------------------------------------------
  s('coinslot', 'arcade', 'Coin Slot', 1, '🪙', 'Insert to continue.'),
  s('joystick', 'arcade', 'Joystick', 1, '🕹️', 'Worn smooth on the diagonal.'),
  s('oneup', 'arcade', '1-Up', 2, '🍄', 'One more run. Just one.'),
  s('cabinetglow', 'arcade', 'Cabinet Glow', 2, '💡', 'Visible from the car park.'),
  s('highscore', 'arcade', 'High Score', 3, '🏆', 'Initials: AAA.'),
  s('gameover', 'arcade', 'Game Over', 3, '💀', 'Temporary.'),
  s('continue', 'arcade', 'Continue?', 4, '⏳', 'Nine… eight… seven…'),
  s('perfectrun', 'arcade', 'Perfect Run', 5, '🥇', 'Board cleared. Nothing left.'),

  // --- Cursed Carnival ----------------------------------------------------
  s('ticketstub', 'carnival', 'Ticket Stub', 1, '🎫', 'No refunds.'),
  s('cottonghoul', 'carnival', 'Cotton Ghoul', 1, '🍬', 'Sweet, and slightly wrong.'),
  s('mirrormaze', 'carnival', 'Mirror Maze', 2, '🪞', 'Your ball, from every angle.'),
  s('ringtoss', 'carnival', 'Rigged Ring Toss', 2, '🎯', 'It was never going to land.'),
  s('thebarker', 'carnival', 'The Barker', 3, '🎩', 'Step right up, step right up.'),
  s('ferriswraith', 'carnival', 'Ferris Wraith', 3, '🎡', 'Still turning after closing.'),
  s('bigtop', 'carnival', 'Big Top', 4, '🎪', 'Something is under the canvas.'),
  s('carousel', 'carnival', 'Midnight Carousel', 5, '🎠', 'The horses face the wrong way.'),

  // --- Founders (chase set) -----------------------------------------------
  s('firstlight', 'founders', 'First Light', 3, '🔆', 'The very first resonance.'),
  s('breakpoint', 'founders', 'Breakpoint', 4, '⚡', 'Where the wall gave up.'),
  s('prismzero', 'founders', 'Prism Zero', 4, '🔷', 'Prototype. Still the best one.'),
  s('architect', 'founders', 'The Architect', 5, '📐', 'Drew the grid, then broke it.'),
  s('origin', 'founders', 'Origin', 5, '🌟', 'Everything started at this cell.'),
];

export const STICKERS_BY_ID = new Map(STICKERS.map((st) => [st.id, st]));
export const SETS_BY_ID = new Map(SETS.map((st) => [st.id, st]));

export function stickersInSet(setId: string): Sticker[] {
  return STICKERS.filter((st) => st.set === setId).sort((a, b) => a.rarity - b.rarity);
}

export const RARITY_NAME: Record<Rarity, string> = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Epic',
  5: 'Prismatic',
};

export const RARITY_COLOUR: Record<Rarity, string> = {
  1: '#8b95a8',
  2: '#4cc9f0',
  3: '#b5e848',
  4: '#c77dff',
  5: '#ffb703',
};
