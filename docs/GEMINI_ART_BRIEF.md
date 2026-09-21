# Art & Content Brief — Prism Break

**This file is the prompt. Paste it into Gemini together with
`prism-break-source.md` (the full source bundle that ships beside it).**

---

You are the art director and gameplay designer for **Prism Break**, a finished,
playable mobile puzzle game. The complete source follows this brief. Your job is
to replace its placeholder programmer-art with a designed visual system, and to
expand its tile and item roster — **without breaking the two things the game
rests on.**

Read the rest of this brief before you draw anything. The constraints in §2 are
the difference between art that ships and art that has to be thrown away.

---

## 1. What the game is

A shape-placement puzzle on an 8×8 board. You are dealt three pieces at a time
and drag them anywhere they fit. **Nothing falls, nothing bounces, nothing is on
a timer, and the board never moves on its own** — the only thing you are
fighting is space.

**One rule clears: a complete row or column.** Clearing two or three lines with
a single piece is worth far more than clearing them one at a time, and clearing
on consecutive moves builds a streak on top. That is the whole game.

There are two modes. **Levels** have an objective, a move limit, stars and a
world map. **Classic** is endless: one board, no limit, play until nothing fits.

There are five hues:

| Index | Name | Core | Glow |
| --- | --- | --- | --- |
| 0 | Ruby | `#ff4d6d` | `#ff8fa3` |
| 1 | Cyan | `#4cc9f0` | `#8ae3ff` |
| 2 | Lime | `#b5e848` | `#d8ff8a` |
| 3 | Amber | `#ffb703` | `#ffd978` |
| 4 | Violet | `#c77dff` | `#e2b8ff` |

**Colour is decoration.** It has no effect on what clears — five hues are in
play purely so a packed board stays readable, because a wall of one colour is
much harder to parse than a mixed one. This is the single most important thing
to know before you design anything, and it is what gives you room to work.

Background is `#080a14`. Everything is drawn on an HTML5 canvas.

A sticker album, packs, duplicates and gifting sit on top of both modes. None of
that needs art from you unless you want to propose it — the board is the job.

---

## 2. Hard constraints — read these twice

**2.1 · Occupied vs. empty is the read that matters.**
A player is scanning for *space*: which cells are free, which row is one tile
short, where the single-cell holes are. That read has to survive a board with 50
tiles on it, in peripheral vision, at speed.

So the contrast that must never be compromised is **filled against empty** — not
one colour against another. Decoration that softens a tile's edge, or that makes
an empty cell look occupied, breaks the game far more badly than an ugly tile
would. Keep tile silhouettes crisp and rectangular; keep empty cells quiet.

An earlier version of this brief told you colour was the mechanic. That rule has
been cut from the game: colour now carries no meaning at all. That frees you —
characters and skins can be as expressive as you like — provided §2.1 holds.

**2.2 · One shape, five tints.**
The same tile art is rendered in all five hues. Assets must be **hue-agnostic** —
monochrome masks, `currentColor`, or explicit paint *roles* — never a baked-in
colour. Do not deliver five coloured PNGs of the same tile; deliver one shape
that gets tinted at runtime.

**2.3 · It has to read at 45 pixels.**
One cell is roughly 45×45 CSS px on a phone (up to 2.5× device pixel ratio), and
tray pieces are smaller again. Anything thinner than ~2px at that size
disappears. Faces need to work at the size of a fingernail.

**2.4 · Vector, not raster.**
The whole game is **26 KB gzipped with zero binary assets** — it loads instantly,
which matters enormously for something meant to spread by link. Deliver **SVG
path data**, not PNGs. Canvas consumes SVG paths directly via `new Path2D(d)`,
so paths drop into the existing renderer. Design every path in a **100×100
coordinate box**; the renderer scales it to the cell.

**2.5 · Animation must be cheap.**
Up to 64 tiles plus a particle system run at 60fps. Animation comes from
transforms and opacity on existing paths (a settle, a pulse, a squash on clear,
a blink) — never from per-frame path regeneration or filters.

**2.6 · Never break "nothing moves unless I move it".**
This is the promise the game is built on, and the reason it feels fair. An
earlier version pushed rows down over time; it had to be cut because it shoved
tiles the player had placed. The replacement, *creep*, only ever fills cells
that were already empty. Anything you design follows the same rule: you may take
space away, you may change what a tile is, you may not relocate a tile the
player put down.

---

## 3. Deliverable A — damage by cracking

**This is the highest-priority item.** The board shows no numbers anywhere, on
purpose: a player should *read* it, never *count* it.

Obstacles (stone, crates) cannot be covered, so they are worn down by clears
going off beside them — two hits each. Their health is
shown purely as **damage**: the placeholder in `drawDamage` (`src/game/render.ts`)
draws procedural cracks that multiply as a tile takes hits, seeded from the tile
id so a given tile always breaks the same way.

**Design the real one.** It must:

- read as a **material progressively failing** — hairline, split, spiderweb,
  about to fall apart — not as a meter or a badge
- make it obvious at a glance which obstacles are nearly gone and which are
  fresh, at 45px, across a board of them
- **step visibly on every hit**, so the scheme teaches itself with no tutorial
- stay in the dark ink layer, so it never competes with hue (§2.1)
- work over stone grey, crate brown, and all five hues

Cover **two hits** at minimum, and say how the scheme would
extend if a later tile needed four or five. Give the final state — the frame
before it breaks — real weight; that is the one the player is waiting for.

---

## 4. Deliverable B — tile characters

