# Art & Content Brief — Prism Break

**This file is the prompt. Paste it into Gemini together with
`prism-break-source.md` (the full source bundle that ships beside it).**

---

You are the art director and gameplay designer for **Prism Break**, a finished,
playable mobile game. The complete source follows this brief. Your job is to
replace its placeholder programmer-art with a designed visual system, and to
expand its block and item roster — **without breaking the mechanic the whole
game rests on.**

Read the rest of this brief before you draw anything. The constraints in §2 are
the difference between art that ships and art that has to be thrown away.

---

## 1. What the game is

A one-thumb brick breaker on a 7-column grid. Two rules drive everything:

1. **Same colour → shatter and pierce.** Hit a block matching your ball's
   colour and it shatters whatever its health, the ball does *not* bounce, and
   it speeds up.
2. **Different colour → chip and repaint.** You chip it, you bounce, and **your
   ball becomes that colour.**

The wall hangs from the ceiling and gravity pulls blocks *upward*, so clearing a
hole makes the wall's leading edge recede away from the player. After each
volley the board collapses and groups of 5+ same-colour blocks auto-detonate in
chains.

There are five hues, and they are the game's vocabulary:

| Index | Name | Core | Glow |
| --- | --- | --- | --- |
| 0 | Ruby | `#ff4d6d` | `#ff8fa3` |
| 1 | Cyan | `#4cc9f0` | `#8ae3ff` |
| 2 | Lime | `#b5e848` | `#d8ff8a` |
| 3 | Amber | `#ffb703` | `#ffd978` |
| 4 | Violet | `#c77dff` | `#e2b8ff` |

Background is `#080a14`. Everything is drawn on an HTML5 canvas.

---

## 2. Hard constraints — read these twice

**2.1 · Colour is the mechanic, not the decoration.**
This is the constraint that kills most proposals. A player reads the board by
hue and nothing else: "am I cyan, where is the cyan". Any character art,
pattern, texture or outline that competes with hue for attention makes the game
*unplayable*, however beautiful it looks in isolation.

Concretely: every block you design must stay **instantly sortable by colour at a
glance, at arm's length, in one frame**. Detail lives in the dark ink layer and
the silhouette — never in a second competing colour. No block may carry a hue
that belongs to another block type.

**2.2 · One shape, five tints.**
The same block art is rendered in all five hues. So assets must be
**hue-agnostic** — monochrome masks, `currentColor`, or explicit paint *roles* —
never a baked-in colour. Do not deliver five coloured PNGs of the same block;
deliver one shape that gets tinted at runtime.

**2.3 · It has to read at 50 pixels.**
One cell is roughly 50×50 CSS px on a phone (up to 2.5× device pixel ratio).
Anything thinner than ~2px at that size disappears. Faces need to work at the
size of a fingernail. Test every design mentally at 50px before you commit to it.

**2.4 · Vector, not raster.**
The entire game is **23 KB gzipped with zero binary assets** — it loads
instantly, which matters enormously for a game meant to spread by link. Please
deliver **SVG path data**, not PNGs. Canvas consumes SVG paths directly via
`new Path2D(d)`, so paths drop straight into the existing renderer. Design every
path in a **100×100 coordinate box**; the renderer scales it to the cell.

**2.5 · Animation must be cheap.**
Up to ~77 blocks are on screen at 60fps alongside a particle system. Animation
must come from transforms and opacity on existing paths (a bob, a pulse, a
squash on hit, a blink), never from per-frame path regeneration or filters.

**2.6 · Respect the existing mechanics.**
Runs are turn-based volleys. Balls carry an **energy budget** — every bounce
spends one, every same-colour pierce refunds one, and the ball burns out at
zero. Gravity pulls blocks *up*. Cascades resolve *after* the volley, not
during it. Any new block or item you invent must work inside these rules; say
explicitly how yours does.

---

## 3. Deliverable A — the numberless health language

**This is the highest-priority item.** The board currently shows no digits, by
design: a player should *read* the wall, never *count* it.

The placeholder scheme in `src/game/render.ts` (`drawArmour`) is a base-4
counter drawn as dark ink over the block face:

- each **stud** (small filled dot) is worth **1**
- each **plate** (inset rounded-rect frame) is worth **4**

so health 3 is two studs, 5 is one plate, 7 is a plate and two studs, 9 is two
plates. A hit visibly strips a stud or a plate, which teaches the scheme with no
tutorial text.

It works, but it is programmer art. **Design the real one.** It must:

