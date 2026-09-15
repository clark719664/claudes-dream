/**
 * The civil layer's own hours: what the Exchange does every morning, and what
 * the docket does at tick 16 on the second and fifth day of the week
 * (`docs/CIVIL.md` §4, `REGISTRY.md` §2).
 *
 * The order matters. Stipends are paid before anything reads whether they were,
 * offers and terms are settled before the docket reads the record, the docket's
 * own orders expire before the ladder collects on them, and the recovery pass
 * runs last so that everything it collects is a debt somebody has already had
 * their three days to pay.
 *
 * Nothing in this file punishes anybody, and nothing in it can: the whole of
 * the civil layer moves lumens and compels performance, never liberty.
 */
import type { World } from '../types.ts';
import type { ContemptHandler } from '../government/recovery.ts';
import { dailyContracts } from './amend.ts';
import { closeDocket, expireCompulsions, isDocketDay, openDocket, DOCKET_HOUR } from './docket.ts';
import { dailyEnforcement } from './enforcement.ts';
import { electGuildMasters } from './guilds.ts';
import { payPatronage } from './patronage.ts';

/**
 * The morning. `onContempt` is the Court's own handler, handed in by the caller
 * exactly as `government/recovery.ts dailyRecovery` takes it, so this file never
 * imports the Court and never files a charge itself.
 */
export function dailyCivil(world: World, onContempt?: ContemptHandler): void {
  payPatronage(world);
  dailyContracts(world);
  expireCompulsions(world);
  electGuildMasters(world);
  dailyEnforcement(world, onContempt);
}

/** Tick 16 on a docket day: the benches are seated before the hour is decided. */
export function openCivilDocket(world: World): void {
  if (world.hour !== DOCKET_HOUR || !isDocketDay(world)) return;
  openDocket(world);
}

/** The end of the same hour: the votes are counted and the carried are carried. */
export function closeCivilDocket(world: World): void {
  if (world.hour !== DOCKET_HOUR || !isDocketDay(world)) return;
  closeDocket(world);
}