Give each of the five hues a **character identity** — a face or creature living
on the tile. A board of faces is warmer, more screenshot-able and far more
marketable than a board of squares, and faces reacting to a clear is free game
feel.

Requirements:

- **five characters, one per hue.** Since colour means nothing mechanically,
  they exist for warmth and marketing rather than to be told apart at speed —
  but they must never blur the tile's edge or its read as *occupied* (§2.1)
- drawn in the **dark ink layer** over the hue, plus optional bright highlight
- legible at 45px — bold simple shapes, two eyes and a mouth, not detail
- **four states**: `idle`, `settling` (just placed), `doomed` (part of a line
  about to clear), `crowded` (this tile is in a nearly-full region)
- a personality line each, for the album and store copy

Say how a character shares the tile face with the crack layer from Deliverable A,
since an obstacle can be both cracked and expressive at once.

---

## 5. Deliverable C — the tile roster

Four special tiles exist today:

| Existing | Behaviour |
| --- | --- |
| **Stone** | Obstacle. Cannot be built over. Worn down by two clears going off beside it. |
| **Crate** | As stone, and visually distinct — brown rather than grey. |
| **Gem** | A bonus tile worth a lot of score, but only a line can reach one. |
| **Bomb** | Takes its 3×3 with it when a line clears it. Chains into other bombs. |

**Design 8–10 more.** For each, give me:

- name, one-line fantasy, and the **exact mechanical rule** in the game's own
  terms (placement, line clear, group clear, combo, streak, creep)
- why it creates an interesting *decision*, not just a different number
- SVG paths and how it animates
- which world it should appear in, and how often

Directions worth exploring — the board currently only ever *resists* the player,
so tiles that change how space itself behaves are the gap:

- tiles that change what counts as a line — half-width, wrapping, diagonal
- tiles that are good to keep rather than clear, so clearing is not always right
- tiles that reward placing a specific *shape* against them
- tiles that interact with **creep** — the only thing on the board that arrives
  without the player's say-so
- tiles that behave differently in **Classic** than in a level, since Classic
  has no objective and nothing but survival to play for

Reject any idea that needs the player to read text on a tile, or that moves a
tile the player placed (§2.6).

---

## 6. Deliverable D — playable items

There are no power-ups yet. This is open ground.

**Design 8–10**, including the ones already asked for — **bombs and magnets** —
plus your own. For each: name, exact rule, the decision it creates, SVG, and how
a player understands what it does *without a label*.

Constraints that make or break an item here:

- the game is turn-based and fully deterministic, and the drag preview shows
  the outcome of a placement before it is committed. An item must not make
  that preview a lie
- **space is life.** A run ends when none of the three pieces fits anywhere, so
  the most valuable thing an item can do is give room back or change what you
  have been dealt
- an item the player *holds and spends* is a second kind of move, so say
  clearly how it is triggered by touch alongside dragging a piece
- **space is the real currency.** Items that give space back (clear a region,
  remove one tile, swap the tray) are powerful; items that only add score are
  boring here
- anything that trivially empties the board kills the level's tension

Split your answer into **board tiles that act when cleared** and **held items
the player spends**, and say which of yours are which.

Also propose how items should be *earned* — the game already has Prism Shards,
a dust economy from duplicate stickers, and per-level star ratings.

---

## 7. Output format

Answer in four sections, A–D, matching the deliverables above. For each item:

1. **Design** — name, fantasy, exact mechanical rule, the decision it creates
2. **Art** — SVG path data in a 100×100 box, with a paint role per path
3. **Motion** — what animates, driven by transform/opacity only

Then a final section of **ready-to-paste TypeScript** implementing this
interface. Nothing consumes it yet — it is the contract the renderer will be
rewired to, so hold to it exactly and the wiring is mechanical:

```ts
/** Paint roles are resolved at runtime from the tile's hue, so art stays
 *  hue-agnostic (§2.2). 'core'/'glow' take the hue; 'ink' is the dark overlay
 *  that carries detail; 'rim' is a bright edge highlight. */
export type Paint = 'core' | 'glow' | 'ink' | 'rim';

export interface ArtLayer {
  /** SVG path data in a 100x100 box. Consumed via new Path2D(d). */
  d: string;
  paint: Paint;
  alpha?: number;
  /** 'fill' is the default. */
  stroke?: { width: number };
}

export interface TileArt {
  id: string;
  label: string;
  layers: ArtLayer[];
}

export interface CharacterArt {
  hue: 0 | 1 | 2 | 3 | 4;
  name: string;
  personality: string;
  states: Record<'idle' | 'settling' | 'doomed' | 'crowded', ArtLayer[]>;
}

/** Crack overlay for a tile that has taken `hits` of `capacity` damage. */
export interface DamageArt {
  hits: number;
  capacity: number;
  layers: ArtLayer[];
}

export interface PrismBreakArt {
  tiles: TileArt[];
  characters: CharacterArt[];
  damage: DamageArt[];
}
```

Deliver it as a single `src/game/art.ts` exporting
`export const ART: PrismBreakArt`.

**Do not rewrite the game.** `src/game/` is deliberately DOM-free so the test
suite can auto-play all 24 levels and dozens of Classic runs headlessly on every
change; keep it that way.
If a design of yours needs a change to `board.ts` or `game.ts`, describe the
change in prose and let me make it — do not hand back a rewritten simulation.

If any constraint in §2 makes an idea of yours impossible, say so plainly and
propose the nearest thing that works, rather than quietly ignoring it.
