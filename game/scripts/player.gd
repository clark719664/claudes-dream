class_name Player
extends CharacterBody2D
## The hooded rogue: walks, swings whatever it holds, gathers, crafts, eats.

const WALK := 72.0
const SPRINT := 112.0
const ATTACK_TIME := 0.32
const REACH := 16.0

var actor := "rogue"
var max_hp := 100
var hp := 100
var facing := Vector2.RIGHT
var dead := false
var start := Vector2.ZERO

var body: AnimatedSprite2D
var weapon_pivot: Node2D
var weapon: Sprite2D
var camera: Camera2D
var _attack_t := 0.0
var _invuln := 0.0
var _knock := Vector2.ZERO
var _anim := ""
var _struck := false
var _held := ""


func _ready() -> void:
	start = position
	Game.player = self
	add_to_group("player")
	collision_layer = 2
	collision_mask = 1
	var shape := CollisionShape2D.new()
	var c := CircleShape2D.new()
	c.radius = 4.5
	shape.shape = c
	shape.position = Vector2(0, -3)
	add_child(shape)
	var sh := Pack.sprite("shadow_actor")
	sh.z_index = -1
	add_child(sh)
	body = AnimatedSprite2D.new()
	body.sprite_frames = Pack.frames(actor)
	body.centered = false
	body.material = FX.flash_material()
	add_child(body)
	weapon_pivot = Node2D.new()
	weapon_pivot.position = Vector2(3, -8)
	add_child(weapon_pivot)
	weapon = Sprite2D.new()
	weapon.centered = false
	weapon.scale = Vector2(0.75, 0.75)
	weapon_pivot.add_child(weapon)
	camera = Camera2D.new()
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 7.0
	camera.offset = Vector2(0, -12)
	add_child(camera)
	var world := get_parent().get_parent() as Node2D
	if world and "size" in world:
		camera.limit_left = 0
		camera.limit_top = 0
		camera.limit_right = int(world.size.x)
		camera.limit_bottom = int(world.size.y)
	Inventory.changed.connect(_refresh_weapon)
	_refresh_weapon()
	_play("idle")


func _physics_process(delta: float) -> void:
	if dead:
		return
	_invuln = maxf(_invuln - delta, 0.0)
	body.visible = _invuln <= 0.0 or int(_invuln * 20.0) % 2 == 0
	var input := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if _attack_t > 0.0:
		_attack_t -= delta
		_update_swing()
		input *= 0.25
	var speed := SPRINT if Input.is_action_pressed("sprint") else WALK
	velocity = input * speed + _knock
	_knock = _knock.move_toward(Vector2.ZERO, 600.0 * delta)
	move_and_slide()
	if input.length() > 0.1 and _attack_t <= 0.0:
		facing = input.normalized()
	if absf(facing.x) > 0.05 and body.flip_h != (facing.x < 0):
		body.flip_h = facing.x < 0
		weapon_pivot.scale.x = -1.0 if facing.x < 0 else 1.0
		weapon_pivot.position.x = -4.0 if facing.x < 0 else 4.0
		body.offset = Pack.actor_offset(actor, _anim, body.flip_h)
	_play("run" if input.length() > 0.1 else "idle")
	body.speed_scale = 1.4 if speed == SPRINT and input.length() > 0.1 else 1.0


func _unhandled_input(event: InputEvent) -> void:
	if dead or get_tree().paused:
		return
	if event.is_action_pressed("attack") and _attack_t <= 0.0:
		_start_attack()
	elif event.is_action_pressed("interact"):
		_interact()
	elif event.is_action_pressed("eat"):
		eat()


func _start_attack() -> void:
	var target := _target_in_front()
	_held = Inventory.weapon()
	if target is Harvestable:
		if target.kind == "wood" and Inventory.has("axe"):
			_held = "axe"
		elif target.kind == "stone" and Inventory.has("pickaxe"):
			_held = "pickaxe"
	_set_weapon_texture(_held)
	_attack_t = ATTACK_TIME
	_struck = false
	FX.slash(get_parent(), global_position + Vector2(0, -9) + facing * 12.0, facing, Color(1, 1, 1, 0.85))


