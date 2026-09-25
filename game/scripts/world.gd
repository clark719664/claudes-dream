class_name World
extends Node2D
## Hosts one area at a time, the way Stardew does: your house, your farm, Brindle, the woods and
## hills around them. Each outdoor area comes from data/areas/<id>.dat and <id>.bin (written by
## tools/make_world.py); walking into an opening at the edge of the map fades out and loads the
## area next door. The house is built by interior.gd, the mines by mine.gd.
##
## Each area remembers what you did there (Game.area_state): what you chopped, broke, cleared or
## killed and on which day, what you placed, the soil you tilled and the crops in it. Things grow
## back after the area's regrow days; on your farm, what you clear stays cleared.
##
## Objects are kept in 32x32-tile chunks and only the chunks near you exist; flat ground dressing
## in a chunk is drawn by one node.

const FLAT_DECOR := ["tuft", "tuft_dry", "fern", "mushroom", "mushroom_tall", "twig", "pebble", "leaves", "debris", "soil", "puddle", "log", "rail_h", "rail_v", "broken"]
const WORLD_LAYER := 1
const CHUNK := 32                       # tiles
const CHUNK_PX := CHUNK * 16
const SPAWN_BUDGET := 90                # objects per frame while streaming in
const FROZEN := {"oak": "oak_frozen", "oak_big": "oak_big_frozen", "oak_young": "oak_young_frozen"}

var size := Vector2.ZERO
var area_id := ""
var data: Dictionary = {}
var ground := ""       # one terrain character per tile ('.' grass, ':' dirt, '=' stone, '~' water, '*' snow)
var root: Node2D       # everything in the current area
var entities: Node2D   # everything that stands up, sorted by feet position
var decor: Node2D      # flat things on the ground
var player: Player
var cabin: House
var interior: Interior
var soil: Soil
var mine: Node2D
var pois: Array = []
var map_image: Image

var _chunks := {}      # Vector2i -> Array of object dictionaries
var _loaded := {}      # Vector2i -> Array of nodes (the first is the chunk's DecorBatch)
var _tall := {}        # Vector2i -> Array of [node, sprite] that fade when the player is behind
var _queue: Array = [] # [chunk, index] still to spawn
var _exits: Array = [] # [Rect2 in px, area, spawn]
var _fence_layer: TileMapLayer
var _busy := false
var _stream_t := 0.0
var focus = null       # when set (a Vector2), stream around this point instead of the player


func _ready() -> void:
	Game.world = self
	if not Pack.ok:
		_missing_assets()
		return
	var loaded := Game.load_game()
	if not loaded:
		Game.new_game()
	player = Player.new()
	add_child(DayNight.new())
	add_child(Ambience.new())
	var hud := Hud.new()
	add_child(hud)
	load_area("house", "bed")
	if loaded:
		Game.say("Welcome back. %s." % Game.date_text())
	else:
		hud.show_dialog("Your new home", "Grandpa's old farm is yours now: one room, a bed, and a lot of weeds. " +
			"Ship what you grow in the crate by the door; the carter pays at dawn. Brindle is east along the path.")
	if "--demo" in OS.get_cmdline_user_args():
		add_child(load("res://scripts/demo.gd").new())


func _process(delta: float) -> void:
	if player == null or root == null:
		return
	_stream_t -= delta
	if _stream_t <= 0.0:
		_stream_t = 0.25
		_stream(false)
	var budget := SPAWN_BUDGET
	while budget > 0 and not _queue.is_empty():
		var job: Array = _queue.pop_front()
		if _loaded.has(job[0]):
			_spawn_chunk_object(job[0], job[1])
		budget -= 1
	_fade(delta)


func _physics_process(_delta: float) -> void:
	if _busy or player == null or player.dead or root == null:
		return
	var p := player.global_position
	if area_id == "house":
		if p.y > interior.exit_line():
			go_to("farm", "door")
		return
	if mine and mine.has_method("check_exit"):
		mine.check_exit(p)
		return
	for e in _exits:
		if e[0].has_point(p):
			go_to(e[1], e[2])
			return


# ---------------------------------------------------------------- areas
## Fade out, load another area and put the player at one of its spawn points.
func go_to(id: String, at: String) -> void:
	if _busy:
		return
	_busy = true
	player.velocity = Vector2.ZERO
	await Game.hud.fade(true)
	load_area(id, at)
	await get_tree().create_timer(0.08).timeout
	await Game.hud.fade(false)
	_busy = false


