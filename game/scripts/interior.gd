class_name Interior
extends Node2D
## A building's inside, drawn from a hand-authored floorplan: data/interiors/<id>.txt holds the
## legend and an ASCII map (one character per 16px tile), data/interiors/pieces.txt names the art.
## Map characters: '#' wall top, '=' wall face, ' ' void, . , : ; ' floor zones, letters = legend.

const WALLS := "Environment/Structures/Buildings/Interior/Interior_Walls_01.png"
const PROPS := "Environment/Structures/Buildings/Interior/Interior_Props_01.png"
const SHEETS := {"P": PROPS, "F": "Environment/Props/Static/Furniture.png"}
const DIR := "res://data/interiors/"
const ORIGIN := Vector2.ZERO
const IDS := ["house_1", "house_2", "house_3", "barn", "coop", "general_store", "saloon",
	"blacksmith_shop", "library", "dispensary", "clinic", "school", "church", "bathhouse", "museum",
	"inn", "mayors_manor", "npc_house_1", "npc_house_2", "npc_house_3", "npc_house_4", "npc_house_5",
	"wizard_tower", "greenhouse", "windmill", "silo", "well"]
const WALL_STYLES := {"log": 0, "stone": 6, "plank": 12, "plaster": 18}
const FLOOR_STYLES := {"planks": 0, "stone": 5, "parquet": 10, "tiles": 15}
const FLOOR_CHARS := ".,:;'"
const FIXTURES := ["bed", "kitchen", "alchemy", "bathhouse_pool"]
const POTIONS := [Rect2(528, 288, 16, 16), Rect2(560, 304, 16, 16), Rect2(576, 320, 16, 16)]
enum Cell { VOID, TOP, FACE, FLOOR, PROP }

static var _pieces := {}
static var _layouts := {}
static var _wall_img: Image

var tier: Variant = 1
var id := "house_1"
var layout: Dictionary = {}
var props_root: Node2D
var _tiles: TileMapLayer
var _body: StaticBody2D
var _sorted: Array[Node2D] = []


func _ready() -> void:
	position = ORIGIN


func room_rect() -> Rect2:
	if layout.is_empty():
		return Rect2(ORIGIN, Vector2(256, 256))
	return Rect2(ORIGIN, Vector2(layout.W, layout.H) * 16.0)


## Where you wake up: on the open floor beside the bed.
func bed_spot() -> Vector2:
	for p in layout.get("props", []):
		if p.piece.role != "bed":
			continue
		var r: Rect2i = p.rect
		var tries: Array[Vector2i] = []
		for y in range(r.end.y - 1, r.position.y - 1, -1):
			tries.append(Vector2i(r.end.x, y))
		for x in range(r.position.x, r.end.x):
			tries.append(Vector2i(x, r.end.y))
		for y in range(r.end.y - 1, r.position.y - 1, -1):
			tries.append(Vector2i(r.position.x - 1, y))
		for c in tries:
			if is_free(c):
				return ORIGIN + (Vector2(c) + Vector2(0.5, 0.5)) * 16.0
	return door_inside() + Vector2(0, -40)


func door_inside() -> Vector2:
	return ORIGIN + layout.door


func exit_line() -> float:
	return ORIGIN.y + (layout.H - 1) * 16 + 10


func is_free(c: Vector2i) -> bool:
	return c.x >= 0 and c.y >= 0 and c.x < layout.W and c.y < layout.H and not layout.blocked[c.y][c.x]


func build(tier_, sorted_parent: Node2D) -> void:
	tier = tier_
	id = tier_ if tier_ is String and IDS.has(tier_) else "house_%d" % clampi(int(tier_), 1, 3)
	layout = load_layout(id)
	for c in get_children():
		c.queue_free()
	if props_root:
		props_root.queue_free()
	_sorted.clear()
	_tiles = TileMapLayer.new()
	_tiles.z_index = -9
	add_child(_tiles)
	_paint()
	_body = StaticBody2D.new()
	_body.collision_layer = 1
	add_child(_body)
	for y in layout.H:
		var x := 0
		while x < layout.W:
			if _kind(x, y) == Cell.FLOOR:
				x += 1
				continue
			var x0 := x
			while x < layout.W and _kind(x, y) != Cell.FLOOR:
				x += 1
			_rect(Rect2(x0 * 16.0, y * 16.0, (x - x0) * 16.0, 16.0))
	props_root = Node2D.new()
	props_root.name = "CabinProps"
	props_root.y_sort_enabled = true
	props_root.position = ORIGIN
	sorted_parent.add_child(props_root)
	for p in layout.props:
		_put_piece(p.piece, p.rect, p.flip)
	for pl in layout.places:
		_put_free(pl)


