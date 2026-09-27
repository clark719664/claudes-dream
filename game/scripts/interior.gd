class_name Interior
extends Node2D
## The inside of your house, one of the areas: rebuilt for each tier Tilda builds. Walls and
## floors come from Interior_Walls_01, furniture from Interior_Props_01.

const WALLS := "Environment/Structures/Buildings/Interior/Interior_Walls_01.png"
const PROPS := "Environment/Structures/Buildings/Interior/Interior_Props_01.png"
const ORIGIN := Vector2.ZERO

## wall style column in Interior_Walls_01, floor column, floor size in tiles, then furniture:
## [region, feet tile x, feet tile y, solid width in px, role]
## Tile rows 1-4 are the back wall, the floor starts at row 5.
const LAYOUTS := {
	"barn": {"wall": 4, "floor": 6, "w": 12, "h": 6, "props": []},
	"coop": {"wall": 0, "floor": 0, "w": 8, "h": 5, "props": []},
	"general_store": {"wall": 2, "floor": 4, "w": 20, "h": 14, "props": [
		["bookshelf", 2.2, 5.9, 28, ""], ["bookshelf", 5.4, 5.9, 28, ""], ["bookshelf", 8.6, 5.9, 28, ""], ["bookshelf", 12.0, 5.9, 28, ""],
		["bookshelf", 3.0, 8.3, 28, ""], ["bookshelf", 7.0, 8.3, 28, ""], ["bookshelf", 11.0, 8.3, 28, ""],
		["tavern_table", 4.6, 12.0, 22, ""], ["tavern_table", 10.0, 12.0, 22, ""], ["tavern_table", 13.4, 12.0, 22, ""],
		["store_counter", 10.5, 10.8, 52, ""], ["store_counter", 18.0, 8.7, 34, ""],
		["wood_stool", 8.8, 11.0, 0, ""], ["wood_stool", 12.3, 11.0, 0, ""],
		["rug", 10.5, 17.1, 0, "rug"], ["floor_lamp", 2.0, 12.4, 6, ""], ["floor_lamp", 18.5, 12.4, 6, ""],
		["house_plant", 2.0, 18.2, 10, ""], ["house_plant", 19.0, 18.2, 10, ""]],
		"partitions": [[[15, 5], [15, 7]], [[15, 9], [15, 10]], [[16, 10], [20, 10]]]},
	"saloon": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["tavern_bar", 6.0, 6.6, 68, ""], ["tavern_table", 2.8, 9.6, 22, ""], ["tavern_table", 9.2, 9.6, 22, ""],
		["wood_stool", 1.5, 9.8, 0, ""], ["wood_stool", 4.1, 9.8, 0, ""], ["wood_stool", 7.9, 9.8, 0, ""], ["wood_stool", 10.5, 9.8, 0, ""],
		["floor_lamp", 1.4, 6.0, 6, ""], ["house_plant", 10.5, 12.4, 10, ""]]},
	"blacksmith_shop": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["forge_anvil", 6.0, 8.4, 26, ""], ["wood_stool", 8.2, 8.6, 0, ""], ["house_plant", 1.6, 12.4, 10, ""]]},
	"library": {"wall": 2, "floor": 4, "w": 22, "h": 14, "props": [
		["bookshelf", 2.0, 5.9, 28, ""], ["bookshelf", 5.0, 5.9, 28, ""], ["bookshelf", 8.0, 5.9, 28, ""], ["bookshelf", 11.0, 5.9, 28, ""], ["bookshelf", 14.0, 5.9, 28, ""],
		["bookshelf", 2.0, 9.2, 28, ""], ["bookshelf", 5.0, 9.2, 28, ""], ["bookshelf", 8.0, 9.2, 28, ""], ["bookshelf", 11.0, 9.2, 28, ""],
		["bookshelf", 18.2, 5.9, 28, ""], ["bookshelf", 20.5, 5.9, 28, ""], ["bookshelf", 18.2, 8.2, 28, ""], ["bookshelf", 20.5, 8.2, 28, ""],
		["library_desk", 7.0, 14.5, 40, ""], ["library_desk", 13.2, 14.5, 40, ""],
		["tavern_table", 10.0, 11.7, 22, ""], ["wood_stool", 8.2, 11.9, 0, ""], ["wood_stool", 11.8, 11.9, 0, ""],
		["rug", 10.5, 17.0, 0, "rug"], ["rug", 19.0, 11.7, 0, "rug"],
		["floor_lamp", 3.0, 14.5, 6, ""], ["floor_lamp", 16.0, 14.5, 6, ""],
		["house_plant", 2.0, 18.1, 10, ""], ["house_plant", 21.0, 18.1, 10, ""]],
		"partitions": [[[17, 5], [17, 7]], [[17, 9], [17, 10]], [[18, 10], [22, 10]]]},
	"dispensary": {"wall": 3, "floor": 5, "w": 8, "h": 6, "props": [
		["counter", 5.0, 7.0, 40, ""], ["house_plant", 1.6, 6.3, 10, ""], ["house_plant", 8.4, 6.3, 10, ""]]},
	"clinic": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["clinic_bed", 2.6, 7.6, 26, ""], ["clinic_bed", 9.4, 7.6, 26, ""], ["house_plant", 6.0, 6.3, 10, ""],
		["floor_lamp", 1.4, 12.4, 6, ""], ["house_plant", 10.5, 12.4, 10, ""]]},
	"school": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["school_desk", 3.0, 8.0, 20, ""], ["school_desk", 6.0, 8.0, 20, ""], ["school_desk", 9.0, 8.0, 20, ""],
		["school_desk", 3.0, 10.4, 20, ""], ["school_desk", 9.0, 10.4, 20, ""], ["bookshelf", 2.0, 5.9, 28, ""], ["house_plant", 10.4, 6.3, 10, ""]]},
	"church": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["church_pew", 3.4, 7.8, 44, ""], ["church_pew", 8.6, 7.8, 44, ""], ["church_pew", 3.4, 10.2, 44, ""], ["church_pew", 8.6, 10.2, 44, ""],
		["house_plant", 1.5, 6.3, 10, ""], ["house_plant", 10.5, 6.3, 10, ""]]},
	"bathhouse": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["bathhouse_pool", 6.0, 10.6, 0, "bathhouse_pool"], ["house_plant", 1.5, 6.3, 10, ""], ["house_plant", 10.5, 6.3, 10, ""],
		["wood_stool", 1.6, 12.4, 0, ""]]},
	"museum": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["museum_display", 3.0, 7.2, 24, ""], ["museum_display", 6.0, 7.2, 24, ""], ["museum_display", 9.0, 7.2, 24, ""],
		["museum_display", 3.0, 10.2, 24, ""], ["museum_display", 9.0, 10.2, 24, ""], ["house_plant", 1.5, 12.4, 10, ""], ["house_plant", 10.5, 12.4, 10, ""]]},
	"inn": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["inn_bed", 2.4, 7.8, 30, ""], ["inn_bed", 9.6, 7.8, 30, ""], ["tavern_table", 6.0, 7.4, 22, ""],
		["floor_lamp", 4.2, 6.0, 6, ""], ["floor_lamp", 7.8, 6.0, 6, ""], ["rug", 6.0, 10.4, 0, "rug"], ["house_plant", 10.5, 12.4, 10, ""]]},
	"mayors_manor": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["bookshelf", 2.0, 5.9, 28, ""], ["bookshelf", 3.9, 5.9, 28, ""], ["library_desk", 6.6, 7.8, 40, ""], ["floor_lamp", 9.0, 6.0, 6, ""],
		["house_plant", 10.4, 6.3, 10, ""], ["rug", 6.0, 10.4, 0, "rug"], ["house_plant", 1.5, 12.4, 10, ""]]},
	"npc_house_1": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["cozy_bed", 2.4, 7.8, 26, ""], ["tavern_table", 7.6, 8.8, 22, ""], ["wood_stool", 6.2, 9.0, 0, ""], ["wood_stool", 9.0, 9.0, 0, ""],
		["bookshelf", 10.0, 5.9, 28, ""], ["rug", 6.0, 11.0, 0, "rug"], ["house_plant", 10.5, 12.4, 10, ""]]},
	"npc_house_2": {"wall": 2, "floor": 4, "w": 10, "h": 8, "props": [
		["cozy_bed", 9.6, 7.8, 26, ""], ["tavern_table", 3.6, 8.8, 22, ""], ["wood_stool", 2.2, 9.0, 0, ""], ["wood_stool", 5.0, 9.0, 0, ""],
		["floor_lamp", 1.4, 6.0, 6, ""], ["house_plant", 1.5, 12.4, 10, ""]]},
	1: {"wall": 0, "floor": 0, "w": 9, "h": 5, "props": [
		[Rect2(64, 176, 32, 32), 3.0, 3.4, 0, ""],             # window
		[Rect2(0, 288, 32, 64), 1.5, 8.6, 26, "bed"],
		[Rect2(272, 0, 48, 48), 7.0, 5.9, 40, ""],             # wardrobe
		[Rect2(80, 0, 32, 32), 5.6, 7.6, 24, ""],              # round table
		[Rect2(64, 0, 16, 32), 4.3, 7.4, 0, ""],               # chair
		[Rect2(432, 304, 80, 80), 5.2, 10.1, 0, "rug"],
		[Rect2(32, 352, 16, 32), 9.3, 9.8, 10, ""],            # plant
		[Rect2(128, 128, 32, 16), 8.6, 7.6, 0, ""],            # bucket
	]},
	2: {"wall": 12, "floor": 10, "w": 13, "h": 6, "props": [
		[Rect2(64, 176, 32, 32), 3.0, 3.4, 0, ""],
		[Rect2(64, 176, 32, 32), 9.0, 3.4, 0, ""],
		[Rect2(32, 288, 48, 64), 2.0, 9.6, 40, "bed"],
		[Rect2(384, 48, 48, 96), 6.0, 5.9, 44, "fire"],        # brick oven / fireplace
		[Rect2(176, 0, 48, 64), 11.0, 5.9, 44, "kitchen"],     # big stove
		[Rect2(368, 0, 64, 48), 12.6, 7.6, 0, ""],             # counter
		[Rect2(0, 0, 64, 32), 8.0, 9.4, 58, ""],               # long table
		[Rect2(64, 0, 16, 32), 5.8, 9.2, 0, ""],
		[Rect2(64, 0, 16, 32), 10.2, 9.2, 0, ""],
		[Rect2(0, 160, 48, 32), 8.0, 11.4, 0, "rug"],
		[Rect2(48, 96, 48, 48), 3.6, 5.9, 44, ""],             # bookshelf
		[Rect2(64, 352, 16, 32), 13.2, 11.2, 10, ""],
		[Rect2(16, 352, 16, 32), 1.4, 11.2, 10, ""],
		[Rect2(96, 256, 32, 16), 8.0, 2.6, 0, ""],             # sword on the wall
	]},
	3: {"wall": 18, "floor": 15, "w": 17, "h": 7, "props": [
		[Rect2(64, 176, 32, 32), 3.0, 3.4, 0, ""],
		[Rect2(64, 176, 32, 32), 8.5, 3.4, 0, ""],
		[Rect2(64, 176, 32, 32), 14.5, 3.4, 0, ""],
		[Rect2(32, 288, 48, 64), 2.0, 9.6, 40, "bed"],
		[Rect2(128, 144, 48, 32), 2.2, 12.1, 44, ""],          # bathtub
		[Rect2(272, 48, 48, 96), 6.0, 5.9, 44, "fire"],        # stone fireplace
		[Rect2(176, 0, 48, 64), 12.4, 5.9, 44, "kitchen"],
		[Rect2(112, 224, 112, 32), 15.8, 7.4, 0, ""],          # kitchen counter with sink
		[Rect2(112, 64, 32, 32), 9.4, 6.3, 28, "alchemy"],     # desk used as alchemy bench
		[Rect2(0, 0, 64, 32), 11.0, 10.4, 58, ""],
		[Rect2(64, 0, 16, 32), 8.8, 10.2, 0, ""],
		[Rect2(64, 0, 16, 32), 13.2, 10.2, 0, ""],
		[Rect2(432, 304, 80, 80), 11.0, 12.9, 0, "rug"],
		[Rect2(336, 336, 48, 48), 5.6, 11.8, 0, "rug"],
		[Rect2(80, 304, 48, 32), 6.0, 9.2, 40, ""],            # sofa
		[Rect2(544, 0, 16, 16), 11.6, 3.2, 0, ""],             # wolf trophy
		[Rect2(128, 272, 16, 16), 7.3, 3.3, 0, ""],            # shield on the wall
		[Rect2(192, 256, 32, 32), 5.0, 3.6, 0, ""],            # blackboard
		[Rect2(64, 352, 16, 32), 17.2, 11.9, 10, ""],
		[Rect2(48, 352, 16, 32), 16.2, 12.0, 10, ""],
		[Rect2(16, 352, 16, 32), 4.4, 12.0, 10, ""],
		[Rect2(272, 0, 48, 48), 15.6, 5.9, 40, ""],
	]},
}
const POTIONS := [Rect2(528, 288, 16, 16), Rect2(560, 304, 16, 16), Rect2(576, 320, 16, 16)]

