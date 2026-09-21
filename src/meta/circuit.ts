/**
 * The Circuit: a travel-and-build loop that the puzzle feeds.
 *
 * Play a level or a Classic run and you earn **Charges**. Spend a Charge on the
 * Circuit and you surge forward a few nodes; whatever you land on pays out
 * **Lumens**, shards, packs or a setback. Lumens raise **Beacons**, and lighting
 * every Beacon in a Sector opens the next one.
 *
 * ── On originality ────────────────────────────────────────────────────────
 * The shape of this loop — spend a currency to advance around a track, collect
 * on what you land on, spend the proceeds on structures, finish a location and
 * move to the next — is a game mechanic, and mechanics are not what copyright
 * or trademark protect. What *is* protected is expression: names, characters,
 * distinctive artwork and trade dress.
 *
 * So nothing here borrows any of that. There is no square board with corner
 * squares, no coloured property bands, no mascot, no jail, no chance or
 * community chest, no rent charged between players, and no name taken from any
 * existing game. The track is a ring of light nodes, the currencies are Charges
 * and Lumens, the structures are Beacons, and every Sector and node name below
 * is original and fits this game's own prism-and-light theme.
 *
 * See docs/IP_NOTES.md for the full list of what was deliberately avoided.
 */

export type NodeKind =
  | 'origin'
  | 'cache'
  | 'vault'
  | 'surge'
  | 'relay'
  | 'pack'
  | 'prism'
  | 'drain';

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  icon: string;
  blurb: string;
}

export const NODES: Record<NodeKind, NodeSpec> = {
  origin: { kind: 'origin', label: 'Origin', icon: '◎', blurb: 'Pass it and the grid pays a dividend.' },
  cache: { kind: 'cache', label: 'Cache', icon: '◈', blurb: 'A small store of Lumens.' },
  vault: { kind: 'vault', label: 'Vault', icon: '◆', blurb: 'A deep store of Lumens.' },
  surge: { kind: 'surge', label: 'Surge', icon: '⚡', blurb: 'Charges back, free of cost.' },
  relay: { kind: 'relay', label: 'Relay', icon: '➤', blurb: 'Throws you further round the ring.' },
  pack: { kind: 'pack', label: 'Signal', icon: '🎴', blurb: 'A sticker pack rides the signal in.' },
  prism: { kind: 'prism', label: 'Prism', icon: '🔷', blurb: 'Doubles whatever you land on next.' },
  drain: { kind: 'drain', label: 'Drain', icon: '◌', blurb: 'The dark takes a cut of your Lumens.' },
};

export interface BeaconSpec {
  name: string;
  cost: number;
}

export interface SectorSpec {
  id: number;
  name: string;
  accent: string;
  /** Node ring, walked in order. Index 0 is always the Origin. */
  ring: NodeKind[];
  beacons: BeaconSpec[];
  /** Scales every Lumen payout in this Sector. */
  payout: number;
}

/** Four Beacons a Sector, each dearer than the last. */
function beacons(names: string[], base: number): BeaconSpec[] {
  return names.map((name, i) => ({ name, cost: Math.round(base * Math.pow(1.85, i)) }));
}

const RING_A: NodeKind[] = [
  'origin', 'cache', 'cache', 'surge', 'cache', 'vault',
  'relay', 'cache', 'drain', 'cache', 'pack', 'cache',
  'surge', 'vault', 'cache', 'prism',
];

const RING_B: NodeKind[] = [
  'origin', 'cache', 'drain', 'vault', 'cache', 'surge',
  'cache', 'prism', 'relay', 'cache', 'vault', 'drain',
  'pack', 'cache', 'surge', 'vault', 'cache', 'relay',
];

const RING_C: NodeKind[] = [
  'origin', 'vault', 'drain', 'cache', 'prism', 'vault',
  'drain', 'surge', 'relay', 'vault', 'cache', 'drain',
  'pack', 'vault', 'prism', 'surge', 'drain', 'vault',
  'cache', 'relay',
];

export const SECTORS: SectorSpec[] = [
  {
    id: 0,
    name: 'Shoal Light',
    accent: '#4cc9f0',
    ring: RING_A,
    payout: 1,
    beacons: beacons(['Tidal Lamp', 'Reef Mast', 'Harbour Array', 'Shoal Spire'], 900),
  },
  {
    id: 1,
    name: 'The Foundry',
    accent: '#ffb703',
    ring: RING_B,
    payout: 2.4,
    beacons: beacons(['Crucible', 'Draw Tower', 'Kiln Stack', 'Foundry Prism'], 2600),
  },
  {
    id: 2,
    name: 'Nullspace',
    accent: '#c77dff',
    ring: RING_C,
    payout: 6,
    beacons: beacons(['Dark Lantern', 'Null Antenna', 'Event Mast', 'The Long Beacon'], 7400),
  },
];

export const MAX_CHARGES = 30;
/** One Charge back every this many minutes, up to the cap. */
export const CHARGE_REGEN_MINUTES = 18;

/** Charges earned for clearing a level. Stars are most of it. */
export function chargesForLevel(stars: number, firstClear: boolean): number {
  return (firstClear ? 5 : 1) + stars * 2;
}

/** Charges earned from a Classic run, capped so one huge run is not the game. */
export function chargesForClassic(score: number): number {
  return Math.max(1, Math.min(12, Math.floor(score / 2500)));
}

export interface Payout {
  lumens: number;
  shards: number;
  charges: number;
  pack: boolean;
  /** Extra nodes travelled by a Relay, resolved by the caller. */
  advance: number;
  /** This node primes the next landing to pay double. */
  primes: boolean;
  text: string;
}

const EMPTY: Payout = {
  lumens: 0, shards: 0, charges: 0, pack: false, advance: 0, primes: false, text: '',
};

/**
 * What landing on a node is worth. `primed` is set when the previous landing
 * was a Prism, which doubles this one.
 */
export function resolveNode(
  kind: NodeKind,
  sector: SectorSpec,
  roll: () => number,
  primed: boolean,
  lumens: number,
): Payout {
  const scale = sector.payout * (primed ? 2 : 1);
  const r = roll();

  switch (kind) {
    case 'cache':
      return { ...EMPTY, lumens: Math.round((180 + r * 90) * scale), text: 'Cache' };
    case 'vault':
      return { ...EMPTY, lumens: Math.round((700 + r * 260) * scale), text: 'Vault' };
    case 'surge':
      return { ...EMPTY, charges: 2 + (r % 3), text: 'Surge' };
    case 'relay':
      return { ...EMPTY, advance: 2 + (r % 4), text: 'Relay' };
    case 'pack':
      return { ...EMPTY, pack: true, shards: Math.round(120 * scale), text: 'Signal' };
    case 'prism':
      return { ...EMPTY, primes: true, lumens: Math.round(120 * scale), text: 'Prism' };
    case 'drain':
      // Always survivable: a proportion, never a fixed sum that could wipe you.
      return { ...EMPTY, lumens: -Math.round(Math.min(lumens * 0.12, 400 * sector.payout)), text: 'Drain' };
    case 'origin':
      return { ...EMPTY, lumens: Math.round(500 * scale), charges: 1, text: 'Origin' };
  }
}

/** Passing the Origin on the way round pays a dividend. */
export function originDividend(sector: SectorSpec): number {
  return Math.round(400 * sector.payout);
}
