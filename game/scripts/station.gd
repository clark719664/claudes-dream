class_name Station
extends StaticBody2D
## A crafting station. Three tiers each, drawn from the pack's own upgrade art; most are
## animated (fires flicker, the anvil rings, the sawmill blade spins). Walk up and press E.

var station: String
var tier := 1
var fixed := false          # a townsfolk's station: always this tier, just for show
var _visual: Node2D


func _init(name_: String, fixed_tier := 0) -> void:
	station = name_
	if fixed_tier > 0:
		tier = fixed_tier
		fixed = true


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	if not fixed:
		add_to_group("interactable")
		add_to_group("stations")
		tier = Game.station_tier(station)
	_build()


func _build() -> void:
	if _visual:
		_visual.queue_free()
	for c in get_children():
		if c is CollisionShape2D:
			c.queue_free()
	var s := Pack.station_spec(station, tier)
	_visual = Node2D.new()
	add_child(_visual)
	var w := float(s.get("solid", 16))
	var sh := Pack.sprite("shadow_tree")
	sh.scale = Vector2(clampf(w / 36.0, 0.5, 1.6), 0.8)
	sh.z_index = -1
	sh.position = Vector2(0, -2)
	_visual.add_child(sh)
	_visual.add_child(Pack.station_visual(station, tier))
	if s.has("flames"):
		var f := Pack.anim_node("flames_small")
		f.position = Vector2(s.flames[0], s.flames[1])
		_visual.add_child(f)
	for at in s.get("smoke", []):
		var sm := Pack.anim_node("smoke")
		sm.position = Vector2(at[0], at[1])
		sm.modulate.a = 0.7
		_visual.add_child(sm)
	if s.has("fire"):
		_visual.add_child(World.make_light(Color(1.0, 0.55, 0.25), 1.0, Vector2(s.fire[0], s.fire[1]), 88))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(w * 2.0, 12)
	shape.shape = rect
	shape.position = Vector2(0, -6)
	add_child(shape)


func display_name() -> String:
	return Pack.station_spec(station, tier).name


## Called by the crafting menu once the materials are paid.
func upgrade() -> void:
	tier += 1
	Game.station_tiers[station] = tier
	_build()
	FX.chips(get_parent(), global_position + Vector2(0, -10), Color(0.85, 0.75, 0.55), 16)
	Game.shake(2.0)
	for s in get_tree().get_nodes_in_group("stations"):
		if s.station == station and s != self:
			s.tier = tier
			s._build()


func interact(_player: Node) -> void:
	Game.hud.open_crafting(station, self)
