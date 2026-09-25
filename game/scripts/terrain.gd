class_name Terrain
extends RefCounted
## The ground and the cliffs.
##
## The ground layers (water, dirt, cobblestone, grass, snow, plank decks) are fitted from the
## pack's hand-painted 5x5 ground stamps offline, by tools/terrain_bake.py, and arrive here as
## ready-made TileMapLayer data, so even a very large map loads at once. Cliffs are stretched
## at load time from the pack's 6-wide plateau stamp, one Y-sorted layer each.

const FLOORS := "Environment/Tilesets/Floors_Tiles.png"
const WATER := "Environment/Tilesets/Water_tiles.png"
const CLIFFS := "Environment/Tilesets/Wall_Tiles.png"
const CLIFF_VARIANTS := "Environment/Tilesets/Wall_Variations.png"
const FURNITURE := "Environment/Props/Static/Furniture.png"
const SRC_FLOORS := 0
const SRC_WATER := 1
const SRC_CLIFFS := 2
const SRC_CLIFF_VARIANTS := 3
const SRC_FURNITURE := 4

var rng := RandomNumberGenerator.new()


## Build the ground under `parent` and the cliffs under `sorted` (a Y-sorted node, so cliffs hide
## what stands behind them). The ground layers come ready-made from `tiles_path`, baked by
## tools/make_world.py. Returns {"bodies": collision nodes for cliffs and water, "mines":
## positions of mine entrances}.
func build(parent: Node2D, sorted: Node2D, data: Dictionary, tiles_path: String) -> Dictionary:
	rng.seed = int(data.get("seed", 1))
	var ts := _tileset()
	var bytes := FileAccess.get_file_as_bytes(tiles_path).decompress_dynamic(-1, FileAccess.COMPRESSION_DEFLATE)
	assert(bytes.slice(0, 4).get_string_from_ascii() == "HWT1", "world_tiles.bin is not a baked tile file")
	var at := 4
	for spec in [["Water", -10], ["Ground", -9], ["Cobbles", -8], ["Grass", -7], ["Snow", -6], ["Decks", -5]]:
		var n := bytes.decode_u32(at)
		at += 4
		var layer := TileMapLayer.new()
		layer.name = spec[0]
		layer.z_index = spec[1]
		layer.tile_set = ts
		layer.tile_map_data = bytes.slice(at, at + n)
		at += n
		parent.add_child(layer)
	var out := {"bodies": [_water_body(data.get("water", []))], "mines": []}
	var n := 0
	for cl in data.get("cliffs", []):
		n += 1
		var layer := TileMapLayer.new()
		layer.name = "Cliff%d" % n
		layer.tile_set = ts
		layer.y_sort_enabled = true
		sorted.add_child(layer)
		_cliff(layer, cl, out)
	return out


## Deep water stops the player: one body, one box per baked rectangle [x, y, w, h] in tiles.
static func _water_body(rects: Array) -> StaticBody2D:
	var body := StaticBody2D.new()
	body.name = "Water"
	body.collision_layer = 1
	body.collision_mask = 0
	for i in range(0, rects.size(), 4):
		var shape := CollisionShape2D.new()
		var r := RectangleShape2D.new()
		r.size = Vector2(rects[i + 2] * 16, rects[i + 3] * 16 - 4)
		shape.shape = r
		shape.position = Vector2(rects[i] * 16 + rects[i + 2] * 8, rects[i + 1] * 16 + rects[i + 3] * 8 + 2)
		body.add_child(shape)
	return body


