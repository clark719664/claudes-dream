class_name House
extends StaticBody2D
## A cottage front, composited at runtime from the pack's pieces into one image per style:
## the wall is stretched from the wall sheet's room stamps (continuous logs, boards or plaster
## framed by corner posts) to fill the whole space under the gable roof, the roof casts a
## shadow under its eaves, and the door, windows and a small attic window sit on top.
## The origin is the middle of the bottom edge (the doorstep); the image is 128 x 164 px.

const ROOFS := "Environment/Structures/Buildings/Roofs.png"
const WALLS := "Environment/Structures/Buildings/Walls.png"
const FURN := "Environment/Props/Static/Furniture.png"
const SIZE := Vector2i(128, 164)
const TOP := 12            # rows above the roof's peak, for the chimney
const WOOD_ROOF := Rect2i(0, 0, 128, 96)
const GREEN_ROOF := Rect2i(128, 0, 128, 96)

## wall: a room stamp's back wall on the wall sheet; caps: [left, right, top, bottom] pixels that
## stay fixed while the middle repeats; door and window: regions of the furniture sheet
const STYLES := {
	"log": {"wall": Rect2i(16, 8, 64, 56), "caps": [16, 16, 8, 8], "roof": WOOD_ROOF, "door": Rect2i(128, 280, 32, 40), "window": Rect2i(128, 352, 32, 32), "chimney": false},
	"plank": {"wall": Rect2i(112, 8, 64, 56), "caps": [8, 8, 8, 8], "roof": WOOD_ROOF, "door": Rect2i(160, 272, 32, 48), "window": Rect2i(64, 320, 32, 32), "chimney": true},
	"dark": {"wall": Rect2i(208, 8, 64, 56), "caps": [8, 8, 8, 8], "roof": WOOD_ROOF, "door": Rect2i(192, 272, 32, 48), "window": Rect2i(96, 352, 32, 16), "chimney": true},
	"plaster": {"wall": Rect2i(304, 8, 64, 56), "caps": [8, 8, 8, 30], "roof": GREEN_ROOF, "door": Rect2i(160, 272, 32, 48), "window": Rect2i(96, 320, 32, 32), "chimney": true},
	"brick": {"wall": Rect2i(496, 8, 64, 56), "caps": [8, 8, 8, 8], "roof": WOOD_ROOF, "door": Rect2i(192, 272, 32, 48), "window": Rect2i(32, 352, 32, 32), "chimney": true},
}
const ATTIC := Rect2i(48, 336, 16, 16)
const CHIMNEY := Rect2i(0, 320, 32, 64)

static var _fronts := {}
static var _sheets := {}

signal entered

var style := "log"
var label := ""
var is_cabin := false
var _parts: Node2D


func _init(style_name := "log", label_text := "", cabin := false) -> void:
	style = style_name
	label = label_text
	is_cabin = cabin


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(112, 92)
	shape.shape = rect
	shape.position = Vector2(0, -56)
	add_child(shape)
	add_to_group("interactable")
	rebuild(style)


func rebuild(style_name: String) -> void:
	style = style_name if STYLES.has(style_name) else "log"
	if _parts:
		_parts.queue_free()
	_parts = Node2D.new()
	add_child(_parts)
	var shadow := Pack.sprite("shadow_big")
	shadow.position = Vector2(0, -2)
	shadow.scale = Vector2(1.3, 0.9)
	shadow.z_index = -1
	_parts.add_child(shadow)
	var front := Sprite2D.new()
	front.texture = front_texture(style)
	front.centered = false
	front.offset = Vector2(-SIZE.x / 2.0, -SIZE.y)
	_parts.add_child(front)
	if STYLES[style].chimney:
		var smoke := Pack.anim_node("smoke")
		smoke.position = Vector2(36, -SIZE.y + 10)
		smoke.modulate.a = 0.75
		_parts.add_child(smoke)
	# a lantern by the door that lights up after dark
	var lamp := Pack.sprite("lantern")
	lamp.position = Vector2(26, 2)
	_parts.add_child(lamp)
	_parts.add_child(World.make_light(Color(1.0, 0.78, 0.45), 0.8, Vector2(26, -8), 72))


func interact(_player: Node) -> void:
	if is_cabin:
		entered.emit()
	else:
		Game.hud.show_dialog(label if label != "" else "House", "The door is locked. Someone's home - you can hear a kettle.")


