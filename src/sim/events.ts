import type { CitizenId, EventKind, MemoryKind, World, WorldEvent } from '../types.ts';

/** Emit a world event: appended to the bounded log and to this tick's events. */
export function emit(
  world: World,
  kind: EventKind,
  text: string,
  actors: CitizenId[] = [],
  weight = 0.3,
  data?: Record<string, unknown>,
): WorldEvent {
  const ev: WorldEvent = { tick: world.tick, day: world.day, kind, text, actors, weight, ...(data ? { data } : {}) };
  world.events.push(ev);
  world.tickEvents.push(ev);
  const max = world.config.eventLogLength;
  if (world.events.length > max) world.events.splice(0, world.events.length - max);
  return ev;
}

/** Add an entry to a citizen's memory (bounded). */
export function remember(world: World, citizenId: CitizenId, kind: MemoryKind, text: string): void {
  const c = world.citizens[citizenId];
  if (!c) return;
  c.memory.push({ tick: world.tick, kind, text });
  const max = world.config.memoryLength;
  if (c.memory.length > max) c.memory.splice(0, c.memory.length - max);
}

/** Events from the previous day (or a given day). */
export function eventsOfDay(world: World, day: number): WorldEvent[] {
  return world.events.filter((e) => e.day === day);
}