func load_area(id: String, at: String) -> void:
	_clear_area()
	area_id = id
	Game.area = id
	root = Node2D.new()
	root.name = "Area_" + id
	add_child(root)
	move_child(root, 0)
	decor = Node2D.new()
	decor.name = "Decor"
	decor.z_index = -4
	entities = Node2D.new()
	entities.name = "Entities"
	entities.y_sort_enabled = true
	var spot := Vector2.ZERO
	if id == "house":
		spot = _build_house(at)
	elif id.begins_with("mine"):
		spot = _build_mine(id, at)
	else:
		spot = _build_outdoor(id, at)
	player.position = spot
	entities.add_child(player)
	player.facing = Vector2.DOWN if at != "bed" else Vector2.DOWN
	if id == "house":
		player.set_room(interior.room_rect())
	else:
		player.set_room(Rect2(Vector2.ZERO, size))
	stream_now()
	Game.hud.area_changed()


func _clear_area() -> void:
	if player.get_parent():
		player.get_parent().remove_child(player)
	if root:
		remove_child(root)
		root.queue_free()
	root = null
	cabin = null
	interior = null
	soil = null
	mine = null
	_fence_layer = null
	_chunks.clear()
	_loaded.clear()
	_tall.clear()
	_queue.clear()
	_exits.clear()
	pois = []
	map_image = null
	data = {}
	ground = ""


func _build_outdoor(id: String, at: String) -> Vector2:
	var raw := FileAccess.get_file_as_bytes("res://data/areas/%s.dat" % id)
	data = JSON.parse_string(raw.decompress_dynamic(-1, FileAccess.COMPRESSION_DEFLATE).get_string_from_utf8())
	size = Vector2(data.width, data.height) * 16
	ground = data.get("ground", "")
	pois = data.get("pois", [])
	var winter: bool = Game.season() == 3 and not data.get("snowy", false)
	var tiles := "res://data/areas/%s%s.bin" % [id, "_winter" if winter else ""]
	var built := Terrain.new().build(root, entities, data, tiles)
	root.add_child(decor)
	root.add_child(entities)
	for body in built.bodies:
		root.add_child(body)
	_add_bounds()
	var state := Game.area_state(id)
	_fence_layer = Fences.build(data.get("fences", {}), placed_fences())
	entities.add_child(_fence_layer)
	for g in data.get("gates", []):
		var gate := Gate.new(int(g.w))
		gate.position = Vector2(g.x, g.y) * 16
		entities.add_child(gate)
	for m in built.mines:
		spawn({"t": "mine_entrance", "x": m.x, "y": m.y})
	for o in data.persistent:
		if _should_spawn(o):
			var node := spawn(o)
			if node:
				node.set_meta("oid", str(o.get("id", "")))
	for k in data.chunks:
		var xy: PackedStringArray = k.split(",")
		_chunks[Vector2i(int(xy[0]), int(xy[1]))] = data.chunks[k]
	for o in state.placed:
		if o.t != "fence":
			var node := spawn(o)
			if node:
				node.set_meta("placed", o)
	if not data.get("farmable", []).is_empty():
		soil = Soil.new(state)
		root.add_child(soil)
	for e in data.get("exits", []):
		var r := Rect2(e.x * 16, e.y * 16, e.w * 16, e.h * 16)
		_exits.append([r, e.to, e.at])
	var map_bytes := FileAccess.get_file_as_bytes("res://data/areas/%s_map.png" % id)
	if not map_bytes.is_empty():
		map_image = Image.new()
		map_image.load_png_from_buffer(map_bytes)
	var spawns: Dictionary = data.get("spawns", {})
	if spawns.has(at):
		return Vector2(spawns[at][0], spawns[at][1])
	if at == "door" and cabin:
		return cabin.position + Vector2(0, 12)
	return size / 2.0


func _build_house(at: String) -> Vector2:
	data = {}
	root.add_child(decor)
	root.add_child(entities)
	interior = Interior.new()
	root.add_child(interior)
	interior.build(Game.cabin_tier, entities)
	var r := interior.room_rect()
	size = r.end
	if at == "bed":
		return interior.bed_spot()
	return interior.door_inside() + Vector2(0, -8)