## The composited front for a style, built once and shared by every house of that style.
static func front_texture(style_name: String) -> Texture2D:
	if _fronts.has(style_name):
		return _fronts[style_name]
	var s: Dictionary = STYLES[style_name]
	var walls := _sheet(WALLS)
	var furn := _sheet(FURN)
	var img := Image.create(SIZE.x, SIZE.y, false, Image.FORMAT_RGBA8)
	var base := SIZE.y                 # the bottom edge (doorstep line)
	var roof_y := TOP                  # the roof's top row
	# the wall fills the whole space under the roof: the gable and the front are one surface
	_stretch(walls, s.wall, s.caps, img, Rect2i(8, roof_y + 56, 112, base - roof_y - 56))
	if s.chimney:
		img.blend_rect(furn, CHIMNEY, Vector2i(84, roof_y - 12))
	var roof := _sheet(ROOFS).get_region(s.roof)
	_keep_first_run(roof)
	_eave_shadow(roof, img, roof_y)
	img.blend_rect(roof, Rect2i(Vector2i.ZERO, roof.get_size()), Vector2i(0, roof_y))
	img.blend_rect(furn, ATTIC, Vector2i(SIZE.x / 2 - ATTIC.size.x / 2, roof_y + 74))
	var door: Rect2i = s.door
	img.blend_rect(furn, door, Vector2i(SIZE.x / 2 - door.size.x / 2, base - door.size.y))
	var win: Rect2i = s.window
	var wy := base - 46 + (32 - win.size.y) / 2
	img.blend_rect(furn, win, Vector2i(18, wy))
	img.blend_rect(furn, win, Vector2i(SIZE.x - 18 - win.size.x, wy))
	var tex := ImageTexture.create_from_image(img)
	_fronts[style_name] = tex
	return tex


static func _sheet(path: String) -> Image:
	if not _sheets.has(path):
		var img := Pack.texture(path).get_image()
		if img.is_compressed():
			img.decompress()
		img.convert(Image.FORMAT_RGBA8)
		_sheets[path] = img
	return _sheets[path]


## Fill `dst` with the source region, keeping its caps and repeating its middle, so a 64 px
## stamp becomes a wall of any size without stretching pixels.
static func _stretch(src: Image, r: Rect2i, caps: Array, img: Image, dst: Rect2i) -> void:
	var l: int = caps[0]
	var rr: int = caps[1]
	var t: int = caps[2]
	var b: int = caps[3]
	var mw := r.size.x - l - rr
	var mh := r.size.y - t - b
	for ty in dst.size.y:
		var sy: int
		if ty < t:
			sy = ty
		elif ty >= dst.size.y - b:
			sy = r.size.y - (dst.size.y - ty)
		else:
			sy = t + (ty - t) % mh
		for tx in dst.size.x:
			var sx: int
			if tx < l:
				sx = tx
			elif tx >= dst.size.x - rr:
				sx = r.size.x - (dst.size.x - tx)
			else:
				sx = l + (tx - l) % mw
			var c := src.get_pixel(r.position.x + sx, r.position.y + sy)
			if c.a > 0.0:
				img.set_pixel(dst.position.x + tx, dst.position.y + ty, c)


## The roof region also catches the tip of the next roof down the sheet; keep only the first
## opaque run in each column.
static func _keep_first_run(roof: Image) -> void:
	for x in roof.get_width():
		var seen := false
		var done := false
		for y in roof.get_height():
			var solid := roof.get_pixel(x, y).a > 0.0
			if solid:
				seen = true
			elif seen:
				done = true
			if done:
				roof.set_pixel(x, y, Color(0, 0, 0, 0))


## Darken the wall for a few rows under the roof's lower edge.
static func _eave_shadow(roof: Image, img: Image, roof_y: int) -> void:
	for x in roof.get_width():
		var low := -1
		for y in range(roof.get_height() - 1, -1, -1):
			if roof.get_pixel(x, y).a > 0.0:
				low = y
				break
		if low < 0:
			continue
		for d in range(1, 7):
			var y := roof_y + low + d
			if y >= img.get_height():
				break
			var c := img.get_pixel(x, y)
			if c.a > 0.0:
				var f := 0.55 + 0.07 * d
				img.set_pixel(x, y, Color(c.r * f, c.g * f, c.b * f, c.a))
