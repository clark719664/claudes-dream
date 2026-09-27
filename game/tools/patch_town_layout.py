"""Give Brindle's curated buildings room to stand.

The town lots were laid out for the old pack houses and several overlap once the PixelLab
buildings stand at their real size; Pen Ridge Ranch was placed past the map's right edge. This
moves those buildings (door x, in px) and the shopkeeper who stands by each door, re-bucketing
anything that crosses into another chunk. Positions are absolute, so running it twice is safe.

    python tools/patch_town_layout.py
"""
import json
import zlib
from pathlib import Path

DAT = Path(__file__).resolve().parents[1] / "data/areas/town.dat"
DOORS = {"museum": 1000, "dispensary": 1150, "npc_house_3": 1584, "npc_house_4": 1700, "npc_house_5": 1580}
KEEPERS = {"dispensary": "Snoop", "npc_house_4": "Pen Ridge"}


def main() -> None:
    data = json.loads(zlib.decompress(DAT.read_bytes()))
    span = data["chunk"] * 16
    buildings = {}
    for key, objs in data["chunks"].items():
        for o in objs:
            if o.get("t") == "custom_building" and o.get("kind") in DOORS:
                buildings[o["kind"]] = (key, o)
    keepers = {o.get("name"): o for o in data["persistent"] if o.get("t") == "shopkeeper"}
    for kind, x in DOORS.items():
        key, o = buildings[kind]
        shift = x - o["x"]
        if kind in KEEPERS and shift:
            keepers[KEEPERS[kind]]["x"] += shift
        o["x"] = x
        new_key = "%d,%d" % (x // span, o["y"] // span)
        if new_key != key:
            data["chunks"][key].remove(o)
            data["chunks"].setdefault(new_key, []).append(o)
        print(f"{kind}: door x {x - shift} -> {x}")
    DAT.write_bytes(zlib.compress(json.dumps(data, separators=(",", ":")).encode("utf-8"), 9))


if __name__ == "__main__":
    main()
