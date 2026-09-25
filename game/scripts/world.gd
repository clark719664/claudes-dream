class_name World
extends Node2D
## Builds the valley from data/world.dat and data/world_tiles.bin (both written by
## tools/make_world.py) and hosts it.
##
## The map is big, so only the part around the player exists at any time. Objects are stored in
## 32x32-tile chunks; chunks near the player are spawned a slice per frame and freed again once
## the player has moved well away. People, stations, minecart stops and your cabin always exist.
## Anything the player chops, breaks or kills is remembered for a while, so walking away and back
## doesn't bring it straight back.

const FLAT_DECOR := ["tuft", "tuft_dry", "fern", "mushroom", "mushroom_tall", "twig", "pebble", "leaves", "debris", "soil", "puddle", "log", "rail_h", "rail_v", "broken"]
const WORLD_LAYER := 1
const CHUNK := 32                       # tiles
const CHUNK_PX := CHUNK * 16
const SPAWN_BUDGET := 90                # objects per frame while streaming in
const REGROW_MS := 180000

var size := Vector2.ZERO
var entities: Node2D   # everything that stands up, sorted by feet position
var decor: Node2D      # flat things on the ground
var player: Player
var cabin: House
var interior: Interior
var pois: Array = []
var map_image: Image

var _chunks := {}      # Vector2i -> Array of object dictionaries
var _loaded := {}      # Vector2i -> Array of nodes
var _tall := {}        # Vector2i -> Array of [node, sprite] that fade when the player is behind
var _queue: Array = [] # [chunk, index] still to spawn
var _depleted := {}    # "cx,cy,i" -> ticks when it was used up
var _stream_t := 0.0
var focus = null       # when set (a Vector2), stream around this point instead of the player


func _ready() -> void:
	Game.world = self
	if not Pack.ok:
		_missing_assets()
		return
	var raw := FileAccess.get_file_as_bytes("res://data/world.dat")
	var data: Dictionary = JSON.parse_string(raw.decompress_dynamic(-1, FileAccess.COMPRESSION_DEFLATE).get_string_from_utf8())
	size = Vector2(data.width, data.height) * 16
	pois = data.get("pois", [])
	var loaded := Game.load_game()
	decor = Node2D.new()
	decor.name = "Decor"
	decor.z_index = -4
	entities = Node2D.new()
	entities.name = "Entities"
	entities.y_sort_enabled = true
	var built := Terrain.new().build(self, entities, data, "res://data/world_tiles.bin")
	add_child(decor)
	add_child(entities)
	for body in built.bodies:
		add_child(body)
	_add_bounds()
	entities.add_child(Fences.build(data.get("fences", {})))
	for m in built.mines:
		spawn({"t": "mine_entrance", "x": m.x, "y": m.y})
	for o in data.persistent:
		spawn(o)
	for k in data.chunks:
		var xy: PackedStringArray = k.split(",")
		_chunks[Vector2i(int(xy[0]), int(xy[1]))] = data.chunks[k]
	var map_bytes := FileAccess.get_file_as_bytes("res://data/world_map.png")
	if not map_bytes.is_empty():
		map_image = Image.new()
		map_image.load_png_from_buffer(map_bytes)
	interior = Interior.new()
	add_child(interior)
	interior.build(Game.cabin_tier, entities)
	add_child(DayNight.new())
	add_child(Ambience.new())
	var hud := Hud.new()
	add_child(hud)
	if loaded:
		enter_cabin(true)
		player.global_position = interior.door_inside() + Vector2(0, -40)
		Game.say("Welcome back. Day %d." % Game.day)
	else:
		stream_now()
	if "--demo" in OS.get_cmdline_user_args():
		add_child(load("res://scripts/demo.gd").new())


func _process(delta: float) -> void:
	if player == null:
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


# ---------------------------------------------------------------- streaming
## Load everything around the player right away (after a teleport, at the start).
func stream_now() -> void:
	_stream(true)


func _stream(sync: bool) -> void:
	if Game.area != "world":
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
	for i in objs.size():
		var o: Dictionary = objs[i]
		if o.t in FLAT_DECOR or o.t.begins_with("flower_"):
			batch.add(o.t, int(o.get("v", 0)), Vector2(o.x, o.y))
		elif sync:
			_spawn_chunk_object(c, i)
		else:
			_queue.append([c, i])
	batch.queue_redraw()


func _spawn_chunk_object(c: Vector2i, i: int) -> void:
	var key := "%d,%d,%d" % [c.x, c.y, i]
	if _depleted.has(key):
		if Time.get_ticks_msec() - int(_depleted[key]) < REGROW_MS:
			return
		_depleted.erase(key)
	var node := spawn(_chunks[c][i])
	if node == null:
		return
	node.set_meta("okey", key)
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


## Chopped trees, broken rocks and killed enemies stay gone for a while even if their chunk
## unloads.
func note_depleted(node: Node) -> void:
	if node.has_meta("okey"):
		_depleted[node.get_meta("okey")] = Time.get_ticks_msec()


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