var tier: Variant = 1
var w := 9
var h := 5
var props_root: Node2D
var _tiles: TileMapLayer
var _body: StaticBody2D


func _ready() -> void:
	position = ORIGIN


## Floor area in global coordinates, handy for the camera.
func room_rect() -> Rect2:
	return Rect2(ORIGIN, Vector2((w + 2) * 16, (h + 6) * 16))


## Where you wake up: beside the bed.
func bed_spot() -> Vector2:
	for p in LAYOUTS[tier].props:
		if p[4] == "bed":
			return ORIGIN + Vector2(p[1] + 1.9, p[2] - 0.3) * 16.0
	return door_inside() + Vector2(0, -40)


func door_inside() -> Vector2:
	return ORIGIN + Vector2((w + 2) * 8, (h + 5) * 16 - 2)


func exit_line() -> float:
	return ORIGIN.y + (h + 5) * 16 + 10


func build(tier_, sorted_parent: Node2D) -> void:
	tier = tier_ if tier_ is String and LAYOUTS.has(tier_) else clampi(int(tier_), 1, 3)
	var lay: Dictionary = LAYOUTS[tier]
	w = lay.w
	h = lay.h
	for c in get_children():
		c.queue_free()
	if props_root:
		props_root.queue_free()
	_tiles = TileMapLayer.new()
	_tiles.z_index = -9
	_tiles.tile_set = _tileset()
	add_child(_tiles)
	var sc: int = lay.wall
	var mid := (w + 2) / 2
	# back wall with its top trim, one wall-top beam above it
	for i in w:
		var col := 1 if i == 0 else (4 if i == w - 1 else 2 + i % 2)
		_put(Vector2i(1 + i, 0), Vector2i(sc + col, 0))
		for k in 4:
			_put(Vector2i(1 + i, 1 + k), Vector2i(sc + col, 5 + k))
	# floor
	var fc: int = lay.floor
	for y in h:
		for x in w:
			_put(Vector2i(1 + x, 5 + y), Vector2i(fc + x % 5, 20 + y % 5))
	# side beams and the bottom beam with a doorway gap
	for y in h + 6:
		_put(Vector2i(0, y), Vector2i(sc, 2 + y % 2))
		_put(Vector2i(w + 1, y), Vector2i(sc + 5, 2 + y % 2))
	for i in w:
		if i + 1 == mid or i + 1 == mid - 1:
			_put(Vector2i(1 + i, 5 + h), Vector2i(fc + i % 5, 20 + (h) % 5))
			continue
		_put(Vector2i(1 + i, 5 + h), Vector2i(sc + 2 + i % 2, 0))
	_body = StaticBody2D.new()
	_body.collision_layer = 1
	add_child(_body)
	for partition in lay.get("partitions", []):
		var a := Vector2i(partition[0][0], partition[0][1])
		var b := Vector2i(partition[1][0], partition[1][1])
		if a.x == b.x:
			var top := mini(a.y, b.y)
			var bottom := maxi(a.y, b.y)
			for y in range(top, bottom + 1):
				_put(Vector2i(a.x, y), Vector2i(sc + 2, 5))
			_rect(Rect2(a.x * 16.0, top * 16.0, 16.0, (bottom - top + 1) * 16.0))
		elif a.y == b.y:
			var left := mini(a.x, b.x)
			var right := maxi(a.x, b.x)
			for x in range(left, right + 1):
				_put(Vector2i(x, a.y), Vector2i(sc + 2, 5))
			_rect(Rect2(left * 16.0, a.y * 16.0, (right - left + 1) * 16.0, 16.0))

	var W := (w + 2) * 16.0
	var floor_bottom := (5 + h) * 16.0
	_rect(Rect2(0, 0, W, 86))
	_rect(Rect2(0, 0, 16, floor_bottom + 16))
	_rect(Rect2(W - 16, 0, 16, floor_bottom + 16))
	_rect(Rect2(16, floor_bottom, (mid - 2) * 16, 16))
	_rect(Rect2((mid + 1) * 16, floor_bottom, W - (mid + 2) * 16, 16))
	# furniture joins the world's Y-sorted layer so the player walks behind and in front of it
	props_root = Node2D.new()
	props_root.name = "CabinProps"
	props_root.y_sort_enabled = true
	props_root.position = ORIGIN
	sorted_parent.add_child(props_root)
	for p in lay.props:
		_furniture(p[0], Vector2(p[1], p[2]) * 16.0, float(p[3]), p[4])


