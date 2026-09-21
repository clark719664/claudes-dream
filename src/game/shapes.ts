import type { ShapeDef } from './types';

function shape(id: string, rows: string[], weight: number): ShapeDef {
  const cells: [number, number][] = [];
  rows.forEach((line, y) => {
    [...line].forEach((ch, x) => {
      if (ch !== '.') cells.push([x, y]);
    });
  });
  return {
    id,
    cells,
    w: Math.max(...rows.map((r) => r.length)),
    h: rows.length,
    weight,
  };
}

/**
 * The deal. Small pieces are common because they are what rescues a clogged
 * board; the big awkward ones are rare because they are what ends a level.
 * Every shape here is placed as a whole — nothing rotates, which keeps a move
 * to a single decision: where does this go.
 */
export const SHAPES: ShapeDef[] = [
  shape('dot', ['#'], 7),

  shape('h2', ['##'], 9),
  shape('v2', ['#', '#'], 9),
  shape('h3', ['###'], 8),
  shape('v3', ['#', '#', '#'], 8),
  shape('h4', ['####'], 5),
  shape('v4', ['#', '#', '#', '#'], 5),
  shape('h5', ['#####'], 2),
  shape('v5', ['#', '#', '#', '#', '#'], 2),

  shape('sq2', ['##', '##'], 7),
  shape('sq3', ['###', '###', '###'], 1),

  shape('Lnw', ['#.', '##'], 6),
  shape('Lne', ['.#', '##'], 6),
  shape('Lsw', ['##', '#.'], 6),
  shape('Lse', ['##', '.#'], 6),

  shape('Jnw', ['#..', '###'], 3),
  shape('Jne', ['..#', '###'], 3),
  shape('Jsw', ['###', '#..'], 3),
  shape('Jse', ['###', '..#'], 3),

  shape('Tn', ['###', '.#.'], 3),
  shape('Ts', ['.#.', '###'], 3),
  shape('Tw', ['#.', '##', '#.'], 3),
  shape('Te', ['.#', '##', '.#'], 3),

  shape('Sh', ['.##', '##.'], 2),
  shape('Zh', ['##.', '.##'], 2),
  shape('Sv', ['#.', '##', '.#'], 2),
  shape('Zv', ['.#', '##', '#.'], 2),

  shape('rect23', ['##', '##', '##'], 2),
  shape('rect32', ['###', '###'], 2),
];

export const SHAPES_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));