## A raised plateau with a rock face, stretched from the pack's 6-wide cliff stamp.
## Columns: 0 | 1 | 2,3 repeated | 4 | 5. Rows: 0 | 1 | 2,3 repeated | 4 | 5 | 6 | 6,7 repeated | 7 | base.
func _cliff(layer: TileMapLayer, cl: Dictionary, out: Dictionary) -> void:
	var x0 := int(cl.x)
	var y0 := int(cl.y)
	var w := maxi(int(cl.w), 4)
	var top := maxi(int(cl.get("top", 5)), 4)
	var colour := int(cl.get("colour", 0))
	var cols := [0, 1]
	for i in w - 4:
		cols.append(2 + rng.randi() % 2)
	cols += [4, 5]
	var rows := [0, 1]
	for i in top - 4:
		rows.append(2 + rng.randi() % 2)
	rows += [4, 5, 6]
	for i in int(cl.get("face", 0)):
		rows.append(6 + rng.randi() % 2)
	rows.append(7)
	rows += {"grass": [8, 9], "snow": [10, 11], "none": [12, 13]}[cl.get("base", "grass")]
	for j in rows.size():
		for i in cols.size():
			_put(layer, Vector2i(x0 + i, y0 + j), SRC_CLIFFS, Vector2i(cols[i] + colour * 6, rows[j]))
	var h := rows.size()
	if cl.has("mine"):
		var k := int(cl.mine)
		for dx in 3:
			for dy in 4:
				_put(layer, Vector2i(x0 + k + dx, y0 + h - 4 + dy), SRC_CLIFF_VARIANTS, Vector2i(12 + dx, 6 + dy + colour * 10))
		out.mines.append(Vector2((x0 + k + 1.5) * 16, (y0 + h) * 16 - 6))
	var body := StaticBody2D.new()
	body.collision_layer = 1
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(w * 16 - 8, (h - 1) * 16 - 6)
	shape.shape = rect
	shape.position = Vector2(x0 * 16 + w * 8, y0 * 16 + 16 + rect.size.y / 2.0 - 8)
	body.add_child(shape)
	out.bodies.append(body)


## set_cell, skipping pieces that are blank on the sheet.
static func _put(layer: TileMapLayer, cell: Vector2i, source: int, at: Vector2i) -> void:
	var src := layer.tile_set.get_source(source) as TileSetAtlasSource
	if src.has_tile(at):
		layer.set_cell(cell, source, at)


func _tileset() -> TileSet:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(16, 16)
	var floors := TileSetAtlasSource.new()
	floors.texture = Pack.texture(FLOORS)
	floors.texture_region_size = Vector2i(16, 16)
	# every floor tile that has pixels: the baker may use any stamp piece or fill
	var img := floors.texture.get_image()
	if img.is_compressed():
		img.decompress()
	for y in img.get_height() / 16:
		for x in img.get_width() / 16:
			if not img.get_region(Rect2i(x * 16, y * 16, 16, 16)).is_invisible():
				floors.create_tile(Vector2i(x, y))
	ts.add_source(floors, SRC_FLOORS)
	# the water sheet holds four animation frames side by side, six tiles apart
	var water := TileSetAtlasSource.new()
	water.texture = Pack.texture(WATER)
	water.texture_region_size = Vector2i(16, 16)
	for y in 5:
		for x in 6:
			var t := Vector2i(x, y)
			water.create_tile(t)
			water.set_tile_animation_columns(t, 0)
			water.set_tile_animation_separation(t, Vector2i(5, 0))
			water.set_tile_animation_frames_count(t, 4)
			for f in 4:
				water.set_tile_animation_frame_duration(t, f, 0.16)
	ts.add_source(water, SRC_WATER)
	ts.add_source(_grid_source(CLIFFS, Rect2i(0, 0, 18, 14)), SRC_CLIFFS)
	ts.add_source(_grid_source(CLIFF_VARIANTS, Rect2i(12, 0, 3, 30)), SRC_CLIFF_VARIANTS)
	ts.add_source(_grid_source(FURNITURE, Rect2i(0, 34, 5, 5)), SRC_FURNITURE)
	return ts


## An atlas source with a plain 16x16 tile at every cell of `cells` that has any pixels.
func _grid_source(sheet: String, cells: Rect2i) -> TileSetAtlasSource:
	var src := TileSetAtlasSource.new()
	var tex := Pack.texture(sheet)
	src.texture = tex
	src.texture_region_size = Vector2i(16, 16)
	var img := tex.get_image()
	if img.is_compressed():
		img.decompress()
	for y in range(cells.position.y, cells.end.y):
		for x in range(cells.position.x, cells.end.x):
			if not img.get_region(Rect2i(x * 16, y * 16, 16, 16)).is_invisible():
				src.create_tile(Vector2i(x, y))
	return src



