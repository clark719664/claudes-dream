import { CFG } from '../game/config';
import { Rng, hashString, randomSeed } from '../core/rng';
import { STICKERS, STICKERS_BY_ID, type Rarity, type Sticker } from './stickers';
import {
  addDust,
  grantSticker,
  hasSticker,
  ownedCount,
  profile,
  saveProfile,
} from './profile';

export type PackKind = 'standard' | 'premium';

export interface PullResult {
  sticker: Sticker;
  duplicate: boolean;
  dust: number;
  /** True when this pull finished an album page. */
  completedSet: string | null;
}

const RARITY_WEIGHTS: Record<PackKind, Record<Rarity, number>> = {
  standard: { 1: 55, 2: 27, 3: 13, 4: 4.2, 5: 0.8 },
  premium: { 1: 22, 2: 30, 3: 30, 4: 14, 5: 4 },
};

/** Every pack guarantees at least one pull at or above this rarity. */
const FLOOR: Record<PackKind, Rarity> = { standard: 2, premium: 4 };

export function packCost(kind: PackKind): number {
  return kind === 'premium' ? CFG.packs.premiumCost : CFG.packs.standardCost;
}

export function packSize(kind: PackKind): number {
  return kind === 'premium' ? CFG.packs.premiumCards : CFG.packs.standardCards;
}

export function canAfford(kind: PackKind): boolean {
  return profile.shards >= packCost(kind);
}

/** Spend shards on a pack and drop it into the unopened queue. */
export function buyPack(kind: PackKind): boolean {
  if (!canAfford(kind)) return false;
  profile.shards -= packCost(kind);
  profile.unopened.push({ kind, reason: 'Bought with shards' });
  saveProfile();
  return true;
}

export function openPack(kind: PackKind, seed = randomSeed()): PullResult[] {
  const rng = new Rng(seed);
  const size = packSize(kind);
  const pulls: PullResult[] = [];
  const floor = FLOOR[kind];
  let metFloor = false;

  for (let i = 0; i < size; i++) {
    const lastCard = i === size - 1;
    const rarity = lastCard && !metFloor ? rollAtLeast(kind, floor, rng) : rollRarity(kind, rng);
    if (rarity >= floor) metFloor = true;

    const before = completedSetIds();
    const sticker = pickSticker(rarity, rng);
    const duplicate = hasSticker(sticker.id);
    grantSticker(sticker.id);
    const dust = duplicate ? CFG.packs.dupeDust[sticker.rarity] : 0;
    if (dust) addDust(dust);
    const after = completedSetIds();
    const completed = after.find((s) => !before.includes(s)) ?? null;

    pulls.push({ sticker, duplicate, dust, completedSet: completed });
  }

  saveProfile();
  return pulls;
}

function completedSetIds(): string[] {
  const bySet = new Map<string, Sticker[]>();
  for (const st of STICKERS) {
    const list = bySet.get(st.set) ?? [];
    list.push(st);
    bySet.set(st.set, list);
  }
  const done: string[] = [];
  for (const [set, list] of bySet) {
    if (list.every((st) => hasSticker(st.id))) done.push(set);
  }
  return done;
}

function rollRarity(kind: PackKind, rng: Rng): Rarity {
  const table = RARITY_WEIGHTS[kind];
  const rarities: Rarity[] = [1, 2, 3, 4, 5];
  return rng.weighted(
    rarities,
    rarities.map((r) => table[r]),
  );
}

function rollAtLeast(kind: PackKind, floor: Rarity, rng: Rng): Rarity {
  const table = RARITY_WEIGHTS[kind];
  const rarities = ([1, 2, 3, 4, 5] as Rarity[]).filter((r) => r >= floor);
  return rng.weighted(
    rarities,
    rarities.map((r) => table[r]),
  );
}

/**
 * Pull a sticker of the rolled rarity. Missing stickers are favoured so early
 * albums fill quickly; the remaining chance of a duplicate is what feeds the
 * dust economy and gives players something to gift.
 */
