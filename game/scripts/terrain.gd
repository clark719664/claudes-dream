class_name Terrain
extends RefCounted
## Turns the character grid in world.json into autotiled TileMapLayers.
##
## The Pixel Crawler floor sheet draws each ground type as a hand-painted 5x5 "stamp"
## (grass around a hole, cobbles around a hole, a grass island in animated water).
## Those stamps hold every edge and corner piece, so we can tile any shape with them:
##   * grass and cobblestone are cell based: a cell of the material picks the piece whose
##     rim faces its open neighbours (13 pieces, like a reduced 47-blob set)
##   * water is corner based ("dual grid"): each tile is chosen from the land/water state
##     of its four corners (14 pieces; checkerboard corners are never produced)
## Shapes the stamps can't draw (1-wide grass strips and so on) are opened up automatically.

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

enum { GRASS, DIRT, STONE }

# piece -> positions inside a 5x5 stamp (identical layout for grass and cobblestone)
const RING := {
	"S": [Vector2i(2, 0)], "N": [Vector2i(2, 4)], "E": [Vector2i(0, 2)], "W": [Vector2i(4, 2)],
	"ES": [Vector2i(1, 1)], "WS": [Vector2i(3, 1)], "NE": [Vector2i(1, 3)], "NW": [Vector2i(3, 3)],
	"iSE": [Vector2i(1, 0), Vector2i(0, 1)], "iSW": [Vector2i(3, 0), Vector2i(4, 1)],
	"iNE": [Vector2i(0, 3), Vector2i(1, 4)], "iNW": [Vector2i(4, 3), Vector2i(3, 4)],
}
const GRASS_STAMPS := [Vector2i(0, 0), Vector2i(0, 5)]
const STONE_STAMPS := [Vector2i(5, 0), Vector2i(5, 5)]
const SNOW_STAMPS := [Vector2i(0, 12), Vector2i(0, 17)]
const SNOW_FILL := [Vector2i(0, 22), Vector2i(1, 22), Vector2i(2, 22), Vector2i(3, 22), Vector2i(4, 22), Vector2i(0, 23), Vector2i(1, 23), Vector2i(2, 23), Vector2i(3, 23), Vector2i(4, 23)]
const GRASS_FILL := [Vector2i(1, 10), Vector2i(2, 10), Vector2i(3, 10)]
const DIRT_FILL := [Vector2i(11, 10), Vector2i(12, 10), Vector2i(13, 10)]
const STONE_FILL := [Vector2i(6, 10), Vector2i(7, 10), Vector2i(8, 10)]
# corners TL TR BL BR, 1 = land
const SHORE := {
	"0001": [Vector2i(1, 0), Vector2i(0, 1)], "0010": [Vector2i(3, 0), Vector2i(4, 1)], "0011": [Vector2i(2, 0)],
	"0100": [Vector2i(0, 3), Vector2i(1, 4)], "0101": [Vector2i(0, 2)], "0111": [Vector2i(1, 1)],
	"1000": [Vector2i(4, 3), Vector2i(3, 4)], "1010": [Vector2i(4, 2)], "1011": [Vector2i(3, 1)],
	"1100": [Vector2i(2, 4)], "1101": [Vector2i(1, 3)], "1110": [Vector2i(3, 3)],
	"1111": [Vector2i(2, 1), Vector2i(1, 2), Vector2i(2, 2), Vector2i(3, 2), Vector2i(2, 3)],
}
const WATER_PLAIN := [Vector2i(5, 2), Vector2i(5, 3), Vector2i(0, 4), Vector2i(5, 4)]
const WATER_RIPPLE := [Vector2i(0, 0), Vector2i(4, 0), Vector2i(5, 0), Vector2i(5, 1), Vector2i(4, 4)]
const D8 := [Vector2i(-1, -1), Vector2i(0, -1), Vector2i(1, -1), Vector2i(-1, 0), Vector2i(1, 0), Vector2i(-1, 1), Vector2i(0, 1), Vector2i(1, 1)]
# bit per neighbour, same order as D8
const B_NW := 1
const B_N := 2
const B_NE := 4
const B_W := 8
const B_E := 16
const B_SW := 32
const B_S := 64
const B_SE := 128

var width := 0
var height := 0
var mat := PackedByteArray()        # material per cell
var shore := PackedByteArray()      # 1 if any corner of the cell is water
var snow := PackedByteArray()       # 1 if the cell is covered in snow
var vwater := PackedByteArray()     # water per corner (width+1 x height+1)
var rng := RandomNumberGenerator.new()
var _floors_img: Image
var _edges := {}