func _build_mine(id: String, at: String) -> Vector2:
	root.add_child(decor)
	root.add_child(entities)
	var script := load("res://scripts/mine.gd")
	mine = script.new(int(id.substr(5)) if id.length() > 5 else 1)
	root.add_child(mine)
	return mine.build(self, at)


## Wake up at home.
func wake_up() -> void:
	load_area("house", "bed")


## Mornings, after the date has moved on: crops grow (if they were watered) or wither (if they're
## out of season), soil dries out unless it's raining. Returns how many crops died.
func new_day() -> int:
	var died := 0
	for id in Game.areas:
		var st: Dictionary = Game.areas[id]
		for key in st.crops.keys():
			var c: Dictionary = st.crops[key]
			var spec: Dictionary = Inventory.CROPS.get(c.kind, {})
			if spec.is_empty() or not (Game.season() in spec.seasons):
				st.crops.erase(key)
				died += 1
				continue
			if st.soil.get(key, 0) == 1:
				c.age = int(c.age) + 1
		for key in st.soil.keys():
			st.soil[key] = 1 if Game.raining() and id != "house" else 0
	return died


func rebuild_cabin() -> void:
	if cabin:
		cabin.rebuild(Inventory.CABIN_TIERS[Game.cabin_tier].style)


# ---------------------------------------------------------------- what stays and what goes
## Should an object from the area data exist today?
func _should_spawn(o: Dictionary) -> bool:
	if o.has("festival") and o.festival != Game.festival():
		return false
	var key := str(o.get("id", ""))
	var removed: Dictionary = Game.area_state(area_id).removed
	if removed.has(key):
		var r := _regrow_days(o)
		if r <= 0 or Game.day - int(removed[key]) < r:
			return false
		removed.erase(key)
	return true


func _regrow_days(o: Dictionary) -> int:
	if o.has("regrow"):
		return int(o.regrow)
	match o.t:
		"enemy", "forage":
			return 1
	return int(data.get("regrow", 3))


## Something from the area data was chopped, broken, cleared, picked or killed.
func note_removed(node: Node) -> void:
	if node.has_meta("oid") and area_id != "":
		Game.area_state(area_id).removed[node.get_meta("oid")] = Game.day
	if area_id == "farm" and node is Harvestable:
		Game.note("cleared")


## The season's look for trees, bushes and grass: [type, variant], or [] to leave it out today.
func seasonal(t: String, v: int) -> Array:
	var s := Game.season()
	if data.get("snowy", false):
		return [t, v]
	if FROZEN.has(t):
		match s:
			0: return [t, 0]
			1: return [t, v % 2]
			2: return [t, 2 + v % 2]
			3: return [FROZEN[t], v % 2]
	match t:
		"bush", "bush_big":
			match s:
				0: return [t, 0]
				1: return [t, v % 2]
				2: return [t, 2 + v % 2]
				3: return ["dead_shrub", 0 if t == "bush" else 1]
		"tuft":
			if s >= 2:
				return ["tuft_dry", v % 5]
		"weed":
			if s == 3:
				return ["weed_dry", v % 4]
		"fern", "leafy":
			if s == 3:
				return []
	if t.begins_with("flower_") and s == 3:
		return []
	if t == "foxglove" and s >= 2:
		return []
	return [t, v]


# ---------------------------------------------------------------- streaming
## Load everything around the player right away (after arriving, at the start).
func stream_now() -> void:
	_stream(true)


func _stream(sync: bool) -> void:
	if _chunks.is_empty():
		return
	stream_around(focus if focus != null else player.global_position, sync)


## Make sure the map around `p` exists (also used by the whole-map render in demo.gd).
func stream_around(p: Vector2, sync: bool) -> void:
	# tall things hang above their feet, so keep more of the map loaded below the view
	var want := Rect2(p.x - 560, p.y - 400, 1120, 1120)
	var keep := want.grow(CHUNK_PX)
	var c0 := Vector2i(floori(want.position.x / CHUNK_PX), floori(want.position.y / CHUNK_PX))
	var c1 := Vector2i(floori(want.end.x / CHUNK_PX), floori(want.end.y / CHUNK_PX))
	for cy in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			var c := Vector2i(cx, cy)
			if not _loaded.has(c) and _chunks.has(c):
				_load_chunk(c, sync)
	for c in _loaded.keys():
		var r := Rect2(Vector2(c) * CHUNK_PX, Vector2(CHUNK_PX, CHUNK_PX))
		if not keep.intersects(r):
			_unload_chunk(c)


