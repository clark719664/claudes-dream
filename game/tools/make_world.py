"""Generates the world of Hearthwild as separate areas, the way Stardew splits its valley: your
farm, the market town of Brindle, the woods and hills around them. Each area is written to
data/areas/ by worldgen/export.py and loaded by the game when you walk into it.

    python3 tools/make_world.py            # every area
    python3 tools/make_world.py farm town  # just these (links are always set up in full)
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'worldgen'))
sys.path.insert(0, HERE)

import export
import farm, town, wilds, heights, east, deeps


class _M:
    def __init__(self, make, generate):
        self.make, self.generate = make, generate


MODULES = {
    'farm': farm, 'town': town,
    'pinewood': _M(wilds.make_pinewood, wilds.gen_pinewood),
    'oldwood': _M(wilds.make_oldwood, wilds.gen_oldwood),
    'riverlands': _M(wilds.make_riverlands, wilds.gen_riverlands),
    'mountain': _M(heights.make_mountain, heights.gen_mountain),
    'summit': _M(heights.make_summit, heights.gen_summit),
    'badlands': _M(east.make_badlands, east.gen_badlands),
    'stonegate': _M(east.make_stonegate, east.gen_stonegate),
    'deepways': deeps,
}

# how the areas join up: (area, side, from, to) <-> (area, side, from, to), rows or columns of
# the opening on each side
LINKS = [
    ('farm', 'E', 29, 33, 'town', 'W', 43, 47),
    ('farm', 'N', 35, 39, 'pinewood', 'S', 58, 62),
    ('farm', 'S', 15, 19, 'oldwood', 'N', 70, 74),
    ('town', 'N', 52, 56, 'mountain', 'S', 48, 52),
    ('town', 'E', 38, 42, 'badlands', 'W', 44, 48),
    ('town', 'S', 60, 64, 'riverlands', 'N', 28, 32),
    ('pinewood', 'E', 38, 42, 'mountain', 'W', 50, 54),
    ('oldwood', 'E', 50, 54, 'riverlands', 'W', 44, 48),
    ('mountain', 'N', 60, 64, 'summit', 'S', 42, 46),
    ('badlands', 'E', 38, 42, 'stonegate', 'W', 38, 42),
]


def main(only):
    areas = {k: m.make() for k, m in MODULES.items()}
    for l in LINKS:
        if l[0] in areas and l[4] in areas:
            export.link(areas, *l)
        else:
            # keep the openings even when the other side isn't built yet
            for (aid, side, lo, hi, other) in ((l[0], l[1], l[2], l[3], l[4]), (l[4], l[5], l[6], l[7], l[0])):
                if aid in areas:
                    areas[aid].gaps.append((side, lo, hi, other))
    for k, m in MODULES.items():
        if only and k not in only:
            continue
        m.generate(areas[k])
        export.write(areas[k])


if __name__ == '__main__':
    main(sys.argv[1:])
