class_name CaveRock
extends Node2D
## Rock and floor for anything underground: the Old Mine's floors and the Deepways tunnels.
##
## The pack's cliff stamp is made for rectangular plateaus; a cave winds, so its inside corners
## have no pieces and the seams show. This draws a cave the way top-down games usually do instead:
##
##   * the rock mass is the dark ceiling you can't walk on, with a faint grain;
##   * wherever floor lies to the south, the rock shows a face: the pack's seamless rock texture
##     (Wall_Variations), two tiles high, lit along its top edge and shadowed at its foot;
##   * along every other edge, a lit lip on the rock and a soft shadow on the floor;
##   * the floor is packed earth or flagstone from Floors_Tiles.
##
## `open` is one byte per tile: 0 rock, 1 earth, 2 stone floor. The tiles themselves are drawn by
## a TileMapLayer (floor) and this node's _draw (rock), so a whole cave is two nodes.

const FLOORS := "Environment/Tilesets/Floors_Tiles.png"
const FACE := "Environment/Tilesets/Wall_Variations.png"
const DIRT := [Vector2i(11, 10), Vector2i(12, 10), Vector2i(13, 10)]
const STONE := [Vector2i(6, 10), Vector2i(7, 10), Vector2i(8, 10)]
const FACE_ROWS := 2
## rock texture blocks in Wall_Variations (tile columns 0-4, three rows) per style
const STYLES := {
	"brown": {"row": 0, "ceiling": Color(0.09, 0.06, 0.05), "grain": Color(0.14, 0.1, 0.07), "lip": Color(0.55, 0.38, 0.24)},
	"grey": {"row": 10, "ceiling": Color(0.06, 0.07, 0.08), "grain": Color(0.1, 0.11, 0.13), "lip": Color(0.45, 0.5, 0.55)},
	"dark": {"row": 20, "ceiling": Color(0.05, 0.04, 0.03), "grain": Color(0.09, 0.07, 0.05), "lip": Color(0.42, 0.3, 0.16)},
}

var w := 0
var h := 0
var open := PackedByteArray()
var style := "grey"
var _face_tex: Texture2D
var _rng := RandomNumberGenerator.new()


func setup(width: int, height: int, cells: PackedByteArray, style_name := "grey", seed_ := 1) -> void:
	w = width
	h = height
	open = cells
	style = style_name if STYLES.has(style_name) else "grey"
	_rng.seed = seed_