func _load_chunk(c: Vector2i, sync: bool) -> void:
	_loaded[c] = []
	_tall[c] = []
	var batch := DecorBatch.new()
	batch.name = "Decor_%d_%d" % [c.x, c.y]
	decor.add_child(batch)
	_loaded[c].append(batch)
	var objs: Array = _chunks[c]
	var removed: Dictionary = Game.area_state(area_id).removed
	for i in objs.size():
		var o: Dictionary = objs[i]
		if o.t in FLAT_DECOR or o.t.begins_with("flower_"):
			if removed.has(str(o.get("id", ""))):
				continue
			var look := seasonal(o.t, int(o.get("v", 0)))
			if not look.is_empty():
				batch.add(look[0], look[1], Vector2(o.x, o.y), str(o.get("id", "")))
		elif sync:
			_spawn_chunk_object(c, i)
		else:
			_queue.append([c, i])
	batch.queue_redraw()


func _spawn_chunk_object(c: Vector2i, i: int) -> void:
	var o: Dictionary = _chunks[c][i]
	if not _should_spawn(o):
		return
	var node := spawn(o)
	if node == null:
		return
	node.set_meta("oid", str(o.get("id", "")))
	_loaded[c].append(node)
	var sprite: Sprite2D = node.get_meta("tall") if node.has_meta("tall") else null
	if sprite:
		_tall[c].append([node, sprite])


func _unload_chunk(c: Vector2i) -> void:
	for n in _loaded[c]:
		if is_instance_valid(n):
			n.queue_free()
	_loaded.erase(c)
	_tall.erase(c)


## Clear the flat dressing (grass tufts, flowers) off a cell, for tilling.
func clear_decor(cell: Vector2i) -> void:
	var c := Vector2i(floori(cell.x * 16.0 / CHUNK_PX), floori(cell.y * 16.0 / CHUNK_PX))
	if not _loaded.has(c):
		return
	var batch: DecorBatch = _loaded[c][0]
	for id in batch.remove_in(Rect2(Vector2(cell) * 16, Vector2(16, 16)).grow(-2)):
		if id != "":
			Game.area_state(area_id).removed[id] = Game.day


## Tall trees and props turn see-through while the player is behind them.
func _fade(delta: float) -> void:
	var p := player.global_position
	var pc := Vector2i(floori(p.x / CHUNK_PX), floori(p.y / CHUNK_PX))
	for dy in range(0, 3):
		for dx in range(-1, 2):
			var c := pc + Vector2i(dx, dy)
			if not _tall.has(c):
				continue
			for entry in _tall[c]:
				var n: Node2D = entry[0]
				var sp: Sprite2D = entry[1]
				if not is_instance_valid(n) or not sp.visible:
					continue
				var sz := sp.texture.get_size()
				var q := n.global_position
				var behind := p.y < q.y - 2 and p.y > q.y - sz.y + 8 and absf(p.x - q.x) < sz.x * 0.42
				var a := move_toward(sp.modulate.a, 0.5 if behind else 1.0, delta * 3.0)
				if a != sp.modulate.a:
					sp.modulate.a = a


# ---------------------------------------------------------------- the ground
func ground_at(cell: Vector2i) -> String:
	if cell.x < 0 or cell.y < 0 or ground == "":
		return "#"
	var w := int(size.x / 16)
	if cell.x >= w or cell.y >= int(size.y / 16):
		return "#"
	return ground[cell.y * w + cell.x]


func farmable(cell: Vector2i) -> bool:
	for r in data.get("farmable", []):
		if cell.x >= r[0] and cell.y >= r[1] and cell.x < r[2] and cell.y < r[3]:
			return ground_at(cell) in [".", ":", "*"]
	return false


