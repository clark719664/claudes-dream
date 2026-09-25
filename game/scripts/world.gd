class_name World
extends Node2D
## Builds the level from data/world.json (terrain grid + placed objects) and hosts it.

const FLAT_DECOR := ["tuft", "tuft_dry", "fern", "mushroom", "mushroom_tall", "twig", "pebble", "leaves"]
const WORLD_LAYER := 1

var size := Vector2.ZERO
var entities: Node2D   # everything that stands up, sorted by feet position
var decor: Node2D      # flat things on the ground
var player: Player


func _ready() -> void:
	Game.world = self
	if not Pack.ok:
		_missing_assets()
		return
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/world.json"))
	var rows := PackedStringArray(data.terrain)
	size = Vector2(data.width, data.height) * 16
	var blocked := Terrain.new().build(self, rows, int(data.seed))
	_add_water_collision(blocked)
	_add_bounds()
	decor = Node2D.new()
	decor.name = "Decor"
	decor.z_index = -5
	add_child(decor)
	entities = Node2D.new()
	entities.name = "Entities"
	entities.y_sort_enabled = true
	add_child(entities)
	for o in data.objects:
		spawn(o)
	add_child(DayNight.new())
	var hud := Hud.new()
	add_child(hud)
	if "--demo" in OS.get_cmdline_user_args():
		add_child(load("res://scripts/demo.gd").new())


## Create the node for one entry of world.json's object list.
func spawn(o: Dictionary) -> Node2D:
	var pos := Vector2(o.x, o.y)
	var t: String = o.t
	var v := int(o.get("v", 0))
	var node: Node2D
	match t:
		"player_start":
			player = Player.new()
			node = player
		"npc":
			node = Npc.new(o.actor, o.get("name", "Stranger"))
		"enemy":
			node = Enemy.new(o.actor)
		"crop":
			node = Crop.new(o.kind, int(o.stage))
		"campfire":
			node = Campfire.new()
		_:
			var s := Pack.spec(t, v)
			if s.has("station"):
				node = Station.new(t, v)
			elif s.has("hp"):
				node = Harvestable.new(t, v)
			elif t in FLAT_DECOR or t.begins_with("flower_") or t == "soil":
				var sprite := Pack.sprite(t, v)
				sprite.position = pos
				if t == "soil":
					sprite.z_index = -1
				decor.add_child(sprite)
				return sprite
			else:
				node = prop(t, v)
			if o.get("light", 0):
				node.add_child(make_light(Color(1.0, 0.62, 0.3), 1.1, Vector2(0, -10)))
	node.position = pos
	entities.add_child(node)
	return node


## A static, possibly solid, prop with its shadow.
func prop(t: String, v := 0) -> Node2D:
	var s := Pack.spec(t, v)
	var root: Node2D
	var solid := float(s.get("solid", 0))
	if solid > 0:
		var body := StaticBody2D.new()
		body.collision_layer = WORLD_LAYER
		body.collision_mask = 0
		body.add_child(foot_shape(solid))
		root = body
	else:
		root = Node2D.new()
	add_shadow(root, s)
	root.add_child(Pack.sprite(t, v))
	return root


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
	light.texture = tex
	light.color = colour
	light.energy = energy
	light.position = offset
	light.add_to_group("night_lights")
	return light


func _add_water_collision(cells: Array[Vector2i]) -> void:
	var body := StaticBody2D.new()
	body.name = "Water"
	body.collision_layer = WORLD_LAYER
	body.collision_mask = 0
	var set := {}
	for c in cells:
		set[c] = true
	# merge horizontal runs into single rectangles
	for c in cells:
		if set.has(c + Vector2i.LEFT):
			continue
		var run := 1
		while set.has(c + Vector2i(run, 0)):
			run += 1
		var shape := CollisionShape2D.new()
		var r := RectangleShape2D.new()
		r.size = Vector2(run * 16, 12)
		shape.shape = r
		shape.position = Vector2(c.x * 16 + run * 8, c.y * 16 + 8)
		body.add_child(shape)
	add_child(body)


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


func float_text(text: String, at: Vector2, colour := Color.WHITE) -> void:
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


func _missing_assets() -> void:
	var l := Label.new()
	l.text = "Art pack not found.\n\nUnzip the Pixel Crawler Free Pack into\ngame/assets/ (see assets/README.md)\nand reopen the project."
	l.position = Vector2(40, 90)
	add_child(l)