function pickSticker(rarity: Rarity, rng: Rng): Sticker {
  const pool = STICKERS.filter((st) => st.rarity === rarity);
  const missing = pool.filter((st) => !hasSticker(st.id));
  if (missing.length && rng.chance(0.6)) return rng.pick(missing);
  return rng.pick(pool);
}

export function craftCost(rarity: Rarity): number {
  return CFG.packs.craftCost[rarity];
}

export function canCraft(stickerId: string): boolean {
  const st = STICKERS_BY_ID.get(stickerId);
  if (!st || hasSticker(stickerId)) return false;
  return profile.dust >= craftCost(st.rarity);
}

export function craft(stickerId: string): boolean {
  if (!canCraft(stickerId)) return false;
  const st = STICKERS_BY_ID.get(stickerId)!;
  profile.dust -= craftCost(st.rarity);
  grantSticker(stickerId);
  saveProfile();
  return true;
}

// ---------------------------------------------------------------------------
// Gifting: a duplicate becomes a short code a friend can redeem, with no
// server involved. Codes are checksummed so typos are rejected, and each one
// can only be redeemed once per device.
// ---------------------------------------------------------------------------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I/L/O/U

export function giftableStickers(): { sticker: Sticker; spare: number }[] {
  return STICKERS.filter((st) => ownedCount(st.id) > 1)
    .map((st) => ({ sticker: st, spare: ownedCount(st.id) - 1 }))
    .sort((a, b) => b.sticker.rarity - a.sticker.rarity);
}

/** Consume one duplicate and mint a code for it. Returns null if none spare. */
export function mintGift(stickerId: string): string | null {
  if (ownedCount(stickerId) <= 1) return null;
  const index = STICKERS.findIndex((st) => st.id === stickerId);
  if (index < 0) return null;

  profile.owned[stickerId] = ownedCount(stickerId) - 1;
  const nonce = Math.floor(Math.random() * 1024);
  const code = encodeGift(index, nonce);
  saveProfile();
  return code;
}

export function encodeGift(index: number, nonce: number): string {
  const payload = ((index & 0x3ff) | ((nonce & 0x3ff) << 10)) >>> 0;
  const check = hashString(`prismbreak-gift-${payload}`) & 0xfff;
  const value = (payload | (check << 20)) >>> 0;

  let body = '';
  for (let i = 0; i < 7; i++) {
    body = ALPHABET[(value >>> (i * 5)) & 31] + body;
  }
  return `PB-${body.slice(0, 4)}-${body.slice(4)}`;
}

export type RedeemResult =
  | { ok: true; sticker: Sticker; duplicate: boolean; dust: number }
  | { ok: false; reason: 'malformed' | 'already-redeemed' | 'unknown-sticker' };

export function redeemGift(raw: string): RedeemResult {
  const cleaned = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^PB/, '');
  if (cleaned.length !== 7) return { ok: false, reason: 'malformed' };

  let value = 0;
  for (const ch of cleaned) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) return { ok: false, reason: 'malformed' };
    value = (value * 32 + digit) >>> 0;
  }

  const payload = value & 0xfffff;
  const check = (value >>> 20) & 0xfff;
  if ((hashString(`prismbreak-gift-${payload}`) & 0xfff) !== check) {
    return { ok: false, reason: 'malformed' };
  }

  const normalised = `PB-${cleaned}`;
  if (profile.redeemed.includes(normalised)) {
    return { ok: false, reason: 'already-redeemed' };
  }

  const sticker = STICKERS[payload & 0x3ff];
  if (!sticker) return { ok: false, reason: 'unknown-sticker' };

  const duplicate = hasSticker(sticker.id);
  grantSticker(sticker.id);
  const dust = duplicate ? CFG.packs.dupeDust[sticker.rarity] : 0;
  if (dust) addDust(dust);
  profile.redeemed.push(normalised);
  saveProfile();

  return { ok: true, sticker, duplicate, dust };
}
