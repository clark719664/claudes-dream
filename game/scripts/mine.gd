class_name Mine
extends Node2D
## One floor of the Old Mine, made fresh each day.
##
## The cave is grown with a cellular automaton (random rock, smoothed until it forms chambers and
## passages), keeping the largest open region. Rock is drawn with the pack's cliff stamp as a
## raised mass: flat rock on top, a three-row rock face wherever the floor lies to the south, rims
## along the other edges. The floor is packed dirt with patches of stone.
##
## You climb down the ladder you arrive by; the way further down is hidden under one of the rocks
## (or turns up now and then under any rock you break). Rocks hold stone and coal near the top,
## iron from floor 3, crystal from floor 8. Skeletons wander, more and tougher the deeper you go.
## Every fifth floor has a lift: once you've reached it you can ride straight down from the mine
## mouth.

const W := 38
const H := 30
const FLOORS := "Environment/Tilesets/Floors_Tiles.png"
const CLIFFS := "Environment/Tilesets/Wall_Tiles.png"
const DIRT := [Vector2i(11, 10), Vector2i(12, 10), Vector2i(13, 10)]
const STONE := [Vector2i(6, 10), Vector2i(7, 10), Vector2i(8, 10)]

var level := 1
var open := PackedByteArray()      # 1 = floor
var rng := RandomNumberGenerator.new()
var up_at := Vector2.ZERO
var ladder_found := false
var _world: World
var _rocks: Array = []


func _init(lv := 1) -> void:
	level = maxi(1, lv)


## Build this floor into the world's current area. Returns where you arrive.
func build(world: World, _at: String) -> Vector2:
	_world = world
	rng.seed = hash("mine %d %d" % [level, Game.day])
	for attempt in 8:
		_carve()
		if _count_open() > W * H * 0.34:
			break
	world.size = Vector2(W, H) * 16
	world.data = {"name": "The Old Mine, floor %d" % level}
	_tiles()
	_walls()
	_populate()
	Game.stats["mine_depth"] = maxi(int(Game.stats.get("mine_depth", 0)), level)
	return up_at + Vector2(0, 22)