func _update_swing() -> void:
	var t := 1.0 - _attack_t / ATTACK_TIME
	# wind back a touch, then sweep through
	var ang := lerpf(-70.0, 120.0, ease(clampf(t * 1.6, 0.0, 1.0), 0.4))
	weapon.rotation_degrees = ang
	if t > 0.22 and not _struck:
		_struck = true
		_strike()
	if _attack_t <= 0.0:
		_refresh_weapon()


func _strike() -> void:
	var point := global_position + Vector2(0, -8) + facing * 12.0
	var hit_any := false
	for n in get_tree().get_nodes_in_group("hittable"):
		if not is_instance_valid(n) or n == self:
			continue
		var centre: Vector2 = n.hit_centre()
		if centre.distance_to(point) <= REACH + n.hit_radius():
			n.hit(Inventory.damage(), facing, self)
			hit_any = true
	if hit_any:
		Game.shake(1.5)


func _target_in_front() -> Node:
	var point := global_position + Vector2(0, -8) + facing * 12.0
	var best: Node = null
	var best_d := INF
	for n in get_tree().get_nodes_in_group("hittable"):
		var d: float = n.hit_centre().distance_to(point) - n.hit_radius()
		if d < REACH and d < best_d:
			best = n
			best_d = d
	return best


func _interact() -> void:
	var point := global_position + facing * 10.0
	var best: Node = null
	var best_d := 26.0
	for n in get_tree().get_nodes_in_group("interactable"):
		var d: float = (n.global_position - point).length()
		if d < best_d:
			best = n
			best_d = d
	if best:
		best.interact(self)


func eat() -> void:
	if hp >= max_hp:
		Game.say("You're not hungry.")
		return
	var food := Inventory.best_food(max_hp - hp)
	if food == "":
		Game.say("Nothing to eat. Cook at the pot or harvest the farm.")
		return
	Inventory.take(food)
	heal(Inventory.FOOD[food])
	Game.say("Ate %s." % Inventory.display_name(food))


func heal(n: int) -> void:
	hp = mini(hp + n, max_hp)
	Game.world.float_text("+%d" % n, global_position, Color(0.55, 1.0, 0.5))


func take_damage(amount: int, from: Vector2) -> void:
	if dead or _invuln > 0.0:
		return
	if Inventory.has("shield"):
		amount = int(ceil(amount * 0.67))
	hp -= amount
	_invuln = 0.8
	_knock = (global_position - from).normalized() * 150.0
	FX.flash(body)
	Game.shake(3.0)
	Game.world.float_text("-%d" % amount, global_position, Color(1.0, 0.35, 0.3))
	if hp <= 0:
		_die()


func _die() -> void:
	dead = true
	hp = 0
	velocity = Vector2.ZERO
	weapon.visible = false
	_play("death")
	Game.say("You black out...")
	await get_tree().create_timer(2.5).timeout
	position = start
	hp = max_hp
	dead = false
	weapon.visible = true
	_invuln = 1.5
	Game.say("You wake up by the campfire.")


func shake(amount: float) -> void:
	var tw := camera.create_tween()
	for i in 4:
		tw.tween_property(camera, "offset", Vector2(randf_range(-amount, amount), -12 + randf_range(-amount, amount)), 0.03)
	tw.tween_property(camera, "offset", Vector2(0, -12), 0.04)


func _play(anim: String) -> void:
	if anim == _anim:
		return
	_anim = anim
	body.play(anim)
	body.offset = Pack.actor_offset(actor, anim, body.flip_h)


func _refresh_weapon() -> void:
	if _attack_t > 0.0:
		return
	_held = Inventory.weapon()
	_set_weapon_texture(_held)
	weapon.rotation_degrees = 35.0


func _set_weapon_texture(item: String) -> void:
	if item == "":
		weapon.texture = null
		return
	var t := Pack.icon(item)
	weapon.texture = t
	var sz := t.get_size()
	weapon.offset = Vector2(-sz.x * 0.5, -sz.y + 3)
	weapon.modulate = Color(0.78, 0.85, 1.0) if item == "sword_iron" else Color.WHITE