static func pieces() -> Dictionary:
	if not _pieces.is_empty():
		return _pieces
	for raw in _lines(DIR + "pieces.txt"):
		var line := raw.strip_edges()
		if line == "" or line.begins_with(";"):
			continue
		var t := line.split(" ", false)
		var p := {"name": t[0], "fp": Vector2i.ONE, "layer": "sorted", "solid": true, "role": "", "ox": 0.0, "oy": 0.0}
		var rest: PackedStringArray
		if t[1].begins_with("@"):
			p.sprite = t[1].substr(1)
			rest = t.slice(2)
		else:
			p.sheet = SHEETS[t[1]]
			p.rect = Rect2(t[2].to_float(), t[3].to_float(), t[4].to_float(), t[5].to_float())
			rest = t.slice(6)
		for flag in rest:
			var kv := flag.split("=")
			match kv[0]:
				"wall", "floor", "over", "top":
					p.layer = kv[0]
					p.solid = false
				"pass":
					p.solid = false
				"role":
					p.role = kv[1]
				"light":
					var l := kv[1].split(",")
					p.light = [Color("#" + l[0]), l[1].to_float(), l[2].to_int(), l[3].to_float()]
				"ox", "oy", "alpha":
					p[kv[0]] = kv[1].to_float()
				"add":
					p.add = true
				_:
					var d := flag.split("x")
					if d.size() == 2 and d[0].is_valid_int() and d[1].is_valid_int():
						p.fp = Vector2i(d[0].to_int(), d[1].to_int())
					else:
						push_error("pieces.txt: bad flag '%s' on %s" % [flag, t[0]])
		_pieces[t[0]] = p
	return _pieces


static func load_layout(key: String) -> Dictionary:
	if _layouts.has(key):
		return _layouts[key]
	var lay := {"id": key, "wall": "plaster", "wall_tint": Color.WHITE, "floors": {".": ["planks", Color.WHITE]},
		"legend": {}, "places": [], "rows": []}
	var in_map := false
	for raw in _lines(DIR + key + ".txt"):
		if in_map:
			if raw.strip_edges() != "":
				lay.rows.append(raw.rstrip(" "))
			continue
		var line := raw.strip_edges()
		if line == "" or line.begins_with(";"):
			continue
		var t := line.split(" ", false)
		if t[0] == "map:":
			in_map = true
		elif t[0] == "title:":
			lay.title = line.substr(7)
		elif t[0] == "wall":
			lay.wall = t[1]
			if t.size() > 2:
				lay.wall_tint = Color(t[2])
		elif t[0] == "floor" and t.size() >= 3:
			lay.floors[t[1]] = [t[2], Color(t[3]) if t.size() > 3 else Color.WHITE]
		elif t[0] == "place" and t.size() >= 4:
			lay.places.append({"piece": t[1], "at": Vector2(t[2].to_float(), t[3].to_float()), "flip": t.size() > 4 and t[4] == "flip"})
		elif t.size() >= 3 and t[1] == "=" and t[0].length() == 1:
			lay.legend[t[0]] = {"piece": t[2], "flip": t.size() > 3 and t[3] == "flip"}
		else:
			push_error("%s.txt: cannot read '%s'" % [key, line])
	_resolve(lay)
	_layouts[key] = lay
	return lay


