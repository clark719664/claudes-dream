class_name House
extends StaticBody2D
## A cottage front, composited at runtime from the pack's pieces into one image per style:
## the wall is stretched from the wall sheet's room stamps (continuous logs, boards or plaster
## framed by corner posts) to fill the whole space under the gable roof, the roof casts a
## shadow under its eaves, and the door, windows and a small attic window sit on top.
## Wide buildings (taverns, stores, barns) put two gables side by side over one long wall.
## The origin is the middle of the bottom edge (the doorstep); each gable adds 128 x 164 px.

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
var door_to := ""         # a door that leads somewhere (the Deepways shafts)
var gables := 1
var _parts: Node2D


func _init(style_name := "log", label_text := "", cabin := false, gable_count := 1) -> void:
	style = style_name
	label = label_text
	is_cabin = cabin
	gables = clampi(gable_count, 1, 2)


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(128 * gables - 16, 92)
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
	shadow.scale = Vector2(1.3 * gables, 0.9)
	shadow.z_index = -1
	_parts.add_child(shadow)
	var front := Sprite2D.new()
	front.texture = front_texture(style, gables)
	front.centered = false
	front.offset = Vector2(-SIZE.x * gables / 2.0, -SIZE.y)
	_parts.add_child(front)
	if STYLES[style].chimney:
		var smoke := Pack.anim_node("smoke")
		smoke.position = Vector2(36 + (SIZE.x * gables - SIZE.x) / 2.0, -SIZE.y + 10)
		smoke.modulate.a = 0.75
		_parts.add_child(smoke)
	# the windows and the door glow after dark
	_parts.add_child(World.make_light(Color(1.0, 0.78, 0.45), 0.8, Vector2(0, -20), 80))
	if not is_cabin and label != "":
		var sign := Label.new()
		sign.text = label
		sign.add_theme_color_override("font_color", Color(1.0, 0.9, 0.7))
		sign.add_theme_color_override("font_outline_color", Color(0.12, 0.08, 0.05))
		sign.add_theme_constant_override("outline_size", 2)
		sign.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		sign.size = Vector2(160, 10)
		sign.position = Vector2(-80, -64)
		sign.visible = false
		sign.name = "NameSign"
		_parts.add_child(sign)


## Names hang over the door while you stand near it.
func _process(_delta: float) -> void:
	var sign := _parts.get_node_or_null("NameSign") if _parts else null
	if sign and Game.player:
		sign.visible = Game.player.global_position.distance_squared_to(global_position) < 56.0 * 56.0


func interact(_player: Node) -> void:
	if is_cabin or door_to != "":
		entered.emit()
	else:
		Game.hud.show_dialog(label if label != "" else "House", "The door is locked. Someone's home - you can hear a kettle.")


## The composited front for a style, built once and shared by every house of that style.
static func front_texture(style_name: String, gable_count := 1) -> Texture2D:
	var key := "%s/%d" % [style_name, gable_count]
	if _fronts.has(key):
		return _fronts[key]
	var s: Dictionary = STYLES[style_name]
	var walls := _sheet(WALLS)
	var furn := _sheet(FURN)
	var w := SIZE.x * gable_count
	var img := Image.create(w, SIZE.y, false, Image.FORMAT_RGBA8)
	var base := SIZE.y                 # the bottom edge (doorstep line)
	var roof_y := TOP                  # the roof's top row
	# the wall fills the whole space under the roofs: gables and front are one surface
	_stretch(walls, s.wall, s.caps, img, Rect2i(8, roof_y + 56, w - 16, base - roof_y - 56))
	if s.chimney:
		img.blend_rect(furn, CHIMNEY, Vector2i(w - 44, roof_y - 12))
	var roof := _sheet(ROOFS).get_region(s.roof)
	_keep_first_run(roof)
	for g in gable_count:
		_eave_shadow(roof, img, Vector2i(g * SIZE.x, roof_y))
	for g in gable_count:
		img.blend_rect(roof, Rect2i(Vector2i.ZERO, roof.get_size()), Vector2i(g * SIZE.x, roof_y))
		img.blend_rect(furn, ATTIC, Vector2i(g * SIZE.x + SIZE.x / 2 - ATTIC.size.x / 2, roof_y + 74))
	var door: Rect2i = s.door
	img.blend_rect(furn, door, Vector2i(w / 2 - door.size.x / 2, base - door.size.y))
	var win: Rect2i = s.window
	var wy := base - 46 + (32 - win.size.y) / 2
	var xs := [18, SIZE.x - 18 - win.size.x] if gable_count == 1 else [22, 80, w - 80 - win.size.x, w - 22 - win.size.x]
	for x in xs:
		img.blend_rect(furn, win, Vector2i(x, wy))
	var tex := ImageTexture.create_from_image(img)
	_fronts[key] = tex
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
static func _eave_shadow(roof: Image, img: Image, at: Vector2i) -> void:
	for x in roof.get_width():
		var low := -1
		for y in range(roof.get_height() - 1, -1, -1):
			if roof.get_pixel(x, y).a > 0.0:
				low = y
				break
		if low < 0:
			continue
		for d in range(1, 7):
			var y := at.y + low + d
			if y >= img.get_height():
				break
			var c := img.get_pixel(at.x + x, y)
			if c.a > 0.0:
				var f := 0.55 + 0.07 * d
				img.set_pixel(at.x + x, y, Color(c.r * f, c.g * f, c.b * f, c.a))