## Build the ground under `parent` and the cliffs under `sorted` (a Y-sorted node, so cliffs hide
## what stands behind them). Returns {"blocked": cells that stop movement, "bodies": collision
## nodes for cliffs, "mines": positions of mine entrances}.
func build(parent: Node2D, sorted: Node2D, data: Dictionary) -> Dictionary:
	var rows := PackedStringArray(data.terrain)
	rng.seed = int(data.get("seed", 1))
	height = rows.size()
	width = rows[0].length()
	_solve(rows)
	var ts := _tileset()
	var layers := {}
	for spec in [["Water", -10], ["Ground", -9], ["Cobbles", -8], ["Grass", -7], ["Snow", -6], ["Decks", -5]]:
		var layer := TileMapLayer.new()
		layer.name = spec[0]
		layer.z_index = spec[1]
		layer.tile_set = ts
		parent.add_child(layer)
		layers[spec[0]] = layer
	var blocked := {}
	for y in height:
		for x in width:
			var c := Vector2i(x, y)
			if shore[_i(x, y)]:
				var key := _corner_key(x, y)
				var at: Vector2i
				if key == "0000":
					at = _pick(WATER_PLAIN) if rng.randf() < 0.9 else _pick(WATER_RIPPLE)
				else:
					at = _pick(SHORE[key])
				layers.Water.set_cell(c, SRC_WATER, at)
				if key.count("0") >= 3:
					blocked[c] = true
				continue
			var m := mat[_i(x, y)]
			if m == STONE:
				var r := role(_mask(x, y, DIRT))
				if r == "full":
					layers.Ground.set_cell(c, SRC_FLOORS, _pick(STONE_FILL))
				else:
					layers.Ground.set_cell(c, SRC_FLOORS, _pick(DIRT_FILL))
					layers.Cobbles.set_cell(c, SRC_FLOORS, _variant(r, STONE_STAMPS, layers.Cobbles, c))
			elif m == DIRT:
				layers.Ground.set_cell(c, SRC_FLOORS, _pick(DIRT_FILL))
			else:
				# grass: the ground under its rim is whatever open material it borders
				var under := _open_neighbour(x, y)
				if under == DIRT:
					layers.Ground.set_cell(c, SRC_FLOORS, _pick(DIRT_FILL))
				elif under == STONE:
					layers.Ground.set_cell(c, SRC_FLOORS, _pick(STONE_FILL))
				var gr := role(_mask(x, y, -1))
				if gr == "full":
					layers.Grass.set_cell(c, SRC_FLOORS, _pick(GRASS_FILL))
				else:
					layers.Grass.set_cell(c, SRC_FLOORS, _variant(gr, GRASS_STAMPS, layers.Grass, c))
			# snow lies on top: snow cells are filled, their neighbours carry the drifted rims
			if snow[_i(x, y)]:
				layers.Snow.set_cell(c, SRC_FLOORS, _pick(SNOW_FILL))
			else:
				var sr := role(_snow_mask(x, y))
				if sr != "full":
					layers.Snow.set_cell(c, SRC_FLOORS, _variant(sr, SNOW_STAMPS, layers.Snow, c))
	for d in data.get("decks", []):
		for c in _deck(layers.Decks, int(d.x), int(d.y), int(d.w), int(d.h)):
			blocked.erase(c)
	var out := {"blocked": blocked.keys(), "bodies": [], "mines": []}
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


