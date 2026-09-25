class_name Player
extends CharacterBody2D
## The hooded rogue: walks, uses whatever is selected in the toolbar (a sword, an axe, a hoe, the
## watering can, seeds, a kit to set up), gathers, crafts, eats.

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
var _lantern: PointLight2D
var slot := 0                       # the selected toolbar slot
var _action := Callable()           # what the current swing does when it lands (tools)
var _cursor: Node2D


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
	_lantern = World.make_light(Color(1.0, 0.85, 0.55), 0.0, Vector2(0, -10), 90)
	_lantern.remove_from_group("night_lights")
	add_child(_lantern)
	Inventory.changed.connect(_refresh_weapon)
	_refresh_weapon()
	_play("idle")
	_cursor = TileCursor.new()
	_cursor.top_level = true
	add_child(_cursor)


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
	if Game.has_buff("haste"):
		speed *= 1.3
	if Game.energy <= 0:
		speed *= 0.6
	max_hp = 130 if Inventory.has("backpack") else 100
	var glow := Inventory.has("lantern") and Game.darkness() > 0.3
	_lantern.enabled = glow
	_lantern.energy = Game.darkness() * 1.1 if glow else 0.0
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
	_update_cursor()


func _unhandled_input(event: InputEvent) -> void:
	if dead or get_tree().paused:
		return
	for i in 10:
		if event.is_action_pressed("slot_%d" % i):
			select(i)
			return
	if event.is_action_pressed("slot_next"):
		select((slot + 1) % 10)
	elif event.is_action_pressed("slot_prev"):
		select((slot + 9) % 10)
	elif event.is_action_pressed("attack") and _attack_t <= 0.0:
		use_selected()
	elif event.is_action_pressed("interact"):
		_interact()
	elif event.is_action_pressed("eat"):
		eat()
	elif event.is_action_pressed("craft"):
		Game.hud.open_crafting("hands")
	elif event.is_action_pressed("inventory"):
		Game.hud.toggle_inventory()
	elif event.is_action_pressed("map"):
		Game.hud.toggle_map()


func select(i: int) -> void:
	slot = i
	_refresh_weapon()
	Inventory.changed.emit()


func selected() -> String:
	return Inventory.slot(slot)


## The cell in front of you (the one the hoe, the can and seeds work on).
func facing_cell() -> Vector2i:
	var d := Vector2(signf(facing.x), 0) if absf(facing.x) > absf(facing.y) else Vector2(0, signf(facing.y))
	var p := global_position + Vector2(0, -4) + d * 13.0
	return Vector2i(floori(p.x / 16.0), floori(p.y / 16.0))


## Use what's selected in the toolbar.
func use_selected() -> void:
	var item := selected()
	var cell := facing_cell()
	var w := Game.world
	if item == "hoe":
		_swing(item, func(): _till(cell), 2)
	elif item == "watering_can":
		_swing(item, func(): _water(cell), 2)
	elif item == "scythe":
		_swing(item, _scythe, 1)
	elif Inventory.is_seed(item):
		_plant(cell, item)
	elif item.begins_with("kit_") or item == "fence":
		if w.place(item, cell):
			Inventory.take(item)
			Game.say("Set up the %s." % Inventory.display_name(item).replace(" Kit", "").to_lower() if item != "fence" else "")
		elif w.area_id != "farm":
			Game.say("You can only build on your farm.")
		else:
			Game.say("There's no room there.")
	elif Inventory.FOOD.has(item):
		eat_item(item)
	elif item in Inventory.AXES and w.area_id == "farm" and w.remove_fence(cell):
		_swing(item, Callable(), 1)
	elif item in Inventory.PICKAXES and w.soil and w.soil.clear(cell):
		_swing(item, Callable(), 1)
	else:
		_start_attack()


func _swing(item: String, action: Callable, cost: int) -> void:
	if cost > 0 and not Game.use_energy(cost):
		return
	_held = item
	_set_weapon_texture(_held)
	_attack_t = ATTACK_TIME
	_struck = false
	_action = action


func _till(cell: Vector2i) -> void:
	var w := Game.world
	if w.soil == null or not w.farmable(cell):
		Game.say("The ground here is too hard to dig." if w.area_id == "farm" else "You can only farm on your farm.")
		return
	if w.soil.has_soil(cell):
		return
	if w.cell_blocked(cell):
		Game.say("Clear that away first.")
		return
	w.soil.till(cell)
	w.clear_decor(cell)
	FX.chips(w.entities, Vector2(cell) * 16 + Vector2(8, 10), Color(0.5, 0.36, 0.22), 6)


func _water(cell: Vector2i) -> void:
	var w := Game.world
	for c in [cell, facing_cell() + Vector2i(signi(int(facing.x)), 0)]:
		if w.ground_at(c) == "~":
			Inventory.water = Inventory.CAN_SIZE
			Inventory.changed.emit()
			Game.say("Filled the watering can.")
			FX.chips(w.entities, Vector2(c) * 16 + Vector2(8, 8), Color(0.5, 0.7, 1.0), 8)
			return
	if Inventory.water <= 0:
		Game.say("The can is empty. Fill it at the pond.")
		return
	Inventory.water -= 1
	Inventory.changed.emit()
	FX.chips(w.entities, Vector2(cell) * 16 + Vector2(8, 10), Color(0.5, 0.7, 1.0), 6)
	if w.soil and w.soil.water(cell):
		Game.note("watered")