func is_open(x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x < w and y < h and open[y * w + x] > 0


func _ready() -> void:
	z_index = -8
	_face_tex = Pack.texture(FACE)
	# the floor: earth and flagstone tiles under everything
	var ground := TileMapLayer.new()
	ground.name = "Floor"
	ground.z_index = -1
	ground.tile_set = _floor_tileset()
	for y in h:
		for x in w:
			var v := open[y * w + x]
			var pick: Array = STONE if v == 2 else DIRT
			ground.set_cell(Vector2i(x, y), 0, pick[_rng.randi() % 3])
	add_child(ground)
	_walls()
	queue_redraw()


func _draw() -> void:
	var st: Dictionary = STYLES[style]
	var row0 := int(st.row)
	var ceiling: Color = st.ceiling
	var grain: Color = st.grain
	var lip: Color = st.lip
	var shade := Color(0, 0, 0, 0.32)
	for y in h:
		for x in w:
			var p := Vector2(x, y) * 16
			if is_open(x, y):
				# soft shadow on the floor along rock to the west, east and south
				if not is_open(x - 1, y):
					draw_rect(Rect2(p, Vector2(3, 16)), shade)
				if not is_open(x + 1, y):
					draw_rect(Rect2(p + Vector2(13, 0), Vector2(3, 16)), shade)
				if not is_open(x, y + 1):
					draw_rect(Rect2(p + Vector2(0, 13), Vector2(16, 3)), shade)
				continue
			# how far below is the floor? (rock faces are two tiles tall)
			var below := 0
			for d in range(1, FACE_ROWS + 1):
				if is_open(x, y + d):
					below = d
					break
			if below > 0:
				# rock face: the pack's rock texture, darker towards the top of the wall
				var src := Rect2(((x % 5) * 16), (row0 + (y % 3)) * 16, 16, 16)
				var k := 0.62 if below == FACE_ROWS else 0.95
				draw_texture_rect_region(_face_tex, Rect2(p, Vector2(16, 16)), src, Color(k, k, k))
				if below == FACE_ROWS or not is_open(x, y + 1) and below == 1 and not _face_above(x, y):
					# the top edge of the wall: a lit lip
					draw_rect(Rect2(p, Vector2(16, 2)), lip)
				if below == 1:
					# the foot of the wall, where it meets the floor
					draw_rect(Rect2(p + Vector2(0, 14), Vector2(16, 2)), Color(0, 0, 0, 0.45))
				# the face's sides where it turns a corner
				if is_open(x - 1, y) or (below > 0 and is_open(x - 1, y + below) and not _is_face(x - 1, y)):
					draw_rect(Rect2(p, Vector2(2, 16)), Color(lip, 0.8))
				if is_open(x + 1, y) or (below > 0 and is_open(x + 1, y + below) and not _is_face(x + 1, y)):
					draw_rect(Rect2(p + Vector2(14, 0), Vector2(2, 16)), Color(0, 0, 0, 0.5))
				continue
			# the rock mass: dark, with a little grain so it isn't a flat hole
			draw_rect(Rect2(p, Vector2(16, 16)), ceiling)
			var n := (x * 7349 + y * 1931) % 11
			if n < 3:
				draw_rect(Rect2(p + Vector2(3 + n * 3, 4 + n * 2), Vector2(3, 2)), grain)
			if (x * 31 + y * 17) % 7 == 0:
				draw_rect(Rect2(p + Vector2(9, 11), Vector2(2, 2)), grain)
			# lips where the rock's top edge meets open floor on a side or below the ceiling
			if is_open(x - 1, y) or _is_face(x - 1, y):
				draw_rect(Rect2(p, Vector2(2, 16)), Color(lip, 0.55 if _is_face(x - 1, y) else 0.9))
			if is_open(x + 1, y) or _is_face(x + 1, y):
				draw_rect(Rect2(p + Vector2(14, 0), Vector2(2, 16)), Color(lip, 0.55 if _is_face(x + 1, y) else 0.9))
			if is_open(x, y - 1):
				draw_rect(Rect2(p, Vector2(16, 2)), lip)
			if _is_face(x, y + 1):
				draw_rect(Rect2(p + Vector2(0, 14), Vector2(16, 2)), lip)


func _is_face(x: int, y: int) -> bool:
	if is_open(x, y) or x < 0 or y < 0 or x >= w or y >= h:
		return false
	for d in range(1, FACE_ROWS + 1):
		if is_open(x, y + d):
			return true
	return false


func _face_above(x: int, y: int) -> bool:
	return _is_face(x, y - 1)


## Rock stops you: one box per run of rock cells in each row, plus the map's edges.
func _walls() -> void:
	var body := StaticBody2D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	for y in h:
		var x := 0
		while x < w:
			if is_open(x, y):
				x += 1
				continue
			var x0 := x
			while x < w and not is_open(x, y):
				x += 1
			var shape := CollisionShape2D.new()
			var r := RectangleShape2D.new()
			r.size = Vector2((x - x0) * 16, 16)
			shape.shape = r
			shape.position = Vector2(x0 * 16 + (x - x0) * 8, y * 16 + 8)
			body.add_child(shape)
	for r in [Rect2(-16, -16, w * 16 + 32, 16), Rect2(-16, h * 16, w * 16 + 32, 16), Rect2(-16, 0, 16, h * 16), Rect2(w * 16, 0, 16, h * 16)]:
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = r.size
		shape.shape = rect
		shape.position = r.get_center()
		body.add_child(shape)
	add_child(body)


static var _ts: TileSet


static func _floor_tileset() -> TileSet:
	if _ts:
		return _ts
	_ts = TileSet.new()
	_ts.tile_size = Vector2i(16, 16)
	var src := TileSetAtlasSource.new()
	src.texture = Pack.texture(FLOORS)
	src.texture_region_size = Vector2i(16, 16)
	for t in DIRT + STONE:
		src.create_tile(t)
	_ts.add_source(src, 0)
	return _ts