- cover **health 1 through 9** (9 is the game's maximum)
- make the *current* value readable at a glance at 50px — not the maximum
- **step down visibly on every hit**, so the scheme teaches itself
- sit in the dark ink layer so it never competes with hue (see §2.1)
- feel like *material toughness* — armour, crystal, plating, shell — rather than
  like a number badge. "Certain marks mean a specific number" is the goal:
  the player should end up thinking *"that one's a tough one"*, not *"that's a 7"*

Deliver: the scheme explained, a table mapping 1–9 to its marks, and SVG paths
for each mark, plus a one-line rationale for why it reads at 50px.

---

## 4. Deliverable B — block characters

Give each of the five hues a **character identity** — a face or creature that
lives on the block. Monopoly Go and Candy Crush both lean on this: a board of
faces is warmer, more screenshot-able and more marketable than a board of
squares, and faces reacting to being hit is free game feel.

Requirements:

- **five characters, one per hue**, distinguishable by *silhouette alone* — a
  colour-blind player must still tell them apart
- drawn in the **dark ink layer** over the hue, plus optional bright highlight;
  the character must never introduce a competing colour (§2.1)
- legible at 50px — think bold simple shapes, two eyes and a mouth, not detail
- **four expression states** each: `idle`, `hit` (just chipped), `scared` (this
  block is below the danger line), `gleeful` (this block is about to resonate
  and shatter)
- a personality line each, so the sticker album and store copy can use them

The characters must also coexist with the health marks from Deliverable A on the
same block face. Say how the two layers share the space.

---

## 5. Deliverable C — the block roster

Three special blocks exist today:

| Existing | Behaviour |
| --- | --- |
| **Prism** | Resonates with *every* hue and leaves the ball's colour alone. Joins a cascade group but never bridges two different colours together. |
| **Stone** | Colourless. Never resonates, never cascades. Pure health — the thing that makes a board hard. |
| **Bomb** | Coloured, 1 health, takes its 3×3 neighbourhood with it, chains into other bombs. |

**Design 8–10 more.** For each, give me:

- name, one-line fantasy, and the **exact mechanical rule** in the game's own
  terms (resonance, pierce, repaint, energy, gravity-up, cascade)
- why it creates an interesting *decision*, not just a different number
- SVG paths and how it animates
- roughly how often it should spawn, and from which wave

Directions worth exploring — the wall currently only ever *resists* the player,
so blocks that actively change how a volley routes are the gap:

- blocks that **redirect** a ball rather than stopping it (mirrors, ramps)
- blocks that **repaint** the ball to a colour of *their* choosing, not their own
- blocks that **move** between turns, or that pull neighbours with them
- blocks that punish greed — safe to leave alone, dangerous to hit
- blocks that interact with the *gravity-up* rule specifically, since that rule
  is unique to this game and currently under-exploited

Reject any idea that needs the player to read text on the block.

---

## 6. Deliverable D — playable items

Two pickups exist: `+1 Ball` and a shard bundle. They float in the grid, descend
with the wall, and are collected by a ball touching them.

**Design 8–10 more**, including the ones already asked for — **bombs and
magnets** — plus your own. For each: name, exact rule, the decision it creates,
SVG, and how the player understands what it does *without a label*.

Constraints that make or break an item here:

- a volley is **fired and then watched** — an item cannot require input
  mid-flight, because there is no input mid-flight
- items that affect the **energy budget** are especially strong, because energy
  is what limits a volley's length
- items that affect **ball colour** touch rule 2 directly — the most powerful
  lever in the game, so handle with care and say why yours is balanced
- anything that trivially clears the board kills the run's tension

Split your answer into **collect-on-contact** items (consumed instantly) and
**held items** (a charge the player spends on a later turn), and say which of
yours are which.

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
/** Paint roles are resolved at runtime from the block's hue, so art stays
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

export interface BlockArt {
  id: string;
  label: string;
  layers: ArtLayer[];
}

export interface CharacterArt {
  hue: 0 | 1 | 2 | 3 | 4;
  name: string;
  personality: string;
  states: Record<'idle' | 'hit' | 'scared' | 'gleeful', ArtLayer[]>;
}

/** Marks for exactly this health value; index 0 is unused. */
export interface ArmourArt {
  hp: number;
  layers: ArtLayer[];
}

export interface PrismBreakArt {
  blocks: BlockArt[];
  characters: CharacterArt[];
  armour: ArmourArt[];
}
```

Deliver it as a single `src/game/art.ts` exporting
`export const ART: PrismBreakArt`.

**Do not rewrite the game.** `src/game/` is deliberately DOM-free so the test
suite can auto-play thousands of waves headlessly; keep it that way. If a design
of yours needs a change to `grid.ts`, `physics.ts` or `game.ts`, describe the
change in prose and let me make it — do not hand back a rewritten simulation.

If any constraint in §2 makes an idea of yours impossible, say so plainly and
propose the nearest thing that works, rather than quietly ignoring it.
