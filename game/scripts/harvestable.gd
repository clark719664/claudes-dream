class_name Harvestable
extends StaticBody2D
## Trees, rocks, ore, crystals and bushes: hit them for materials, they grow back.

const REGROW := 180.0

var sprite_name: String
var variant := 0
var spec: Dictionary
var kind := "wood"      # which tool helps: wood -> axe, stone -> pickaxe
var hp := 1
var sprite: Sprite2D
var shadow: Sprite2D
var stump: Node2D
var _tall := false
var _fade := 1.0


func _init(name_: String, v := 0) -> void:
	sprite_name = name_
	variant = v
	spec = Pack.spec(name_, v)
	var drop: String = spec.get("drop", "wood")
	kind = "stone" if drop in ["stone", "iron_ore", "crystal"] else ("fiber" if drop == "fiber" else "wood")


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	add_child(World.foot_shape(float(spec.get("solid", 4))))
	shadow = World.add_shadow(self, spec)
	sprite = Pack.sprite(sprite_name, variant)
	sprite.material = FX.flash_material()
	add_child(sprite)
	if spec.has("overlay"):
		var bits := Pack.sprite(spec.overlay, randi() % Pack.variant_count(spec.overlay))
		bits.position = Vector2(randi_range(-3, 3), -3)
		sprite.add_child(bits)
	_tall = sprite.texture.get_size().y > 40
	_grow()


func _grow() -> void:
	hp = int(spec.hp)
	sprite.visible = true
	if shadow:
		shadow.visible = true
	if stump:
		stump.queue_free()
		stump = null
	collision_layer = 1
	add_to_group("hittable")


func hit_centre() -> Vector2:
	return global_position + Vector2(0, -6)


func hit_radius() -> float:
	return float(spec.get("solid", 4)) + 2.0


func hit(damage: int, dir: Vector2, _by: Node) -> void:
	var power := 1
	if kind == "wood":
		power = 3 if Inventory.has("axe") else 1
	elif kind == "stone":
		if spec.drop == "iron_ore" and not Inventory.has("pickaxe"):
			Game.say("Too hard. You need a pickaxe (workbench).")
			FX.chips(get_parent(), hit_centre(), Color(0.6, 0.6, 0.6), 2)
			return
		power = 3 if Inventory.has("pickaxe") else 1
	else:
		power = 2
	hp -= power
	FX.flash(sprite, 0.08)
	var colour := Color(0.55, 0.35, 0.2) if kind == "wood" else (Color(0.6, 0.62, 0.66) if kind == "stone" else Color(0.4, 0.6, 0.2))
	if spec.drop == "crystal":
		colour = Color(0.4, 0.7, 1.0)
	FX.chips(get_parent(), hit_centre() + Vector2(0, -4), colour, 5)
	_wobble(dir)
	if hp <= 0:
		_break(dir)


func _wobble(dir: Vector2) -> void:
	var tw := sprite.create_tween()
	var lean := 0.06 if dir.x >= 0 else -0.06
	if not _tall:
		lean *= 2.0
	tw.tween_property(sprite, "rotation", lean, 0.05)
	tw.tween_property(sprite, "rotation", -lean * 0.5, 0.08)
	tw.tween_property(sprite, "rotation", 0.0, 0.08)


func _break(dir: Vector2) -> void:
	remove_from_group("hittable")
	var drop: String = spec.drop
	var n := 1
	match sprite_name:
		"oak_big", "pine_big": n = 5
		"oak", "pine": n = 3
		"boulder", "boulder_brown": n = 4
		"ore_rock": n = 2
		"bush_big": n = 3
		_: n = 2 if drop != "crystal" else 1
	Game.world.drop(drop, n, global_position + Vector2(0, -4) + dir * 6.0)
	if kind == "wood" and randf() < 0.3:
		Game.world.drop("fiber", 1, global_position)
	if kind == "stone" and randf() < 0.25:
		Game.world.drop("coal" if drop == "stone" else "stone", 1, global_position)
	sprite.visible = false
	if spec.has("stump"):
		stump = Pack.sprite(spec.stump)
		add_child(stump)
	else:
		collision_layer = 0
		if shadow:
			shadow.visible = false
	Game.shake(2.0)
	await get_tree().create_timer(REGROW * randf_range(0.8, 1.3)).timeout
	# don't pop back on top of the player
	while Game.player and Game.player.global_position.distance_to(global_position) < 30.0:
		await get_tree().create_timer(2.0).timeout
	_grow()


func _process(delta: float) -> void:
	# tall trees turn see-through while the player is behind them
	if not _tall or not sprite.visible or Game.player == null:
		return
	var p := Game.player.global_position
	var sz := sprite.texture.get_size()
	var behind := p.y < global_position.y - 2 and p.y > global_position.y - sz.y + 8 and absf(p.x - global_position.x) < sz.x * 0.42
	_fade = move_toward(_fade, 0.5 if behind else 1.0, delta * 3.0)
	sprite.modulate.a = _fade
