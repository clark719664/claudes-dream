class_name Enemy
extends CharacterBody2D
## Orcs and skeletons: wander near home, chase, telegraph, lunge, flinch, die, come back later.

const STATS := {
	"orc": {"hp": 26, "dmg": 8, "speed": 36, "aggro": 90, "loot": {"meat": 1}},
	"orc_rogue": {"hp": 20, "dmg": 7, "speed": 48, "aggro": 100, "loot": {"meat": 1}},
	"orc_shaman": {"hp": 22, "dmg": 10, "speed": 32, "aggro": 110, "loot": {"crystal": 1, "fiber": 2}},
	"orc_warrior": {"hp": 50, "dmg": 14, "speed": 30, "aggro": 90, "loot": {"meat": 2, "iron_bar": 1}},
	"skeleton": {"hp": 20, "dmg": 6, "speed": 40, "aggro": 100, "loot": {"bone": 1}},
	"skeleton_rogue": {"hp": 16, "dmg": 6, "speed": 52, "aggro": 110, "loot": {"bone": 1}},
	"skeleton_mage": {"hp": 18, "dmg": 9, "speed": 34, "aggro": 120, "loot": {"bone": 1, "crystal": 1}},
	"skeleton_warrior": {"hp": 38, "dmg": 11, "speed": 32, "aggro": 90, "loot": {"bone": 2, "iron_ore": 1}},
}
const RESPAWN := 120.0

enum State { IDLE, WANDER, CHASE, WINDUP, LUNGE, RECOVER, HURT, DEAD }

var actor: String
var stats: Dictionary
var hp := 1
var home := Vector2.ZERO
var state := State.IDLE
var body: AnimatedSprite2D
var bar: ColorRect
var _t := 0.0
var _dir := Vector2.ZERO
var _anim := ""
var _hit_player := false


func _init(actor_name := "orc") -> void:
	actor = actor_name
	stats = STATS.get(actor, STATS.orc)


func _ready() -> void:
	home = position
	hp = stats.hp
	add_to_group("hittable")
	add_to_group("enemies")
	collision_layer = 4
	collision_mask = 1
	var shape := CollisionShape2D.new()
	var c := CircleShape2D.new()
	c.radius = 5
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
	var back := ColorRect.new()
	back.color = Color(0.1, 0.05, 0.05, 0.8)
	back.size = Vector2(16, 2)
	back.position = Vector2(-8, -30)
	back.visible = false
	add_child(back)
	bar = ColorRect.new()
	bar.color = Color(0.85, 0.2, 0.2)
	bar.size = Vector2(16, 2)
	back.add_child(bar)
	_play("idle")
	_t = randf_range(0.5, 2.5)


func hit_centre() -> Vector2:
	return global_position + Vector2(0, -9)


func hit_radius() -> float:
	return 8.0 if state != State.DEAD else -999.0


func hit(damage: int, dir: Vector2, _by: Node) -> void:
	if state == State.DEAD:
		return
	hp -= damage
	FX.flash(body)
	FX.chips(get_parent(), hit_centre(), Color(0.75, 0.15, 0.12) if actor.begins_with("orc") else Color(0.9, 0.88, 0.8), 5)
	Game.world.float_text(str(damage), global_position + Vector2(0, -8), Color(1, 0.9, 0.4))
	bar.get_parent().visible = true
	bar.size.x = 16.0 * maxf(hp, 0) / stats.hp
	if hp <= 0:
		_die(dir)
		return
	Game.hitstop(0.04)
	state = State.HURT
	_t = 0.22
	velocity = dir * 130.0


func _physics_process(delta: float) -> void:
	if state == State.DEAD:
		return
	var player := Game.player as Player
	var night := Game.is_night()
	var speed: float = stats.speed * (1.25 if night else 1.0)
	var aggro: float = stats.aggro * (1.4 if night else 1.0)
	var to_player := Vector2.ZERO
	var dist := INF
	if player and not player.dead:
		to_player = player.global_position - global_position
		dist = to_player.length()
	_t -= delta
	match state:
		State.IDLE:
			velocity = Vector2.ZERO
			if dist < aggro:
				state = State.CHASE
			elif _t <= 0.0:
				state = State.WANDER
				_t = randf_range(1.0, 2.2)
				var target := home + Vector2.from_angle(randf() * TAU) * randf_range(8, 40)
				_dir = (target - global_position).normalized()
		State.WANDER:
			velocity = _dir * speed * 0.45
			if dist < aggro:
				state = State.CHASE
			elif _t <= 0.0:
				state = State.IDLE
				_t = randf_range(1.0, 3.0)
		State.CHASE:
			if dist > aggro * 1.6 or global_position.distance_to(home) > 260.0:
				state = State.WANDER
				_dir = (home - global_position).normalized()
				_t = 2.0
			elif dist < 22.0:
				state = State.WINDUP
				_t = 0.38
				_dir = to_player.normalized()
				velocity = Vector2.ZERO
			else:
				velocity = to_player.normalized() * speed
		State.WINDUP:
			velocity = -_dir * 10.0
			body.modulate = Color(1.3, 1.1, 1.1) if int(_t * 20.0) % 2 == 0 else Color.WHITE
			if _t <= 0.0:
				body.modulate = Color.WHITE
				state = State.LUNGE
				_t = 0.18
				_hit_player = false
		State.LUNGE:
			velocity = _dir * speed * 4.2
			if not _hit_player and player and dist < 13.0:
				_hit_player = true
				player.take_damage(stats.dmg, global_position)
			if _t <= 0.0:
				state = State.RECOVER
				_t = 0.55
		State.RECOVER:
			velocity = velocity.move_toward(Vector2.ZERO, 500.0 * delta)
			if _t <= 0.0:
				state = State.CHASE
		State.HURT:
			velocity = velocity.move_toward(Vector2.ZERO, 700.0 * delta)
			if _t <= 0.0:
				state = State.CHASE
	move_and_slide()
	if absf(velocity.x) > 2.0:
		var left := velocity.x < 0
		if left != body.flip_h:
			body.flip_h = left
			body.offset = Pack.actor_offset(actor, _anim, left)
	_play("run" if velocity.length() > 4.0 else "idle")


func _die(dir: Vector2) -> void:
	state = State.DEAD
	velocity = Vector2.ZERO
	remove_from_group("hittable")
	bar.get_parent().visible = false
	collision_layer = 0
	_play("death")
	Game.hitstop(0.07)
	Game.shake(2.5)
	Game.note_kill(actor)
	for item in stats.loot:
		Game.world.drop(item, stats.loot[item], global_position + dir * 4.0)
	await get_tree().create_timer(4.0).timeout
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 0.0, 0.8)
	await tw.finished
	visible = false
	await get_tree().create_timer(RESPAWN).timeout
	_respawn()


func _respawn() -> void:
	position = home
	hp = stats.hp
	state = State.IDLE
	modulate.a = 1.0
	visible = true
	collision_layer = 4
	add_to_group("hittable")
	_anim = ""
	_play("idle")


func _play(anim: String) -> void:
	if anim == _anim:
		return
	_anim = anim
	body.play(anim)
	body.offset = Pack.actor_offset(actor, anim, body.flip_h)