func is_open(x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x < W and y < H and open[y * W + x] == 1


# ---------------------------------------------------------------- the cave
func _carve() -> void:
	open.resize(W * H)
	for y in H:
		for x in W:
			var edge := x < 2 or y < 3 or x >= W - 2 or y >= H - 2
			open[y * W + x] = 0 if edge or rng.randf() < 0.46 else 1
	for pass_ in 5:
		var nxt := open.duplicate()
		for y in range(1, H - 1):
			for x in range(1, W - 1):
				var rock := 0
				for dy in range(-1, 2):
					for dx in range(-1, 2):
						if open[(y + dy) * W + x + dx] == 0:
							rock += 1
				nxt[y * W + x] = 0 if rock >= 5 else 1
		open = nxt
	# rock thinner than the stamp can draw (one row between two floors, one column between two
	# floors) is knocked through
	for y in range(1, H - 1):
		for x in range(1, W - 1):
			if open[y * W + x] == 0 and ((is_open(x, y - 1) and is_open(x, y + 1)) or (is_open(x - 1, y) and is_open(x + 1, y))):
				open[y * W + x] = 1
	for y in range(1, H - 2):
		for x in range(1, W - 1):
			if open[y * W + x] == 0 and is_open(x, y - 1) and is_open(x, y + 2) and not is_open(x, y + 1):
				open[y * W + x] = 1
				open[(y + 1) * W + x] = 1
	_keep_largest()


func _keep_largest() -> void:
	var seen := PackedByteArray()
	seen.resize(W * H)
	var best: Array = []
	for i in W * H:
		if open[i] == 0 or seen[i] == 1:
			continue
		var region := []
		var stack := [i]
		seen[i] = 1
		while not stack.is_empty():
			var c: int = stack.pop_back()
			region.append(c)
			for d in [-1, 1, -W, W]:
				var n: int = c + d
				if n >= 0 and n < W * H and open[n] == 1 and seen[n] == 0 and absi((n % W) - (c % W)) <= 1:
					seen[n] = 1
					stack.append(n)
		if region.size() > best.size():
			best = region
	for i in W * H:
		open[i] = 0
	for c in best:
		open[c] = 1


func _count_open() -> int:
	var n := 0
	for v in open:
		n += v
	return n


# ---------------------------------------------------------------- drawing it
func _tiles() -> void:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(16, 16)
	ts.add_source(_source(FLOORS, Rect2i(0, 0, 25, 25)), 0)
	ts.add_source(_source(CLIFFS, Rect2i(0, 0, 18, 16)), 1)
	var ground := TileMapLayer.new()
	ground.name = "Ground"
	ground.z_index = -9
	ground.tile_set = ts
	var rock := TileMapLayer.new()
	rock.name = "Rock"
	rock.z_index = -8
	rock.tile_set = ts
	add_child(ground)
	add_child(rock)
	# grey rock over brown earth near the top; dark rock over grey stone deeper down
	var deep := level >= 10
	var col0 := 12 if deep else 6
	rock.modulate = Color(0.82, 0.82, 0.88)
	var stone_patch := func(x: int, y: int) -> bool: return sin(x * 0.7 + level) * cos(y * 0.55 - level) > 0.55
	for y in H:
		for x in W:
			var patch: bool = stone_patch.call(x, y) != deep
			ground.set_cell(Vector2i(x, y), 0, STONE[rng.randi() % 3] if patch else DIRT[rng.randi() % 3])
			if is_open(x, y):
				continue
			# rock: how far down to the floor, and whether floor lies west, east or north
			var below := 0
			for d in range(1, 4):
				if is_open(x, y + d):
					below = d
					break
			var row := 2 + (x + y) % 2
			if below == 1:
				row = 7
			elif below == 2:
				row = 6
			elif below == 3:
				row = 5
			elif is_open(x, y - 1):
				row = 0
			elif is_open(x, y - 2) or (y > 0 and is_open(x - 1, y - 1) and is_open(x + 1, y - 1)):
				row = 1
			var col := 2 + (x + y * 3) % 2
			if is_open(x - 1, y) or (below > 0 and is_open(x - 1, y + below)):
				col = 0
			elif is_open(x + 1, y) or (below > 0 and is_open(x + 1, y + below)):
				col = 5
			rock.set_cell(Vector2i(x, y), 1, Vector2i(col0 + col, row))


func _source(sheet: String, cells: Rect2i) -> TileSetAtlasSource:
	var src := TileSetAtlasSource.new()
	var tex := Pack.texture(sheet)
	src.texture = tex
	src.texture_region_size = Vector2i(16, 16)
	var img := tex.get_image()
	if img.is_compressed():
		img.decompress()
	for y in range(cells.position.y, mini(cells.end.y, img.get_height() / 16)):
		for x in range(cells.position.x, mini(cells.end.x, img.get_width() / 16)):
			if not img.get_region(Rect2i(x * 16, y * 16, 16, 16)).is_invisible():
				src.create_tile(Vector2i(x, y))
	return src


## Rock stops you: one box per run of rock cells in each row.
func _walls() -> void:
	var body := StaticBody2D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	for y in H:
		var x := 0
		while x < W:
			if is_open(x, y):
				x += 1
				continue
			var x0 := x
			while x < W and not is_open(x, y):
				x += 1
			var shape := CollisionShape2D.new()
			var r := RectangleShape2D.new()
			r.size = Vector2((x - x0) * 16, 16)
			shape.shape = r
			shape.position = Vector2(x0 * 16 + (x - x0) * 8, y * 16 + 8)
			body.add_child(shape)
	add_child(body)
	var bounds := StaticBody2D.new()
	bounds.collision_layer = 1
	for r in [Rect2(-16, -16, W * 16 + 32, 16), Rect2(-16, H * 16, W * 16 + 32, 16), Rect2(-16, 0, 16, H * 16), Rect2(W * 16, 0, 16, H * 16)]:
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = r.size
		shape.shape = rect
		shape.position = r.get_center()
		bounds.add_child(shape)
	add_child(bounds)


# ---------------------------------------------------------------- what's down here
func _floor_cells() -> Array:
	var out := []
	for y in H:
		for x in W:
			if is_open(x, y):
				out.append(Vector2i(x, y))
	return out


## A floor cell with open floor all round it.
func _roomy(c: Vector2i, r := 1) -> bool:
	for dy in range(-r, r + 1):
		for dx in range(-r, r + 1):
			if not is_open(c.x + dx, c.y + dy):
				return false
	return true


func _populate() -> void:
	var cells := _floor_cells()
	cells.shuffle()
	var used := {}
	# the ladder you came down, near the top of the cave, under a shaft of daylight
	for c in cells:
		if _roomy(c) and not is_open(c.x, c.y - 2) and c.y < H * 0.6:
			up_at = Vector2(c) * 16 + Vector2(8, 4)
			break
	if up_at == Vector2.ZERO:
		up_at = Vector2(cells[0]) * 16 + Vector2(8, 8)
	var up := Ladder.new(false, level)
	up.position = up_at
	_world.entities.add_child(up)
	for dy in range(-3, 4):
		for dx in range(-3, 4):
			used[Vector2i(int(up_at.x / 16) + dx, int(up_at.y / 16) + dy)] = true
	if level % 5 == 0:
		Game.stats["mine_lift"] = maxi(int(Game.stats.get("mine_lift", 0)), level)
	# rocks: plenty, in clumps along the walls and scattered in the chambers
	var iron := clampf((level - 2) * 0.05, 0.0, 0.3)
	var crystal := 0.07 if level >= 8 else 0.0
	var far: Array = []
	for c in cells:
		if used.has(c):
			continue
		var near_wall := not _roomy(c)
		if rng.randf() > (0.3 if near_wall else 0.12):
			continue
		used[c] = true
		var r := rng.randf()
		var t := "rock"
		if r < crystal:
			t = "crystal"
		elif r < crystal + iron:
			t = "ore_rock"
		elif r < crystal + iron + 0.04 and _roomy(c):
			t = "boulder"
		elif r < crystal + iron + 0.1 and near_wall:
			t = "pot"
		var node := _world.spawn({"t": t, "x": c.x * 16 + 8 + rng.randi_range(-3, 3), "y": c.y * 16 + 12, "v": rng.randi() % 4})
		if node is Harvestable:
			_rocks.append(node)
			if Vector2(c).distance_to(up_at / 16) > 12:
				far.append(node)
	# the ladder down hides under one of the far rocks
	var pool := far if not far.is_empty() else _rocks
	if not pool.is_empty():
		pool[rng.randi() % pool.size()].set_meta("ladder", true)
	# skeletons, more and tougher deeper down
	var kinds := ["skeleton"]
	if level >= 3:
		kinds.append("skeleton_rogue")
	if level >= 6:
		kinds.append("skeleton_warrior")
	if level >= 10:
		kinds.append("skeleton_mage")
	var n := mini(3 + level / 2, 12)
	for c in cells:
		if n <= 0:
			break
		if used.has(c) or not _roomy(c) or Vector2(c).distance_to(up_at / 16) < 8:
			continue
		used[c] = true
		_world.spawn({"t": "enemy", "actor": kinds[rng.randi() % kinds.size()], "x": c.x * 16 + 8, "y": c.y * 16 + 12})
		n -= 1
	# the old workings: lanterns at the foot of the rock, carts and crates, loose stones
	var lamps := 5
	for c in cells:
		if used.has(c):
			continue
		if lamps > 0 and not is_open(c.x, c.y - 1) and rng.randf() < 0.2:
			used[c] = true
			_world.spawn({"t": "lantern", "x": c.x * 16 + 8, "y": c.y * 16 + 6, "light": 1})
			lamps -= 1
		elif rng.randf() < 0.06:
			_world.spawn({"t": "pebble" if rng.randf() < 0.5 else "debris", "x": c.x * 16 + rng.randi_range(2, 14), "y": c.y * 16 + rng.randi_range(6, 14), "v": rng.randi() % 5})
		elif rng.randf() < 0.012 and _roomy(c):
			used[c] = true
			_world.spawn({"t": ["crate", "barrel", "ore_crate", "mine_carts"][rng.randi() % 4], "x": c.x * 16 + 8, "y": c.y * 16 + 12})
	if level % 10 == 0:
		for c in cells:
			if not used.has(c) and _roomy(c) and Vector2(c).distance_to(up_at / 16) > 10:
				_world.spawn({"t": "chest", "x": c.x * 16 + 8, "y": c.y * 16 + 12, "loot": 3, "cid": "mine_%d_%d" % [level, Game.day]})
				break


## A rock you broke: maybe the way down was under it.
func rock_broken(node: Node2D) -> void:
	if ladder_found:
		return
	if node.has_meta("ladder") or rng.randf() < 0.025:
		ladder_found = true
		var down := Ladder.new(true, level)
		down.position = node.global_position
		_world.entities.add_child(down)
		Game.say("You uncover a ladder leading down.")


# ---------------------------------------------------------------- ladders
class Ladder extends Node2D:
	var down := true
	var level := 1

	func _init(down_: bool, lv: int) -> void:
		down = down_
		level = lv

	func _ready() -> void:
		add_to_group("interactable")
		z_index = -3 if down else 0
		if not down:
			# daylight falling down the shaft
			var beam := Polygon2D.new()
			beam.polygon = PackedVector2Array([Vector2(-10, -60), Vector2(10, -60), Vector2(16, 2), Vector2(-16, 2)])
			beam.color = Color(1.0, 0.95, 0.7, 0.12)
			beam.z_index = 20
			add_child(beam)
			add_child(World.make_light(Color(1.0, 0.92, 0.7), 0.9, Vector2(0, -8), 72))
		queue_redraw()

	func _draw() -> void:
		var wood := Color(0.45, 0.28, 0.14)
		var dark := Color(0.2, 0.12, 0.06)
		if down:
			# a hole in the floor with the ladder's top rungs showing
			draw_circle(Vector2(0, -2), 8.0, Color(0.05, 0.03, 0.02))
			draw_arc(Vector2(0, -2), 8.0, 0, TAU, 20, Color(0.3, 0.22, 0.15), 1.5)
			for x in [-4.0, 4.0]:
				draw_line(Vector2(x, -10), Vector2(x, 2), wood, 2.0)
			for y in [-7.0, -3.0, 1.0]:
				draw_line(Vector2(-4, y), Vector2(4, y), wood, 1.5)
		else:
			# a ladder standing against the rock, going up into the shaft
			for x in [-5.0, 5.0]:
				draw_line(Vector2(x, -40), Vector2(x, 0), dark, 3.0)
				draw_line(Vector2(x, -40), Vector2(x, 0), wood, 2.0)
			for i in 7:
				var y := -36.0 + i * 6.0
				draw_line(Vector2(-5, y), Vector2(5, y), wood, 1.5)

	func interact(_p: Node) -> void:
		if down:
			Game.world.go_to("mine_%d" % (level + 1), "top")
		else:
			Game.world.go_to("mountain", "mine")