static func _resolve(lay: Dictionary) -> void:
	var rows: Array = lay.rows
	var H := rows.size()
	var W := 0
	for r in rows:
		W = maxi(W, r.length())
	lay.W = W
	lay.H = H
	var kind := []
	var zone := []
	var owner := []
	for y in H:
		var k := []
		var z := []
		var o := []
		for x in W:
			var c: String = rows[y][x] if x < rows[y].length() else " "
			z.append("")
			o.append(-1)
			if c == " ":
				k.append(Cell.VOID)
			elif c == "#":
				k.append(Cell.TOP)
			elif c == "=":
				k.append(Cell.FACE)
			elif FLOOR_CHARS.contains(c):
				k.append(Cell.FLOOR)
				z[x] = c
			else:
				k.append(Cell.PROP)
		kind.append(k)
		zone.append(z)
		owner.append(o)
	var props := []
	var all := pieces()
	for y in H:
		for x in W:
			if kind[y][x] != Cell.PROP or owner[y][x] != -1:
				continue
			var c: String = rows[y][x]
			var leg: Dictionary = lay.legend.get(c, {})
			var pc: Dictionary = all.get(leg.get("piece", ""), {})
			if pc.is_empty():
				push_error("%s.txt: '%s' at %d,%d is not a known piece" % [lay.id, c, x, y])
				kind[y][x] = Cell.FLOOR
				zone[y][x] = "."
				continue
			var fp: Vector2i = pc.fp
			for dy in fp.y:
				for dx in fp.x:
					var cx := x + dx
					var cy := y + dy
					if cy < H and cx < W and owner[cy][cx] == -1 and (kind[cy][cx] == Cell.FLOOR or rows[cy][cx] == c):
						owner[cy][cx] = props.size()
						kind[cy][cx] = Cell.PROP
					else:
						push_error("%s.txt: '%s' (%s) at %d,%d needs a %dx%d block" % [lay.id, c, pc.name, x, y, fp.x, fp.y])
			props.append({"piece": pc, "rect": Rect2i(x, y, fp.x, fp.y), "flip": leg.flip})
	var queue: Array[Vector2i] = []
	for y in H:
		for x in W:
			if kind[y][x] == Cell.PROP and owner[y][x] >= 0 and props[owner[y][x]].piece.layer == "wall":
				kind[y][x] = Cell.FACE
			elif kind[y][x] == Cell.FLOOR:
				queue.append(Vector2i(x, y))
	var head := 0
	while head < queue.size():
		var at := queue[head]
		head += 1
		for d in [Vector2i.LEFT, Vector2i.RIGHT, Vector2i.UP, Vector2i.DOWN]:
			var n: Vector2i = at + d
			if n.x >= 0 and n.y >= 0 and n.x < W and n.y < H and kind[n.y][n.x] == Cell.PROP:
				kind[n.y][n.x] = Cell.FLOOR
				zone[n.y][n.x] = zone[at.y][at.x]
				queue.append(n)
	var blocked := []
	for y in H:
		var b := []
		for x in W:
			if kind[y][x] == Cell.PROP:
				kind[y][x] = Cell.FLOOR
				zone[y][x] = "."
			var o: int = owner[y][x]
			b.append(kind[y][x] != Cell.FLOOR or (o >= 0 and props[o].piece.solid))
		blocked.append(b)
	var gap := []
	for x in W:
		if H > 0 and kind[H - 1][x] == Cell.FLOOR:
			gap.append(x)
	if gap.is_empty():
		push_error("%s.txt: the bottom wall has no doorway" % lay.id)
		gap = [W / 2]
	lay.door = Vector2((gap[0] + gap[-1] + 1) * 8.0, (H - 1) * 16.0 - 2.0)
	lay.kind = kind
	lay.zone = zone
	lay.owner = owner
	lay.props = props
	lay.blocked = blocked
	var sorted := 0
	for p in props:
		if p.piece.layer == "sorted":
			sorted += 1
	for pl in lay.places:
		if all.get(pl.piece, {}).get("layer", "") == "sorted":
			sorted += 1
	lay.sorted_count = sorted


static func _lines(path: String) -> PackedStringArray:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("Interior: cannot open " + path)
		return PackedStringArray()
	return f.get_as_text().replace("\r", "").split("\n")


func _kind(x: int, y: int) -> int:
	if x < 0 or y < 0 or x >= layout.W or y >= layout.H:
		return Cell.VOID
	return layout.kind[y][x]


func _paint() -> void:
	var img := _walls_image()
	var sc: int = WALL_STYLES.get(layout.wall, 18)
	var index := {}
	var tiles: Array[Image] = []
	var cells := []
	for y in layout.H:
		for x in layout.W:
			var key := _tile_key(x, y)
			var s := str(key)
			if not index.has(s):
				index[s] = tiles.size()
				tiles.append(_tile_image(key, img, sc))
			cells.append([Vector2i(x, y), index[s]])
	var cols := 16
	var rows := maxi(1, ceili(tiles.size() / float(cols)))
	var atlas := Image.create(cols * 16, rows * 16, false, Image.FORMAT_RGBA8)
	for i in tiles.size():
		atlas.blit_rect(tiles[i], Rect2i(0, 0, 16, 16), Vector2i(i % cols * 16, i / cols * 16))
	var src := TileSetAtlasSource.new()
	src.texture = ImageTexture.create_from_image(atlas)
	src.texture_region_size = Vector2i(16, 16)
	for i in tiles.size():
		src.create_tile(Vector2i(i % cols, i / cols))
	var ts := TileSet.new()
	ts.tile_size = Vector2i(16, 16)
	ts.add_source(src, 0)
	_tiles.tile_set = ts
	for c in cells:
		_tiles.set_cell(c[0], 0, Vector2i(c[1] % cols, c[1] / cols))