## Is anything solid standing on this cell (a tree, a rock, a fence, a building)?
func cell_blocked(cell: Vector2i) -> bool:
	var q := PhysicsPointQueryParameters2D.new()
	q.position = Vector2(cell) * 16 + Vector2(8, 9)
	q.collision_mask = WORLD_LAYER
	q.collide_with_bodies = true
	if not get_world_2d().direct_space_state.intersect_point(q, 1).is_empty():
		return true
	for key in [Vector2(cell) * 16 + Vector2(4, 6), Vector2(cell) * 16 + Vector2(12, 12)]:
		q.position = key
		if not get_world_2d().direct_space_state.intersect_point(q, 1).is_empty():
			return true
	return false


func placed_fences() -> Array:
	var out := []
	for o in Game.area_state(area_id if area_id != "" else "farm").placed:
		if o.t == "fence":
			out.append(Vector2i(int(o.cx), int(o.cy)))
	return out


func _rebuild_fences() -> void:
	if _fence_layer:
		_fence_layer.queue_free()
	_fence_layer = Fences.build(data.get("fences", {}), placed_fences())
	entities.add_child(_fence_layer)


## Place something from the toolbar on a cell: a station kit or a fence. true if placed.
func place(item: String, cell: Vector2i) -> bool:
	if area_id != "farm" or not farmable(cell) or cell_blocked(cell) or (soil and soil.has_soil(cell)):
		return false
	var st := Game.area_state(area_id)
	if item == "fence":
		st.placed.append({"t": "fence", "cx": cell.x, "cy": cell.y})
		clear_decor(cell)
		_rebuild_fences()
		return true
	if item.begins_with("kit_"):
		var station := item.substr(4)
		# a station stands on a 3x2 footprint: check the cells either side too
		for dx in [-1, 1]:
			if cell_blocked(cell + Vector2i(dx, 0)) or not farmable(cell + Vector2i(dx, 0)):
				return false
		var o := {"t": "station", "station": station, "x": cell.x * 16 + 8, "y": cell.y * 16 + 14}
		st.placed.append(o)
		var node := spawn(o)
		node.set_meta("placed", o)
		Game.note("placed_" + station)
		FX.chips(entities, node.global_position + Vector2(0, -8), Color(0.8, 0.7, 0.5), 14)
		return true
	return false


## Take back a fence you put up (swing an axe at it). true if there was one.
func remove_fence(cell: Vector2i) -> bool:
	var st := Game.area_state(area_id)
	for i in st.placed.size():
		var o: Dictionary = st.placed[i]
		if o.t == "fence" and int(o.cx) == cell.x and int(o.cy) == cell.y:
			st.placed.remove_at(i)
			_rebuild_fences()
			drop("fence", 1, Vector2(cell) * 16 + Vector2(8, 10))
			return true
	return false


