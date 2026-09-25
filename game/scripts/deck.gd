class_name Deck
extends Node2D
## Plank bridges and piers. The pack's deck stamp has ragged post-ends on every side, so instead
## of stretching it we take a clean block of its boards and lay them over the whole deck: boards
## across the direction of travel, a dark rim on the open sides, the deck's shadow on the water
## and pilings under the edge. Railings are separate props (rope and posts), placed by the map.
##
## kind: "bridge_ew" (cross east-west: boards run north-south), "bridge_ns" or "pier" (boards run
## east-west; a pier's far, southern end is open water). The origin is the deck's top-left.

const SHEET := "Environment/Props/Static/Furniture.png"
const BOARDS := Rect2i(12, 562, 48, 40)      # five clean boards, 8 px each
const RIM := Color(0.16, 0.1, 0.07)
const PILE := Color(0.27, 0.17, 0.1)

static var _cache := {}

var kind := "pier"
var tiles := Vector2i(2, 4)


func _init(kind_: String, w: int, h: int) -> void:
	kind = kind_
	tiles = Vector2i(w, h)


func _ready() -> void:
	z_index = -5
	var sp := Sprite2D.new()
	sp.centered = false
	sp.texture = _texture(kind, tiles)
	add_child(sp)


static func _texture(k: String, t: Vector2i) -> Texture2D:
	var key := "%s/%d/%d" % [k, t.x, t.y]
	if _cache.has(key):
		return _cache[key]
	var src := Pack.texture(SHEET).get_image()
	if src.is_compressed():
		src.decompress()
	src.convert(Image.FORMAT_RGBA8)
	var boards := src.get_region(BOARDS)
	if k == "bridge_ew":
		boards.rotate_90(CLOCKWISE)
	var w := t.x * 16
	var h := t.y * 16
	var img := Image.create(w, h + 8, false, Image.FORMAT_RGBA8)
	var bw := boards.get_width()
	var bh := boards.get_height()
	for y in range(0, h, bh):
		for x in range(0, w, bw):
			img.blit_rect(boards, Rect2i(0, 0, mini(bw, w - x), mini(bh, h - y)), Vector2i(x, y))
	# rims along the open sides
	var open_top := false
	var open_bottom := k != "bridge_ns"
	var open_sides := k != "bridge_ew"
	if k == "bridge_ew":
		open_top = true
	for x in w:
		if open_top:
			img.set_pixel(x, 0, RIM)
		if open_bottom:
			img.set_pixel(x, h - 1, RIM)
			img.set_pixel(x, h - 2, _shade(img.get_pixel(x, h - 2), 0.7))
	if open_sides:
		for y in h:
			img.set_pixel(0, y, RIM)
			img.set_pixel(w - 1, y, RIM)
			img.set_pixel(1, y, _shade(img.get_pixel(1, y), 0.75))
			img.set_pixel(w - 2, y, _shade(img.get_pixel(w - 2, y), 0.75))
	# the deck's shadow on the water, and pilings under the open bottom edge
	if open_bottom:
		for x in w:
			for d in 4:
				img.set_pixel(x, h + d, Color(0, 0, 0, 0.28 - d * 0.06))
		var step := 32 if k == "pier" else 48
		var xs := range(6, w - 8, step)
		xs.append(w - 10)
		for px in xs:
			for yy in range(h, h + 7):
				for xx in range(px, px + 4):
					img.set_pixel(xx, yy, PILE if xx > px and xx < px + 3 else RIM)
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


static func _shade(c: Color, f: float) -> Color:
	return Color(c.r * f, c.g * f, c.b * f, c.a)