func _tile_key(x: int, y: int) -> Array:
	match _kind(x, y):
		Cell.FLOOR:
			var f: Array = layout.floors.get(layout.zone[y][x], ["planks", Color.WHITE])
			return ["f", FLOOR_STYLES.get(f[0], 0), x % 5, y % 3, f[1]]
		Cell.FACE:
			var top := y
			while _kind(x, top - 1) == Cell.FACE:
				top -= 1
			var bottom := y
			while _kind(x, bottom + 1) == Cell.FACE:
				bottom += 1
			var row := 8 if y == bottom else (6 if y == top else 7)
			var jamb := (1 if _kind(x - 1, y) == Cell.FLOOR else 0) | (2 if _kind(x + 1, y) == Cell.FLOOR else 0)
			return ["w", row, x % 2, jamb, layout.wall_tint]
		Cell.TOP:
			var m := 0
			if _kind(x, y - 1) == Cell.FLOOR:
				m |= 1
			if _kind(x, y + 1) in [Cell.FLOOR, Cell.FACE]:
				m |= 2
			if _kind(x - 1, y) in [Cell.FLOOR, Cell.FACE]:
				m |= 4
			if _kind(x + 1, y) in [Cell.FLOOR, Cell.FACE]:
				m |= 8
			return ["t", m, layout.wall_tint]
	return ["t", 0, Color.WHITE]


static func _tile_image(k: Array, img: Image, sc: int) -> Image:
	var t: Image
	var tint: Color
	match k[0]:
		"f":
			t = img.get_region(Rect2i((k[1] + k[2]) * 16, (21 + k[3]) * 16, 16, 16))
			tint = k[4]
		"w":
			t = img.get_region(Rect2i((sc + 2 + k[2]) * 16, k[1] * 16, 16, 16))
			if k[3] & 1:
				_overlay(t, _strip(img, sc, "W"))
			if k[3] & 2:
				_overlay(t, _strip(img, sc, "E"))
			tint = k[4]
		_:
			t = Image.create(16, 16, false, Image.FORMAT_RGBA8)
			t.fill(Color.BLACK)
			for bit in [[1, "N"], [2, "S"], [4, "W"], [8, "E"]]:
				if k[1] & bit[0]:
					_overlay(t, _strip(img, sc, bit[1]))
			tint = k[2]
	if tint != Color.WHITE:
		for y in 16:
			for x in 16:
				var c := t.get_pixel(x, y)
				t.set_pixel(x, y, Color(c.r * tint.r, c.g * tint.g, c.b * tint.b, c.a))
	return t


## The trim beam along one edge of a wall top, cut from the wall sheet's room template.
static func _strip(img: Image, sc: int, dir: String) -> Image:
	match dir:
		"N":
			return img.get_region(Rect2i((sc + 2) * 16, 0, 16, 16))
		"S":
			var s := img.get_region(Rect2i((sc + 2) * 16, 0, 16, 16))
			s.flip_y()
			return s
		"W":
			return img.get_region(Rect2i(sc * 16, 32, 16, 16))
	return img.get_region(Rect2i((sc + 5) * 16, 32, 16, 16))


static func _overlay(dst: Image, src: Image) -> void:
	for y in 16:
		for x in 16:
			var c := src.get_pixel(x, y)
			if c.a > 0.5 and c.r + c.g + c.b > 0.06:
				dst.set_pixel(x, y, c)


static func _walls_image() -> Image:
	if _wall_img == null:
		var img := Pack.texture(WALLS).get_image()
		if img.is_compressed():
			img.decompress()
		img.convert(Image.FORMAT_RGBA8)
		_wall_img = img
	return _wall_img


func _sprite(pc: Dictionary, flip: bool) -> Sprite2D:
	var sp := Sprite2D.new()
	sp.centered = false
	sp.flip_h = flip
	if pc.has("sprite"):
		var d := Pack.spec(pc.sprite)
		sp.texture = Pack.atlas(d)
		if d.has("anchor"):
			pc.anchor = Vector2(d.anchor[0], d.anchor[1])
	else:
		var t := AtlasTexture.new()
		t.atlas = Pack.texture(pc.sheet)
		t.region = pc.rect
		sp.texture = t
	if pc.has("alpha"):
		sp.modulate.a = pc.alpha
	if pc.get("add", false):
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		sp.material = m
	return sp