# ---------------------------------------------------------------- spawning
## Create the node for one object from the area data.
func spawn(o: Dictionary) -> Node2D:
	var pos := Vector2(o.x, o.y)
	var t: String = o.t
	var v := int(o.get("v", 0))
	var node: Node2D
	match t:
		"player_start":
			return null
		"npc", "villager":
			var npc := Npc.new(o.actor, o.get("name", "Villager"), o.get("lines", "merlo" if o.actor == "wizard" else "villager"), float(o.get("span", 0)))
			if o.has("say"):
				npc.custom = o.say
			node = npc
		"shopkeeper":
			var keeper := Npc.new(o.actor, o.get("name", "Shopkeeper"), "shop", 0.0)
			keeper.shop = o.shop
			if o.has("say"):
				keeper.custom = o.say
			node = keeper
		"enemy":
			node = Enemy.new(o.actor)
		"crop":
			node = prop("crop_" + o.kind, int(o.stage))
		"campfire":
			node = Campfire.new(o.get("style", "bonfire"))
		"station":
			node = Station.new(o.station)
		"station_deco":
			node = Station.new(o.station, int(o.get("tier", 1)))
		"anim":
			node = anim_prop(o.name, float(o.get("solid", 0)), o.get("light", true))
		"mine_entrance":
			node = Interactable.new("mine", o)
		"minecart_stop":
			node = Minecart.new(o.id, o.name)
		"gate":
			node = Gate.new(int(o.get("w", 2)))
		"deck":
			node = Deck.new(o.kind, int(o.w), int(o.h))
		"house":
			node = House.new(o.get("style", "log"), o.get("name", ""), false, int(o.get("gables", 1)))
		"cabin":
			cabin = House.new(Inventory.CABIN_TIERS[Game.cabin_tier].style, "Your cabin", true)
			cabin.entered.connect(func(): go_to("house", "door"))
			node = cabin
		"ship_crate":
			node = ShipCrate.new()
		"spring":
			node = Spring.new(o.get("name", "A spring"))
		"forage":
			if Game.season() == 3 and o.item == "herb":
				return null
			node = Forage.new(o.item, o.sprite, v)
		_:
			var look := seasonal(t, v)
			if look.is_empty():
				return null
			t = look[0]
			v = look[1]
			var s := Pack.spec(t, v)
			var cid := str(o.get("cid", ""))
			if s.has("chest") and cid != "" and Game.opened.has(cid):
				node = prop("chest_open")
			elif s.has("sign") or s.has("chest"):
				node = Interactable.new("sign" if s.has("sign") else "chest", o)
			elif s.has("station") and not o.get("deco", 0):
				node = Station.new(s.station)
			elif s.has("hp") and not o.get("wall", 0):
				node = Harvestable.new(t, v)
			else:
				node = prop(t, v, float(o.get("solid", -1)))
				if t.begins_with("ruin_"):
					_ruin_walls(node, t)
			if o.get("light", 0):
				node.add_child(make_light(Color(1.0, 0.62, 0.3), 1.1, Vector2(0, -10)))
			elif s.has("light"):
				var at := Vector2(10, -30) if t == "lamp_post" else Vector2(0, -6)
				node.add_child(make_light(Color(1.0, 0.78, 0.45), 0.9, at, 72))
	if o.has("flip") and node is Node2D:
		node.scale.x = -1
	node.position = pos
	entities.add_child(node)
	return node


## A static, possibly solid, prop with its shadow. `solid` overrides the catalog's radius.
func prop(t: String, v := 0, solid := -1.0) -> Node2D:
	var s := Pack.spec(t, v)
	var root_: Node2D
	if solid < 0.0:
		solid = float(s.get("solid", 0))
	if solid > 0 or s.has("block"):
		var body := StaticBody2D.new()
		body.collision_layer = WORLD_LAYER
		body.collision_mask = 0
		if s.has("block"):
			# fences and walls: a box over the sprite's footprint, centred on the art
			var r: Array = s.region
			var shape := CollisionShape2D.new()
			var box := RectangleShape2D.new()
			box.size = Vector2(s.block[0], s.block[1])
			shape.shape = box
			shape.position = Vector2((r[2] - r[0]) / 2.0 - s.anchor[0], -s.block[1] / 2.0)
			body.add_child(shape)
		else:
			body.add_child(foot_shape(solid))
		root_ = body
	else:
		root_ = Node2D.new()
	add_shadow(root_, s)
	var sprite := Pack.sprite(t, v)
	root_.add_child(sprite)
	if sprite.texture and sprite.texture.get_size().y > 60:
		root_.set_meta("tall", sprite)
	return root_


## An animated prop from the catalog's anims (a camp grill, a bubbling alchemy table).
func anim_prop(anim_name: String, solid := 0.0, lit := true) -> Node2D:
	var r: Node2D
	if solid > 0:
		var body := StaticBody2D.new()
		body.collision_layer = WORLD_LAYER
		body.collision_mask = 0
		body.add_child(foot_shape(solid))
		r = body
	else:
		r = Node2D.new()
	if anim_name != "smoke":
		var sh := Pack.sprite("shadow_tree")
		sh.z_index = -1
		sh.position = Vector2(0, -2)
		r.add_child(sh)
	r.add_child(Pack.anim_node(anim_name))
	if lit and (anim_name.begins_with("grill") or anim_name.begins_with("fire") or anim_name in ["meat_rack", "kitchen_range", "cooker", "pan"]):
		r.add_child(make_light(Color(1.0, 0.58, 0.28), 0.9, Vector2(0, -10), 80))
	return r