func _scythe() -> void:
	var point := global_position + Vector2(0, -6) + facing * 12.0
	for n in get_tree().get_nodes_in_group("hittable"):
		if n is Harvestable and n.kind == "fiber" and n.hit_centre().distance_to(point) < 22.0:
			n.hit(3, facing, self)


func _plant(cell: Vector2i, seed: String) -> void:
	var w := Game.world
	var kind := seed.trim_suffix("_seeds")
	if w.soil == null or not w.soil.has_soil(cell):
		Game.say("Seeds go in tilled soil. Dig with the hoe first.")
		return
	if not (Game.season() in Inventory.CROPS[kind].seasons):
		Game.say("%s won't grow in %s." % [Inventory.display_name(kind), Game.SEASONS[Game.season()]])
		return
	if w.soil.plant(cell, kind):
		Inventory.take(seed)
		Game.note("planted")


func _start_attack() -> void:
	var target := _target_in_front()
	_held = Inventory.weapon()
	var sel := selected()
	if sel in Inventory.WEAPONS or sel in Inventory.AXES or sel in Inventory.PICKAXES:
		_held = sel
	var tool := false
	if target is Harvestable:
		if target.kind == "wood" and Inventory.best(Inventory.AXES) != "":
			_held = Inventory.best(Inventory.AXES)
			tool = true
		elif target.kind == "stone" and Inventory.best(Inventory.PICKAXES) != "":
			_held = Inventory.best(Inventory.PICKAXES)
			tool = true
	if tool and not Game.use_energy(2):
		return
	_set_weapon_texture(_held)
	_attack_t = ATTACK_TIME
	_struck = false
	_action = Callable()
	FX.slash(get_parent(), global_position + Vector2(0, -9) + facing * 12.0, facing, Color(1, 1, 1, 0.85))


func _update_cursor() -> void:
	var item := selected()
	var show := item in ["hoe", "watering_can"] or Inventory.is_seed(item) or item.begins_with("kit_") or item == "fence"
	_cursor.visible = show and Game.world.soil != null
	if _cursor.visible:
		_cursor.global_position = Vector2(facing_cell()) * 16


func _update_swing() -> void:
	var t := 1.0 - _attack_t / ATTACK_TIME
	# wind back a touch, then sweep through
	var ang := lerpf(-70.0, 120.0, ease(clampf(t * 1.6, 0.0, 1.0), 0.4))
	weapon.rotation_degrees = ang
	if t > 0.22 and not _struck:
		_struck = true
		if _action.is_valid():
			_action.call()
		elif not (_held in ["hoe", "watering_can", "scythe"]):
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
			var dmg: int = Inventory.WEAPONS.get(_held, Inventory.FIST_DAMAGE if _held == "" else 4)
			if Game.has_buff("might"):
				dmg = int(dmg * 1.5)
			n.hit(dmg, facing, self)
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
	if hp >= max_hp and Game.energy >= Game.MAX_ENERGY:
		Game.say("You're not hungry.")
		return
	var food := Inventory.best_food(max_hp - hp)
	if food == "":
		Game.say("Nothing to eat. Cook at the pot or harvest the farm.")
		return
	eat_item(food)


func eat_item(food: String) -> void:
	if not Inventory.take(food):
		return
	heal(Inventory.FOOD[food])
	Game.restore_energy(Inventory.energy_of(food))
	Game.say("Ate %s. (+%d energy)" % [Inventory.display_name(food), Inventory.energy_of(food)])
	if Inventory.BUFFS.has(food):
		Game.add_buff(Inventory.BUFFS[food][0], Inventory.BUFFS[food][1])


func heal(n: int) -> void:
	hp = mini(hp + n, max_hp)
	Game.world.float_text("+%d" % n, global_position, Color(0.55, 1.0, 0.5))


func take_damage(amount: int, from: Vector2) -> void:
	if dead or _invuln > 0.0:
		return
	amount = int(ceil(amount * Inventory.damage_taken_factor()))
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
	hp = max_hp
	Game.energy = mini(Game.energy, Game.MAX_ENERGY / 2)
	dead = false
	weapon.visible = true
	_invuln = 1.5
	await Game.world.go_to("house", "bed")
	Game.say("You wake up at home, aching all over.")


## Keep the camera inside an area; rooms smaller than the screen are centred.
func set_room(r: Rect2) -> void:
	var view := Vector2(480, 270)
	var c := r.get_center()
	var half := Vector2(maxf(r.size.x, view.x), maxf(r.size.y + 24, view.y)) / 2.0
	camera.limit_left = int(c.x - half.x)
	camera.limit_right = int(c.x + half.x)
	camera.limit_top = int(c.y - half.y)
	camera.limit_bottom = int(c.y + half.y)
	camera.reset_smoothing()


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
	var sel := selected()
	_held = sel if sel in Inventory.TOOLS else Inventory.weapon()
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
	weapon.modulate = Inventory.tint(item)


## The outline of the cell you're working on, shown while holding a hoe, the can, seeds or a kit.
class TileCursor extends Node2D:
	func _ready() -> void:
		z_index = 40

	func _draw() -> void:
		var c := Color(1, 1, 1, 0.55)
		draw_rect(Rect2(0.5, 0.5, 15, 15), c, false, 1.0)
