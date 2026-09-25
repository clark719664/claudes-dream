"""Shrinking pixel art without wrecking it.

PixelLab draws its characters about 46 px tall; the Pixel Crawler cast is about 30. A plain
nearest-neighbour shrink by 2/3 drops whole rows and columns (eyes vanish, outlines break). This
does it the way you'd do it by hand: each new pixel takes the colour that covers most of the area
it stands for (so shapes keep their mass), transparent only if the area is mostly empty, and the
silhouette gets its dark outline back afterwards."""
from PIL import Image


def _lum(c):
    return (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255.0


def shrink(img, scale):
    img = img.convert('RGBA')
    w, h = img.size
    tw, th = max(1, round(w * scale)), max(1, round(h * scale))
    src = img.load()
    out = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    dst = out.load()
    inv = 1.0 / scale
    for ty in range(th):
        y0, y1 = ty * inv, (ty + 1) * inv
        for tx in range(tw):
            x0, x1 = tx * inv, (tx + 1) * inv
            weights = {}
            clear = 0.0
            total = 0.0
            for sy in range(int(y0), min(h, int(y1 + 0.9999))):
                oy = min(y1, sy + 1) - max(y0, sy)
                if oy <= 0:
                    continue
                for sx in range(int(x0), min(w, int(x1 + 0.9999))):
                    ox = min(x1, sx + 1) - max(x0, sx)
                    if ox <= 0:
                        continue
                    a = ox * oy
                    total += a
                    p = src[sx, sy]
                    if p[3] < 128:
                        clear += a
                    else:
                        k = p[:3]
                        weights[k] = weights.get(k, 0.0) + a
            if not weights or clear > total * 0.55:
                continue
            # the colour covering most of the area; on a near tie the darker (lines read better)
            best = max(weights.items(), key=lambda kv: (round(kv[1] * 4) / 4, -_lum(kv[0])))
            dst[tx, ty] = best[0] + (255,)
    return out


def outline_colour(img):
    """The character's own line colour: the most common of its darkest opaque colours."""
    counts = {}
    for p in img.getdata():
        if p[3] >= 128:
            counts[p[:3]] = counts.get(p[:3], 0) + 1
    if not counts:
        return (20, 16, 20)
    dark = sorted(counts, key=_lum)[:max(1, len(counts) // 12)]
    return max(dark, key=lambda c: counts[c])


def reline(small, colour):
    """Put back a 1 px dark rim wherever the shrunk silhouette meets empty space."""
    w, h = small.size
    px = small.load()
    edge = []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] < 128:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h or px[nx, ny][3] < 128:
                    edge.append((x, y))
                    break
    for (x, y) in edge:
        c = px[x, y]
        if _lum(c) > _lum(colour) + 0.12:
            px[x, y] = colour + (255,)
    return small


def shrink_sprite(img, scale, line=None):
    small = shrink(img, scale)
    return reline(small, line or outline_colour(img))