## Roofless cottage walls: solid along the back, the sides and the front (with a doorway gap).
func _ruin_walls(node: Node2D, t: String) -> void:
	var body := StaticBody2D.new()
	body.collision_layer = WORLD_LAYER
	var rects := []
	if t == "ruin_back":
		rects = [Rect2(-48, -60, 96, 12), Rect2(-48, -60, 8, 60), Rect2(40, -60, 8, 60)]
	else:
		rects = [Rect2(-48, -12, 32, 12), Rect2(16, -12, 32, 12), Rect2(-48, -60, 8, 60), Rect2(40, -60, 8, 60)]
	for r in rects:
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = r.size
		shape.shape = rect
		shape.position = r.get_center()
		body.add_child(shape)
	node.add_child(body)


static func foot_shape(radius: float) -> CollisionShape2D:
	var shape := CollisionShape2D.new()
	var c := CircleShape2D.new()
	c.radius = radius
	shape.shape = c
	shape.position = Vector2(0, -radius * 0.35)
	return shape


static func add_shadow(parent: Node2D, s: Dictionary) -> Sprite2D:
	if not s.has("shadow"):
		return null
	var sh := Pack.sprite(s.shadow)
	sh.z_index = -1
	sh.position = Vector2(0, -1)
	parent.add_child(sh)
	return sh


static func make_light(colour: Color, energy: float, offset := Vector2.ZERO, radius := 96) -> PointLight2D:
	var light := PointLight2D.new()
	light.texture = _light_texture(radius)
	light.color = colour
	light.energy = energy
	light.position = offset
	light.add_to_group("night_lights")
	return light


static var _light_textures := {}


static func _light_texture(radius: int) -> Texture2D:
	if not _light_textures.has(radius):
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		g.add_point(0.4, Color(1, 1, 1, 0.55))
		var tex := GradientTexture2D.new()
		tex.gradient = g
		tex.fill = GradientTexture2D.FILL_RADIAL
		tex.fill_from = Vector2(0.5, 0.5)
		tex.fill_to = Vector2(1.0, 0.5)
		tex.width = radius * 2
		tex.height = radius * 2
		_light_textures[radius] = tex
	return _light_textures[radius]


func _add_bounds() -> void:
	var body := StaticBody2D.new()
	body.name = "Bounds"
	body.collision_layer = WORLD_LAYER
	for r in [Rect2(-16, -16, size.x + 32, 16), Rect2(-16, size.y, size.x + 32, 16), Rect2(-16, 0, 16, size.y), Rect2(size.x, 0, 16, size.y)]:
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = r.size
		shape.shape = rect
		shape.position = r.get_center()
		body.add_child(shape)
	root.add_child(body)


## Drop items that burst out and can be picked up.
func drop(item: String, n: int, at: Vector2) -> void:
	for i in n:
		var p := Pickup.new(item)
		p.position = at
		entities.add_child(p)
		p.burst(Vector2.from_angle(randf() * TAU) * randf_range(10, 22))


var _pickup_labels := {}


## "+1 Wood" three times in a row becomes one "+3 Wood".
func pickup_text(item: String, at: Vector2) -> void:
	var entry = _pickup_labels.get(item)
	if entry and is_instance_valid(entry.label) and Time.get_ticks_msec() - entry.t < 900:
		entry.n += 1
		entry.t = Time.get_ticks_msec()
		entry.label.text = "+%d %s" % [entry.n, Inventory.display_name(item)]
		return
	var l := float_text("+1 " + Inventory.display_name(item), at, Color(1, 0.95, 0.7))
	_pickup_labels[item] = {"label": l, "n": 1, "t": Time.get_ticks_msec()}


func float_text(text: String, at: Vector2, colour := Color.WHITE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", colour)
	l.add_theme_color_override("font_outline_color", Color(0.1, 0.07, 0.05))
	l.add_theme_constant_override("outline_size", 2)
	l.z_index = 50
	l.position = at + Vector2(-20, -30)
	l.size = Vector2(40, 10)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	(root if root else self).add_child(l)
	var tw := l.create_tween()
	tw.tween_property(l, "position:y", l.position.y - 14, 0.7).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	tw.parallel().tween_property(l, "modulate:a", 0.0, 0.7).set_delay(0.3)
	tw.tween_callback(l.queue_free)
	return l


func _missing_assets() -> void:
	var l := Label.new()
	l.text = "Art pack not found.\n\nUnzip the Pixel Crawler Free Pack into\ngame/assets/ (see assets/README.md)\nand reopen the project."
	l.position = Vector2(40, 90)
	add_child(l)