func _put_piece(pc: Dictionary, r: Rect2i, flip: bool) -> void:
	var sp := _sprite(pc, flip)
	var size: Vector2 = sp.texture.get_size()
	var box := Rect2(Vector2(r.position) * 16.0, Vector2(r.size) * 16.0)
	if pc.layer in ["wall", "floor", "over"]:
		sp.position = ORIGIN + (box.position + (box.size - size) / 2.0).floor() + Vector2(pc.ox, pc.oy)
		sp.z_index = 5 if pc.layer == "over" else -8
		add_child(sp)
		_add_light(pc, sp, size / 2.0)
		return
	var node: Node2D = CabinFixture.new(pc.role) if pc.role in FIXTURES else Node2D.new()
	node.position = ORIGIN + Vector2(box.get_center().x, box.end.y)
	var anchor: Vector2 = pc.get("anchor", Vector2(size.x / 2.0, size.y))
	if flip:
		anchor.x = size.x - anchor.x
	sp.position = (-anchor).floor() + Vector2(pc.ox, pc.oy)
	node.add_child(sp)
	if pc.role == "alchemy":
		for i in POTIONS.size():
			var pt := AtlasTexture.new()
			pt.atlas = Pack.texture(PROPS)
			pt.region = POTIONS[i]
			var ps := Sprite2D.new()
			ps.texture = pt
			ps.position = Vector2(-9 + i * 8, -26)
			node.add_child(ps)
	if pc.solid:
		var body := StaticBody2D.new()
		body.collision_layer = 1
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = box.size - Vector2(4, 4)
		shape.shape = rect
		shape.position = Vector2(0, -box.size.y / 2.0)
		body.add_child(shape)
		node.add_child(body)
	_add_light(pc, node, Vector2.ZERO)
	props_root.add_child(node)
	_sorted.append(node)


## Free placements never block movement: rugs, sunlight, hanging lamps, things set on furniture.
func _put_free(pl: Dictionary) -> void:
	var pc: Dictionary = pieces().get(pl.piece, {})
	if pc.is_empty():
		push_error("%s.txt: place of unknown piece %s" % [id, pl.piece])
		return
	var sp := _sprite(pc, pl.flip)
	var size: Vector2 = sp.texture.get_size()
	var at: Vector2 = ORIGIN + pl.at * 16.0 + Vector2(pc.ox, pc.oy)
	match pc.layer:
		"floor", "wall", "over":
			sp.position = at
			sp.z_index = 5 if pc.layer == "over" else (-7 if pc.get("add", false) else -8)
			add_child(sp)
			_add_light(pc, sp, size / 2.0)
		"top":
			var foot := at + Vector2(size.x / 2.0, size.y)
			var host := _host_at(foot)
			if host:
				sp.position = at - host.position
				host.add_child(sp)
			else:
				push_error("%s.txt: %s at %s is not on any furniture" % [id, pl.piece, pl.at])
				var n := Node2D.new()
				n.position = foot
				sp.position = -Vector2(size.x / 2.0, size.y)
				n.add_child(sp)
				props_root.add_child(n)
		_:
			var node := Node2D.new()
			node.position = at + Vector2(floorf(size.x / 2.0), size.y)
			sp.position = -Vector2(floorf(size.x / 2.0), size.y)
			node.add_child(sp)
			_add_light(pc, node, Vector2.ZERO)
			props_root.add_child(node)
			_sorted.append(node)


func _host_at(point: Vector2) -> Node2D:
	var best: Node2D = null
	for n in _sorted:
		var sp := n.get_child(0) as Sprite2D
		var r := Rect2(n.position + sp.position, sp.texture.get_size())
		if r.has_point(point) and (best == null or n.position.y > best.position.y):
			best = n
	return best


func _add_light(pc: Dictionary, parent: Node2D, at: Vector2) -> void:
	if pc.has("light"):
		var l: Array = pc.light
		parent.add_child(World.make_light(l[0], l[1], at + Vector2(0, l[3]), l[2]))


func _rect(r: Rect2) -> void:
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = r.size
	shape.shape = rect
	shape.position = ORIGIN + r.get_center()
	_body.add_child(shape)
