"""Turn chosen PixelLab archive views into game sprites and icons.

Every asset in tools/curation_config.json names one archive object and ONE view. The view's PNG
is cropped to its alpha bounds, resized, written under assets/curated/ and merged into
data/catalog.json without touching gameplay fields. data/curation_provenance.json records where
each output came from. The strain overlay (data/strain_catalog.json) is merged back last.

    python tools/curate_pixellab_assets.py              curate and update the catalog
    python tools/curate_pixellab_assets.py --check      verify sources only, write nothing
    python tools/curate_pixellab_assets.py --write-index    rebuild the committed id/name index
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

GAME = Path(__file__).resolve().parents[1]
REPO = GAME.parent
ART_KEYS = ("sheet", "region", "anchor", "footprint", "door", "curated")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO).as_posix()


def build_index(archive: Path) -> dict:
    objects = {}
    for meta_path in sorted((archive / "objects").glob("*/metadata.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        views = sorted(p.stem for p in meta_path.parent.glob("original/**/rotations/*.png"))
        objects[meta["id"]] = {"name": meta.get("name", ""), "views": views}
    return {"archive": rel(archive), "objects": objects}


def view_path(archive: Path, uuid: str, view: str) -> Path | None:
    hits = sorted((archive / "objects" / uuid / "original").glob(f"**/rotations/{view}.png"))
    return hits[0] if hits else None


def alpha_box(img: Image.Image, threshold: int) -> tuple[int, int, int, int] | None:
    return img.getchannel("A").point(lambda a: 255 if a >= threshold else 0).getbbox()


def _lum(c) -> float:
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def majority(img: Image.Image, size: tuple[int, int], threshold: int) -> Image.Image:
    """Each output pixel takes the colour covering most of its source area (darker wins a near
    tie so outlines survive), and stays clear when the area is mostly empty. Same approach as
    tools/pixellab/pixelscale.py on the original branch."""
    w, h = img.size
    tw, th = size
    sx_scale, sy_scale = w / tw, h / th
    src = img.load()
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    dst = out.load()
    for ty in range(th):
        y0, y1 = ty * sy_scale, (ty + 1) * sy_scale
        for tx in range(tw):
            x0, x1 = tx * sx_scale, (tx + 1) * sx_scale
            weights: dict = {}
            clear = total = 0.0
            for sy in range(int(y0), min(h, int(y1 + 0.9999))):
                oy = min(y1, sy + 1) - max(y0, sy)
                if oy <= 0:
                    continue
                for sx in range(int(x0), min(w, int(x1 + 0.9999))):
                    ox = min(x1, sx + 1) - max(x0, sx)
                    if ox <= 0:
                        continue
                    area = ox * oy
                    total += area
                    p = src[sx, sy]
                    if p[3] < threshold:
                        clear += area
                    else:
                        weights[p[:3]] = weights.get(p[:3], 0.0) + area
            if not weights or clear > total * 0.55:
                continue
            best = max(weights.items(), key=lambda kv: (round(kv[1] * 4) / 4, -_lum(kv[0])))
            dst[tx, ty] = best[0] + (255,)
    return out


def resize(img: Image.Image, size: tuple[int, int], method: str, threshold: int) -> Image.Image:
    if size == img.size:
        return img.copy()
    if method == "nearest":
        return img.resize(size, Image.Resampling.NEAREST)
    if method == "majority":
        return majority(img, size, threshold)
    raise ValueError(f"unknown resample method {method!r}")


def target_size(spec: dict, group: dict, w: int, h: int) -> tuple[int, int]:
    if "fit" in group:
        s = min(group["fit"] / w, group["fit"] / h, 1.0)
    elif "width" in spec:
        s = spec["width"] / w
    else:
        s = float(spec.get("scale", 1.0))
    return max(1, round(w * s)), max(1, round(h * s))


def curate_one(key: str, gname: str, spec: dict, group: dict, cfg: dict, archive: Path, index: dict) -> tuple[dict, Image.Image]:
    threshold = int(cfg.get("alpha_threshold", 128))
    uuid, view = spec["uuid"], spec.get("view", "south")
    src = view_path(archive, uuid, view)
    img = Image.open(src).convert("RGBA")
    if "crop" in spec:
        img = img.crop(tuple(spec["crop"]))
    box = alpha_box(img, threshold)
    if box is None:
        raise SystemExit(f"{key}: {src} has no opaque pixels")
    cropped = img.crop(box)
    tw, th = target_size(spec, group, *cropped.size)
    method = spec.get("resample", group.get("resample", "nearest"))
    art = resize(cropped, (tw, th), method, threshold)
    sx, sy = tw / cropped.size[0], th / cropped.size[1]

    entry: dict = {}
    record: dict = {
        "key": key,
        "group": gname,
        "source": {"uuid": uuid, "name": index["objects"][uuid]["name"], "view": view, "path": rel(src), "sha256": sha256(src)},
        "crop": list(box) if "crop" not in spec else [box[0] + spec["crop"][0], box[1] + spec["crop"][1], box[2] + spec["crop"][0], box[3] + spec["crop"][1]],
        "resample": method,
        "scale": [round(sx, 4), round(sy, 4)],
    }
    if "fit" in group:
        size = group["fit"]
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(art, ((size - tw) // 2, (size - th) // 2))
        art = canvas
        entry["anchor"] = [size // 2, size // 2]
    else:
        inset = int(spec.get("base_inset", group.get("base_inset", 0)))
        ax = round((spec["door_x"] - box[0]) * sx) if "door_x" in spec else tw // 2
        entry["anchor"] = spec.get("anchor", [ax, th - inset])
        if gname == "buildings":
            fw, fh = spec.get("footprint", [round(tw * 0.82), min(round(th * 0.4), 56)])
            entry["footprint"] = {"x": round(tw / 2 - entry["anchor"][0]), "w": fw, "h": fh}
            if "door_x" in spec:
                entry["door"] = {"x": 0, "w": int(spec.get("door_w", 24))}
    entry["region"] = [0, 0, art.width, art.height]
    entry["curated"] = True
    record.update({"anchor": entry["anchor"], "footprint": entry.get("footprint"), "door": entry.get("door")})
    if spec.get("note"):
        record["note"] = spec["note"]
    return {"entry": entry, "record": record}, art


def merge(catalog: dict, section: str, key: str, entry: dict) -> None:
    if section == "sprites":
        variants = catalog["sprites"].get(key)
        if isinstance(variants, list) and variants:
            base = {k: v for k, v in variants[0].items() if k not in ART_KEYS}
            catalog["sprites"][key] = [{**base, **entry}] + variants[1:]
        else:
            catalog["sprites"][key] = [entry]
    else:
        base = {k: v for k, v in catalog["items"].get(key, {}).items() if k not in ART_KEYS}
        catalog["items"][key] = {**base, **entry}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(GAME / "tools/curation_config.json"))
    ap.add_argument("--index", help="id/name index JSON (default: the config's index, else derived from the archive)")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write-index", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    archive = (GAME / cfg["archive"]).resolve()
    index_path = Path(args.index) if args.index else GAME / cfg["index"]
    if args.write_index:
        index_path.write_text(json.dumps(build_index(archive), indent=1) + "\n", encoding="utf-8")
        print(f"wrote {rel(index_path)}")
        return 0
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else build_index(archive)

    missing, skipped, plan = [], [], []
    for gname, group in cfg["groups"].items():
        for key, spec in cfg.get(gname, {}).items():
            uuid, view = spec["uuid"], spec.get("view", "south")
            known = index["objects"].get(uuid)
            problem = None
            if known is None:
                problem = f"{uuid} is not in the archive index"
            elif spec.get("name") and not known["name"].lower().startswith(spec["name"].lower()[:24]):
                problem = f"{uuid} is {known['name']!r}, config expects {spec['name']!r}"
            elif view_path(archive, uuid, view) is None:
                problem = f"{uuid} has no {view} view"
            if problem:
                (missing if spec.get("required", True) else skipped).append(f"{gname}.{key}: {problem}")
            else:
                plan.append((gname, key, spec, group))
    for s in skipped:
        print("SKIPPED (optional)", s)
    if missing:
        for m in missing:
            print("MISSING (required)", m, file=sys.stderr)
        return 1
    print(f"{len(plan)} assets verified, {len(skipped)} optional skipped")
    if args.check:
        return 0

    catalog_path = GAME / cfg["catalog"]
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    out_root = GAME / cfg["out_dir"]
    records = []
    for gname, key, spec, group in plan:
        result, art = curate_one(key, gname, spec, group, cfg, archive, index)
        out = out_root / group["dir"] / f"{key}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        art.save(out)
        entry = {"sheet": out.relative_to(GAME / "assets").as_posix(), **result["entry"]}
        merge(catalog, group["section"], key, entry)
        rec = result["record"]
        rec["output"] = {"path": rel(out), "width": art.width, "height": art.height, "sha256": sha256(out)}
        rec["catalog"] = [f"{group['section']}.{key}"]
        records.append(rec)

    overlay = json.loads((GAME / cfg["strain_overlay"]).read_text(encoding="utf-8"))
    for section in ("sprites", "items"):
        for key, value in overlay.get(section, {}).items():
            catalog[section][key] = value
    catalog_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    for section in ("sprites", "items"):
        for key, value in overlay.get(section, {}).items():
            assert catalog[section][key] == value, f"strain overlay lost {section}.{key}"

    prov = {
        "config": rel(Path(args.config)),
        "archive": rel(archive),
        "strain_overlay_reapplied": sorted(f"{s}.{k}" for s in ("sprites", "items") for k in overlay.get(s, {})),
        "skipped_optional": skipped,
        "assets": records,
    }
    (GAME / cfg["provenance"]).write_text(json.dumps(prov, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(records)} assets, catalog and provenance; strain overlay reapplied ({len(prov['strain_overlay_reapplied'])} keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
