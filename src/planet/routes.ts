/**
 * The roads, rivers and sea lanes between cities. Routes are found over the
 * real terrain, so a road bends around a mountain and a sea lane hugs the
 * shelf, and the travel times in docs/PLANET.md §4 follow from the path.
 */
import type { Planet } from './generate.ts';
import { leaguesBetween, type FoundedCity } from './sites.ts';

export type RouteKind = 'road' | 'river' | 'sea' | 'pass';

/** Leagues covered per tick (one city hour) by each kind of route. */
export const SPEED: Record<RouteKind, number> = { road: 8, river: 14, sea: 22, pass: 4 };

export interface Route {
  from: string;
  to: string;
  kind: RouteKind;
  /** Cell indices along the way, for drawing. */
  path: number[];
  leagues: number;
  /** Ticks for a laden traveller in fair weather. */
  ticks: number;
  /** 0..1; decays with use and weather, repaired by whoever pays. */
  condition: number;
  /** 0..1 chance per travelling tick of something going wrong. */
  hazard: number;
}

interface Node { i: number; g: number; f: number; from: number }

/** Cost of crossing one cell, in league-equivalents. Infinity means impassable. */
function stepCost(p: Planet, i: number, sea: boolean, prevElev: number): number {
  const land = p.elevation[i] > p.seaLevel;
  if (sea) {
    if (land) return Infinity;
    // Ships keep to the shelf where they can; the open ocean is faster but
    // storms are worse out there, which the hazard term below accounts for.
    return p.coastDist[i] <= 6 ? 1.0 : 1.15;
  }
  if (!land) return Infinity;
  const relief = Math.max(0.12, p.landTop - p.seaLevel);
  const alt = (p.elevation[i] - p.seaLevel) / relief;
  const climb = Math.max(0, (p.elevation[i] - prevElev) / relief);
  const wet = p.moisture[i] > 0.8 ? 0.5 : 0;                 // marsh is slow going
  // High ground is expensive enough that a road will go a long way round to
  // avoid it, which is what roads do. Only when there is no way round does the
  // path climb, and then it is a pass.
  return 1 + alt * 3.2 + Math.max(0, alt - 0.45) * 14 + climb * 30 + wet;
}

/** A* over the grid, wrapping east to west. */
function findPath(p: Planet, start: number, goal: number, sea: boolean): number[] | null {
  const open = new Map<number, Node>();
  const best = new Map<number, number>();
  const gx = goal % p.w, gy = (goal / p.w) | 0;
  const heur = (i: number): number => {
    const x = i % p.w, y = (i / p.w) | 0;
    const dx = Math.min(Math.abs(x - gx), p.w - Math.abs(x - gx));
    return Math.hypot(dx, y - gy);
  };
  open.set(start, { i: start, g: 0, f: heur(start), from: -1 });
  best.set(start, 0);
  const cameFrom = new Map<number, number>();
  let guard = p.w * p.h * 2;

  while (open.size && guard-- > 0) {
    let cur: Node | null = null;
    for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
    if (!cur) break;
    if (cur.i === goal) {
      const path = [goal];
      let at = goal;
      while (cameFrom.has(at)) { at = cameFrom.get(at) as number; path.push(at); }
      return path.reverse();
    }
    open.delete(cur.i);
    const x = cur.i % p.w, y = (cur.i / p.w) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) {
      const yy = y + dy;
      if (yy < 0 || yy >= p.h) continue;
      const j = yy * p.w + ((x + dx + p.w) % p.w);
      const diag = dx && dy ? 1.414 : 1;
      const c = stepCost(p, j, sea, p.elevation[cur.i]) * diag;
      if (!Number.isFinite(c)) continue;
      const g = cur.g + c;
      if (g < (best.get(j) ?? Infinity)) {
        best.set(j, g);
        cameFrom.set(j, cur.i);
        open.set(j, { i: j, g, f: g + heur(j), from: cur.i });
      }
    }
  }
  return null;
}

/** Nearest water cell to a coastal city, where its ships actually moor. */
function harbourOf(p: Planet, i: number): number | null {
  const x0 = i % p.w, y0 = (i / p.w) | 0;
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= p.h) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const j = y * p.w + ((x0 + dx + p.w) % p.w);
        if (p.elevation[j] <= p.seaLevel) return j;
      }
    }
  }
  return null;
}

function pathLeagues(p: Planet, path: number[]): number {
  let total = 0;
  for (let k = 1; k < path.length; k++) {
    const a = { lon: ((path[k - 1] % p.w) / p.w) * Math.PI * 2, lat: (0.5 - ((path[k - 1] / p.w | 0) + 0.5) / p.h) * Math.PI };
    const b = { lon: ((path[k] % p.w) / p.w) * Math.PI * 2, lat: (0.5 - ((path[k] / p.w | 0) + 0.5) / p.h) * Math.PI };
    total += leaguesBetween(p, a, b);
  }
  return total;
}

/** Does this land path cross high ground? Then it is a pass, not a road. */
function isPass(p: Planet, path: number[]): boolean {
  const relief = Math.max(0.12, p.landTop - p.seaLevel);
  let high = 0;
  for (const i of path) if ((p.elevation[i] - p.seaLevel) / relief > 0.58) high++;
  return high > path.length * 0.30;
}

/**
 * Connect the cities. Every pair close enough to matter gets a land route if
 * one exists, and a sea lane as well when both have harbours — which is how a
 * coastal city ends up with the cheap freight.
 */
export function buildRoutes(p: Planet, cities: FoundedCity[], maxLeagues = 2600): Route[] {
  const routes: Route[] = [];
  for (let a = 0; a < cities.length; a++) {
    for (let b = a + 1; b < cities.length; b++) {
      const A = cities[a], Bc = cities[b];
      if (leaguesBetween(p, A, Bc) > maxLeagues) continue;

      const land = findPath(p, A.y * p.w + A.x, Bc.y * p.w + Bc.x, false);
      if (land && land.length > 1) {
        const leagues = pathLeagues(p, land);
        const kind: RouteKind = isPass(p, land) ? 'pass' : 'road';
        routes.push({
          from: A.name, to: Bc.name, kind, path: land, leagues,
          ticks: Math.ceil(leagues / SPEED[kind]),
          condition: 1,
          hazard: kind === 'pass' ? 0.05 : 0.02,
        });
      }

      if (A.harbour && Bc.harbour) {
        const ha = harbourOf(p, A.y * p.w + A.x);
        const hb = harbourOf(p, Bc.y * p.w + Bc.x);
        if (ha !== null && hb !== null) {
          const sea = findPath(p, ha, hb, true);
          if (sea && sea.length > 1) {
            const leagues = pathLeagues(p, sea);
            routes.push({
              from: A.name, to: Bc.name, kind: 'sea', path: sea, leagues,
              ticks: Math.ceil(leagues / SPEED.sea),
              condition: 1,
              hazard: 0.03,
            });
          }
        }
      }
    }
  }
  return routes;
}

/** The quickest way from one city to another, by any means. */
export function fastestRoute(routes: Route[], from: string, to: string): Route | null {
  let best: Route | null = null;
  for (const r of routes) {
    const match = (r.from === from && r.to === to) || (r.from === to && r.to === from);
    if (match && (!best || r.ticks < best.ticks)) best = r;
  }
  return best;
}