func _furniture(region, feet: Vector2, solid: float, role: String) -> void:
	var node: Node2D
	if role in ["bed", "kitchen", "alchemy", "bathhouse_pool"]:
		node = CabinFixture.new(role)
	else:
		node = Node2D.new()
	node.position = feet
	var sp := Sprite2D.new()
	var sz = Vector2()
	var feet_at := Vector2.ZERO
	if typeof(region) == TYPE_STRING:
		var d := Pack.spec(region)
		sp.texture = Pack.atlas(d)
		sz = sp.texture.get_size()
		feet_at = Vector2(d.anchor[0], d.anchor[1]) if d.has("anchor") else Vector2(sz.x / 2.0, sz.y)
	else:
		var t := AtlasTexture.new()
		t.atlas = Pack.texture(PROPS)
		t.region = region
		sp.texture = t
		sz = region.size
		feet_at = Vector2(sz.x / 2.0, sz.y)
	sp.centered = false
	sp.offset = -feet_at
	if role == "rug":
		sp.z_index = -8
		sp.offset = Vector2(-sz.x / 2.0, -sz.y / 2.0)
		add_child(sp)
		sp.position = feet
		return
	node.add_child(sp)
	if role == "alchemy":
		for i in POTIONS.size():
			var pt := AtlasTexture.new()
			pt.atlas = Pack.texture(PROPS)
			pt.region = POTIONS[i]
			var ps := Sprite2D.new()
			ps.texture = pt
			ps.position = Vector2(-9 + i * 8, -26)
			node.add_child(ps)
	if solid > 0:
		var body := StaticBody2D.new()
		body.collision_layer = 1
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = Vector2(solid, 10)
		shape.shape = rect
		shape.position = Vector2(0, -5)
		body.add_child(shape)
		node.add_child(body)
	if role in ["fire", "kitchen", "chandelier"]:
		node.add_child(World.make_light(Color(1.0, 0.62, 0.32), 1.0, Vector2(0, -20), 96))
	props_root.add_child(node)


func _rect(r: Rect2) -> void:
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = r.size
	shape.shape = rect
	shape.position = r.get_center()
	_body.add_child(shape)


func _put(cell: Vector2i, at: Vector2i) -> void:
	var src := _tiles.tile_set.get_source(0) as TileSetAtlasSource
	if src.has_tile(at):
		_tiles.set_cell(cell, 0, at)


static var _ts: TileSet

func _tileset() -> TileSet:
	if _ts:
		return _ts
	_ts = TileSet.new()
	_ts.tile_size = Vector2i(16, 16)
	var src := TileSetAtlasSource.new()
	var tex := Pack.texture(WALLS)
	src.texture = tex
	src.texture_region_size = Vector2i(16, 16)
	var img := tex.get_image()
	if img.is_compressed():
		img.decompress()
	for y in 25:
		for x in 24:
			if y > 13 and y < 20:
				continue
			if not img.get_region(Rect2i(x * 16, y * 16, 16, 16)).is_invisible():
				src.create_tile(Vector2i(x, y))
	_ts.add_source(src, 0)
	return _ts