# ---------------------------------------------------------------- spawning
## Create the node for one object from the world data.
func spawn(o: Dictionary) -> Node2D:
	var pos := Vector2(o.x, o.y)
	var t: String = o.t
	var v := int(o.get("v", 0))
	var node: Node2D
	match t:
		"player_start":
			if player != null:
				return null
			player = Player.new()
			node = player
		"npc", "villager":
			var npc := Npc.new(o.actor, o.get("name", "Villager"), o.get("lines", "merlo" if o.actor == "wizard" else "villager"), float(o.get("span", 0)))
			if o.has("say"):
				npc.custom = o.say
			node = npc
		"enemy":
			node = Enemy.new(o.actor)
		"crop":
			node = Crop.new(o.kind, int(o.stage))
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
			node = Gate.new(o.get("style", "picket"))
		"deck":
			node = Deck.new(o.kind, int(o.w), int(o.h))
		"house":
			node = House.new(o.get("style", "log"), o.get("name", ""), false, int(o.get("gables", 1)))
		"cabin":
			cabin = House.new(Inventory.CABIN_TIERS[Game.cabin_tier].style, "Your cabin", true)
			cabin.entered.connect(enter_cabin)
			node = cabin
		"forage":
			node = Forage.new(o.item, o.sprite, v)
		_:
			var s := Pack.spec(t, v)
			if s.has("chest") and Game.opened.has(str(o.get("id", ""))):
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
				var at := Vector2(10, -22) if t == "lamp_post" else Vector2(0, -6)
				node.add_child(make_light(Color(1.0, 0.78, 0.45), 0.9, at, 72))
	if o.has("flip") and node is Node2D:
		node.scale.x = -1
	node.position = pos
	entities.add_child(node)
	return node


## Step through the cabin door. `quiet` skips the fade (waking up, passing out).
func enter_cabin(quiet := false) -> void:
	if not quiet:
		await Game.hud.fade(true)
	Game.area = "cabin"
	player.global_position = interior.door_inside() + Vector2(0, -6)
	player.facing = Vector2.UP
	player.set_room(interior.room_rect())
	if not quiet:
		await Game.hud.fade(false)


func exit_cabin() -> void:
	await Game.hud.fade(true)
	Game.area = "world"
	player.global_position = cabin.global_position + Vector2(0, 12)
	player.facing = Vector2.DOWN
	player.set_room(Rect2(Vector2.ZERO, size))
	stream_now()
	await Game.hud.fade(false)


## Ride the minecart to another stop.
func travel_to(id: String) -> void:
	for m in get_tree().get_nodes_in_group("minecarts"):
		if m.id == id:
			await Game.hud.fade(true)
			player.global_position = m.global_position + Vector2(0, 22)
			player.facing = Vector2.DOWN
			stream_now()
			await get_tree().create_timer(0.3).timeout
			await Game.hud.fade(false)
			Game.say("You rattle into %s." % m.label)
			return


func rebuild_cabin() -> void:
	cabin.rebuild(Inventory.CABIN_TIERS[Game.cabin_tier].style)
	interior.build(Game.cabin_tier, entities)
	if Game.area == "cabin":
		player.set_room(interior.room_rect())


## Mornings: forage grows back, and so does everything that was chopped or broken.
func new_day() -> void:
	_depleted.clear()
	for f in get_tree().get_nodes_in_group("forage"):
		f.regrow()


func _physics_process(_delta: float) -> void:
	if Game.area == "cabin" and player and player.global_position.y > interior.exit_line() and not player.dead:
		Game.area = "leaving"
		exit_cabin()


## A static, possibly solid, prop with its shadow. `solid` overrides the catalog's radius.
func prop(t: String, v := 0, solid := -1.0) -> Node2D:
	var s := Pack.spec(t, v)
	var root: Node2D
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
		root = body
	else:
		root = Node2D.new()
	add_shadow(root, s)
	var sprite := Pack.sprite(t, v)
	root.add_child(sprite)
	if sprite.texture and sprite.texture.get_size().y > 60:
		root.set_meta("tall", sprite)
	return root


## An animated prop from the catalog's anims (a camp grill, a bubbling alchemy table).
func anim_prop(anim_name: String, solid := 0.0, lit := true) -> Node2D:
	var root: Node2D
	if solid > 0:
		var body := StaticBody2D.new()
		body.collision_layer = WORLD_LAYER
		body.collision_mask = 0
		body.add_child(foot_shape(solid))
		root = body
	else:
		root = Node2D.new()
	var sh := Pack.sprite("shadow_tree")
	sh.z_index = -1
	sh.position = Vector2(0, -2)
	root.add_child(sh)
	root.add_child(Pack.anim_node(anim_name))
	if lit and (anim_name.begins_with("grill") or anim_name.begins_with("fire") or anim_name in ["meat_rack", "kitchen_range", "cooker", "pan"]):
		root.add_child(make_light(Color(1.0, 0.58, 0.28), 0.9, Vector2(0, -10), 80))
	return root


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
	add_child(body)


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
	add_child(l)
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