## A plank platform (bridge or jetty) from the furniture sheet's 5x5 deck stamp.
func _deck(layer: TileMapLayer, x0: int, y0: int, w: int, h: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for j in h:
		var r := 34 if j == 0 else (38 if j == h - 1 else 35 + (j - 1) % 3)
		for i in w:
			var c := 0 if i == 0 else (4 if i == w - 1 else 1 + (i - 1) % 3)
			var cell := Vector2i(x0 + i, y0 + j)
			_put(layer, cell, SRC_FURNITURE, Vector2i(c, r))
			cells.append(cell)
	return cells


## set_cell, skipping pieces that are blank on the sheet.
static func _put(layer: TileMapLayer, cell: Vector2i, source: int, at: Vector2i) -> void:
	var src := layer.tile_set.get_source(source) as TileSetAtlasSource
	if src.has_tile(at):
		layer.set_cell(cell, source, at)


## Which stamp piece a material cell needs, from a bitmask of open neighbours. "" = no piece exists.
static func role(m: int) -> String:
	var n := (m & B_N) != 0
	var s := (m & B_S) != 0
	var e := (m & B_E) != 0
	var w := (m & B_W) != 0
	var ne := (m & B_NE) != 0
	var nw := (m & B_NW) != 0
	var se := (m & B_SE) != 0
	var sw := (m & B_SW) != 0
	var k := int(n) + int(s) + int(e) + int(w)
	if k == 0:
		var d := int(ne) + int(nw) + int(se) + int(sw)
		if d == 0:
			return "full"
		if d > 1:
			return ""
		return "iNE" if ne else ("iNW" if nw else ("iSE" if se else "iSW"))
	if k == 1:
		if s and not ne and not nw: return "S"
		if n and not se and not sw: return "N"
		if e and not nw and not sw: return "E"
		if w and not ne and not se: return "W"
		return ""
	if k == 2:
		if e and s and not nw: return "ES"
		if w and s and not ne: return "WS"
		if n and e and not sw: return "NE"
		if n and w and not se: return "NW"
	return ""


func _solve(rows: PackedStringArray) -> void:
	var n := width * height
	mat.resize(n)
	shore.resize(n)
	snow.resize(n)
	vwater.resize((width + 1) * (height + 1))
	for j in height + 1:
		for i in width + 1:
			var all_water := true
			for d in [Vector2i(-1, -1), Vector2i(0, -1), Vector2i(-1, 0), Vector2i(0, 0)]:
				if _ch(rows, i + d.x, j + d.y) != "~":
					all_water = false
			vwater[j * (width + 1) + i] = 1 if all_water else 0
	for y in height:
		for x in width:
			var wet := false
			for d in [Vector2i(0, 0), Vector2i(1, 0), Vector2i(0, 1), Vector2i(1, 1)]:
				if vwater[(y + d.y) * (width + 1) + x + d.x]:
					wet = true
			shore[_i(x, y)] = 1 if wet else 0
			var ch := _ch(rows, x, y)
			mat[_i(x, y)] = GRASS if (wet or ch in ".~*") else (DIRT if ch == ":" else STONE)
	# dirt and cobbles never touch the shore; grass never meets dirt and cobbles at once
	for y in height:
		for x in width:
			if mat[_i(x, y)] != GRASS and _touches_shore(x, y):
				mat[_i(x, y)] = GRASS
	for y in height:
		for x in width:
			if mat[_i(x, y)] == GRASS and not shore[_i(x, y)] and _borders(x, y, DIRT) and _borders(x, y, STONE):
				mat[_i(x, y)] = DIRT
	# snow: only on grass away from the water; grow drifts where their rim has no piece
	for y in height:
		for x in width:
			snow[_i(x, y)] = 1 if _ch(rows, x, y) == "*" and not shore[_i(x, y)] and not _touches_shore(x, y) else 0
	var grew := true
	while grew:
		grew = false
		for y in height:
			for x in width:
				if not snow[_i(x, y)] and not shore[_i(x, y)] and role(_snow_mask(x, y)) == "":
					snow[_i(x, y)] = 1
					grew = true
	# open up shapes the stamps cannot draw, until everything is drawable
	var changed := true
	while changed:
		changed = false
		for y in height:
			for x in width:
				var m := mat[_i(x, y)]
				if m == GRASS and not shore[_i(x, y)] and role(_mask(x, y, -1)) == "":
					mat[_i(x, y)] = _open_neighbour(x, y)
					changed = true
				elif m == STONE and role(_mask(x, y, DIRT)) == "":
					mat[_i(x, y)] = DIRT
					changed = true


## Bitmask of neighbours that are "open" relative to this cell: not grass (open == -1) or a given material.
func _mask(x: int, y: int, open: int) -> int:
	var m := 0
	for k in 8:
		var q: Vector2i = Vector2i(x, y) + D8[k]
		var mm := GRASS
		if q.x >= 0 and q.y >= 0 and q.x < width and q.y < height:
			mm = mat[_i(q.x, q.y)]
		if (open == -1 and mm != GRASS) or (open != -1 and mm == open):
			m |= 1 << k
	return m


func _snow_mask(x: int, y: int) -> int:
	var m := 0
	for k in 8:
		var q: Vector2i = Vector2i(x, y) + D8[k]
		if q.x >= 0 and q.y >= 0 and q.x < width and q.y < height and snow[_i(q.x, q.y)]:
			m |= 1 << k
	return m


func _open_neighbour(x: int, y: int) -> int:
	var count := {DIRT: 0, STONE: 0}
	for d in D8:
		var q: Vector2i = Vector2i(x, y) + d
		if q.x >= 0 and q.y >= 0 and q.x < width and q.y < height:
			var mm := mat[_i(q.x, q.y)]
			if mm != GRASS:
				count[mm] += 1
	if count[DIRT] == 0 and count[STONE] == 0:
		return GRASS
	return DIRT if count[DIRT] >= count[STONE] else STONE


func _borders(x: int, y: int, material: int) -> bool:
	for d in D8:
		var q: Vector2i = Vector2i(x, y) + d
		if q.x >= 0 and q.y >= 0 and q.x < width and q.y < height and mat[_i(q.x, q.y)] == material:
			return true
	return false


func _touches_shore(x: int, y: int) -> bool:
	for d in D8:
		var q: Vector2i = Vector2i(x, y) + d
		if q.x >= 0 and q.y >= 0 and q.x < width and q.y < height and shore[_i(q.x, q.y)]:
			return true
	return false


func _corner_key(x: int, y: int) -> String:
	var k := ""
	for d in [Vector2i(0, 0), Vector2i(1, 0), Vector2i(0, 1), Vector2i(1, 1)]:
		k += "0" if vwater[(y + d.y) * (width + 1) + x + d.x] else "1"
	return k


## Among the stamp variants of a piece, take the one whose pixels line up best with the
## neighbours already placed to the left and above.
func _variant(r: String, stamps: Array, layer: TileMapLayer, c: Vector2i) -> Vector2i:
	var best := Vector2i.ZERO
	var best_cost := INF
	var left := layer.get_cell_atlas_coords(c + Vector2i.LEFT)
	var up := layer.get_cell_atlas_coords(c + Vector2i.UP)
	for stamp in stamps:
		for off in RING[r]:
			var t: Vector2i = stamp + off
			var cost := rng.randf() * 0.5
			if left != Vector2i(-1, -1):
				cost += _mismatch(_edge(left, 1), _edge(t, 3))
			if up != Vector2i(-1, -1):
				cost += _mismatch(_edge(up, 2), _edge(t, 0))
			if cost < best_cost:
				best_cost = cost
				best = t
	return best


## Opaque pixels along one side of a floor tile: 0 top, 1 right, 2 bottom, 3 left.
func _edge(t: Vector2i, side: int) -> PackedByteArray:
	var key := Vector3i(t.x, t.y, side)
	if _edges.has(key):
		return _edges[key]
	if _floors_img == null:
		_floors_img = Pack.texture(FLOORS).get_image()
		if _floors_img.is_compressed():
			_floors_img.decompress()
	var out := PackedByteArray()
	out.resize(16)
	for i in 16:
		var p := Vector2i(i, 0) if side == 0 else (Vector2i(15, i) if side == 1 else (Vector2i(i, 15) if side == 2 else Vector2i(0, i)))
		out[i] = 1 if _floors_img.get_pixelv(t * 16 + p).a > 0.0 else 0
	_edges[key] = out
	return out


static func _mismatch(a: PackedByteArray, b: PackedByteArray) -> int:
	var n := 0
	for i in 16:
		if a[i] != b[i]:
			n += 1
	return n


func _tileset() -> TileSet:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(16, 16)
	var floors := TileSetAtlasSource.new()
	floors.texture = Pack.texture(FLOORS)
	floors.texture_region_size = Vector2i(16, 16)
	var wanted := {}
	for stamp in GRASS_STAMPS + STONE_STAMPS:
		for r in RING:
			for off in RING[r]:
				wanted[stamp + off] = true
	for stamp in SNOW_STAMPS:
		for r in RING:
			for off in RING[r]:
				wanted[stamp + off] = true
	for t in GRASS_FILL + DIRT_FILL + STONE_FILL + SNOW_FILL:
		wanted[t] = true
	for t in wanted:
		floors.create_tile(t)
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


func _pick(options: Array) -> Vector2i:
	return options[rng.randi() % options.size()]


func _i(x: int, y: int) -> int:
	return y * width + x


static func _ch(rows: PackedStringArray, x: int, y: int) -> String:
	if y < 0 or y >= rows.size() or x < 0 or x >= rows[y].length():
		return "."
	return rows[y][x]
