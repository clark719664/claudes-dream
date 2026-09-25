class_name Enemy
extends CharacterBody2D
## Everything that fights you: wander near home, chase, telegraph, lunge, flinch, die.
##
## The Pixel Crawler monsters (orcs, skeletons) animate from the pack; the PixelLab cast turns to
## face four ways and walks with PixelLab's own walk cycles. Nobody has drawn attack or death
## frames for the PixelLab cast, so those are acted out in code rather than faked: the body leans
## back to wind up, throws itself forward with a slash, recoils when hit and topples when it dies.
## Creatures with only a turnaround waddle as they move.

const STATS := {
	"orc": {"hp": 26, "dmg": 8, "speed": 36, "aggro": 90, "loot": {"meat": 1}},
	"orc_rogue": {"hp": 20, "dmg": 7, "speed": 48, "aggro": 100, "loot": {"meat": 1}},
	"orc_shaman": {"hp": 22, "dmg": 10, "speed": 32, "aggro": 110, "loot": {"crystal": 1, "fiber": 2}},
	"orc_warrior": {"hp": 50, "dmg": 14, "speed": 30, "aggro": 90, "loot": {"meat": 2, "iron_bar": 1}},
	"skeleton": {"hp": 20, "dmg": 6, "speed": 40, "aggro": 100, "loot": {"bone": 1}},
	"skeleton_rogue": {"hp": 16, "dmg": 6, "speed": 52, "aggro": 110, "loot": {"bone": 1}},
	"skeleton_mage": {"hp": 18, "dmg": 9, "speed": 34, "aggro": 120, "loot": {"bone": 1, "crystal": 1}},
	"skeleton_warrior": {"hp": 38, "dmg": 11, "speed": 32, "aggro": 90, "loot": {"bone": 2, "iron_ore": 1}},
	"myconid": {"hp": 30, "dmg": 10, "speed": 36, "aggro": 95, "loot": {"mushroom": 2, "herb": 1}},
	"bone_pax": {"hp": 34, "dmg": 11, "speed": 40, "aggro": 105, "loot": {"bone": 2, "gem": 1}},
	"thorn_vale": {"hp": 65, "dmg": 15, "speed": 34, "aggro": 110, "loot": {"herb": 3, "resin": 2, "gem": 1}},
	"spark_kael": {"hp": 70, "dmg": 16, "speed": 36, "aggro": 115, "loot": {"crystal": 2, "steel_bar": 1}},
	"archon_vex": {"hp": 85, "dmg": 18, "speed": 32, "aggro": 110, "loot": {"steel_bar": 2, "gem": 2}},
	"garrick": {"hp": 58, "dmg": 14, "speed": 30, "aggro": 95, "loot": {"iron_bar": 2, "coal": 2}},
	"reaper_m": {"hp": 44, "dmg": 13, "speed": 44, "aggro": 115, "loot": {"bone": 2, "cloth": 1}},
	"berserker_m": {"hp": 48, "dmg": 14, "speed": 42, "aggro": 100, "loot": {"meat": 2, "iron_ore": 2}},
	"necro_m": {"hp": 36, "dmg": 12, "speed": 35, "aggro": 120, "loot": {"crystal": 1, "bone": 2}},
	"hexer_f": {"hp": 32, "dmg": 11, "speed": 38, "aggro": 115, "loot": {"herb": 2, "crystal": 1}},
	"zealot_m": {"hp": 35, "dmg": 10, "speed": 38, "aggro": 100, "loot": {"cloth": 1, "coal": 1}},
	"frost_yeti": {"hp": 60, "dmg": 15, "speed": 34, "aggro": 105, "loot": {"meat": 3, "crystal": 1}},
	"emerald_slime": {"hp": 24, "dmg": 7, "speed": 34, "aggro": 85, "loot": {"resin": 2, "herb": 1}},
	"cave_goblin": {"hp": 28, "dmg": 9, "speed": 46, "aggro": 100, "loot": {"iron_ore": 2, "coal": 1}},
	"magma_golem": {"hp": 72, "dmg": 16, "speed": 28, "aggro": 95, "loot": {"iron_bar": 2, "coal": 3, "gem": 1}},
	"bramble_treant": {"hp": 55, "dmg": 13, "speed": 28, "aggro": 90, "loot": {"wood": 4, "resin": 2}},
	"berserker_f": {"hp": 44, "dmg": 13, "speed": 44, "aggro": 100, "loot": {"meat": 1, "iron_ore": 2}},
	"zealot_f": {"hp": 32, "dmg": 10, "speed": 40, "aggro": 105, "loot": {"cloth": 1, "coal": 1}},
	"acolyte_m": {"hp": 26, "dmg": 9, "speed": 40, "aggro": 105, "loot": {"cloth": 1, "herb": 1}},
	"acolyte_f": {"hp": 24, "dmg": 9, "speed": 42, "aggro": 105, "loot": {"cloth": 1, "herb": 1}},
	"inquisitor_m": {"hp": 40, "dmg": 12, "speed": 36, "aggro": 110, "loot": {"iron_bar": 1, "cloth": 1}},
	"inquisitor_f": {"hp": 38, "dmg": 12, "speed": 38, "aggro": 110, "loot": {"iron_bar": 1, "cloth": 1}},
	"reaper_f": {"hp": 42, "dmg": 13, "speed": 46, "aggro": 115, "loot": {"bone": 2, "cloth": 1}},
	"necro_f": {"hp": 34, "dmg": 12, "speed": 36, "aggro": 120, "loot": {"crystal": 1, "bone": 2}},
	"hexer_m": {"hp": 34, "dmg": 11, "speed": 36, "aggro": 115, "loot": {"herb": 2, "crystal": 1}},
	"wiccan_f": {"hp": 28, "dmg": 10, "speed": 38, "aggro": 110, "loot": {"herb": 2, "mushroom": 1}},
	"wiccan_m": {"hp": 30, "dmg": 10, "speed": 36, "aggro": 110, "loot": {"herb": 2, "mushroom": 1}},
	"mirelle": {"hp": 46, "dmg": 13, "speed": 40, "aggro": 110, "loot": {"crystal": 2}},
	"nyx": {"hp": 40, "dmg": 13, "speed": 48, "aggro": 115, "loot": {"gem": 1, "cloth": 1}},
	# the Deep Company: scavengers and tinkerers who live in the old tunnels
	"rust_juno": {"hp": 36, "dmg": 11, "speed": 40, "aggro": 105, "loot": {"iron_ore": 2, "nails": 3}},
	"scrap_yadi": {"hp": 30, "dmg": 10, "speed": 46, "aggro": 105, "loot": {"iron_ore": 1, "nails": 4}},
	"hacker_rem": {"hp": 28, "dmg": 10, "speed": 44, "aggro": 110, "loot": {"glass": 1, "crystal": 1}},
	"neon_pix": {"hp": 30, "dmg": 11, "speed": 46, "aggro": 110, "loot": {"crystal": 2}},
	"technomancer_m": {"hp": 44, "dmg": 14, "speed": 34, "aggro": 120, "loot": {"crystal": 2, "steel_bar": 1}},
	"technomancer_f": {"hp": 42, "dmg": 14, "speed": 36, "aggro": 120, "loot": {"crystal": 2, "steel_bar": 1}},
	"scientist_m": {"hp": 26, "dmg": 9, "speed": 36, "aggro": 100, "loot": {"glass": 2}},
	"scientist_f": {"hp": 26, "dmg": 9, "speed": 38, "aggro": 100, "loot": {"glass": 2}},
	"venn": {"hp": 50, "dmg": 14, "speed": 38, "aggro": 110, "loot": {"iron_bar": 2, "gem": 1}},
	"vale": {"hp": 38, "dmg": 12, "speed": 44, "aggro": 110, "loot": {"crystal": 1, "cloth": 1}},
	"jax": {"hp": 34, "dmg": 12, "speed": 48, "aggro": 110, "loot": {"bone": 1, "iron_ore": 1}},
	"lyric": {"hp": 110, "dmg": 20, "speed": 30, "aggro": 120, "loot": {"steel_bar": 3, "gem": 2}},
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
var _dir := Vector2.DOWN
var _facing := "down"
var _anim := ""
var _hit_player := false
var _atk_count := 0
var _is_heavy := false
var _lean := 0.0          # degrees, acted-out attacks and hits
var _waddle := false      # no walk frames: sway instead
var _walk_t := 0.0
var _slashed := false


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
	_waddle = not (Pack.has_anim(actor, "walk_down") or Pack.has_anim(actor, "run"))
	var back := ColorRect.new()
	back.color = Color(0.1, 0.05, 0.05, 0.8)
	back.size = Vector2(16, 2)
	back.position = Vector2(-8, -Pack.actor_height(actor) - 3)
	back.visible = false
	add_child(back)
	bar = ColorRect.new()
	bar.color = Color(0.85, 0.2, 0.2)
	bar.size = Vector2(16, 2)
	back.add_child(bar)
	_play_dir("idle", Vector2.DOWN)
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
	_t = 0.28
	velocity = dir * 135.0
	_play_dir("hit", -dir)


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
			_play_dir("idle", _dir)
			if dist < aggro:
				state = State.CHASE
			elif _t <= 0.0:
				state = State.WANDER
				_t = randf_range(1.0, 2.2)
				var target := home + Vector2.from_angle(randf() * TAU) * randf_range(8, 40)
				_dir = (target - global_position).normalized()
		State.WANDER:
			velocity = _dir * speed * 0.45
			_play_dir("walk", velocity)
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
				_atk_count += 1
				_is_heavy = (_atk_count % 3 == 0)
				_t = 0.46 if _is_heavy else 0.34
				_dir = to_player.normalized()
				velocity = Vector2.ZERO
				_play_dir("heavy_attack" if _is_heavy else "attack", _dir)
			else:
				velocity = to_player.normalized() * speed
				_play_dir("run", velocity)
		State.WINDUP:
			velocity = -_dir * 10.0
			body.modulate = Color(1.35, 1.1, 0.9) if int(_t * 20.0) % 2 == 0 else Color.WHITE
			if _t <= 0.0:
				body.modulate = Color.WHITE
				state = State.LUNGE
				_t = 0.24 if _is_heavy else 0.18
				_hit_player = false
				_slashed = false
		State.LUNGE:
			velocity = _dir * speed * (4.8 if _is_heavy else 4.2)
			if not _slashed and not Pack.has_anim(actor, "attack_" + _facing):
				_slashed = true
				FX.slash(get_parent(), global_position + Vector2(0, -Pack.actor_height(actor) * 0.45) + _dir * 12.0, _dir,
					Color(1.0, 0.75, 0.55, 0.9) if _is_heavy else Color(1, 1, 1, 0.8))
			var reach := 16.5 if _is_heavy else 13.0
			if not _hit_player and player and dist < reach:
				_hit_player = true
				var dmg := int(round(stats.dmg * (1.4 if _is_heavy else 1.0)))
				player.take_damage(dmg, global_position)
			if _t <= 0.0:
				state = State.RECOVER
				_t = 0.55
		State.RECOVER:
			velocity = velocity.move_toward(Vector2.ZERO, 500.0 * delta)
			if _t <= 0.0:
				state = State.CHASE
		State.HURT:
			velocity = velocity.move_toward(Vector2.ZERO, 700.0 * delta)
			_play_dir("hit", _dir)
			if _t <= 0.0:
				state = State.CHASE
	move_and_slide()
	_act(delta)


## The acted-out part: leaning into attacks and away from hits, and a waddle for creatures that
## have no walk cycle. The body pivots on its feet.
func _act(delta: float) -> void:
	var side := 1.0 if _dir.x >= 0.0 else -1.0
	var want := 0.0
	match state:
		State.WINDUP:
			want = -9.0 * side
		State.LUNGE:
			want = 13.0 * side
		State.HURT:
			want = 12.0 * (1.0 if velocity.x >= 0.0 else -1.0)
	_lean = move_toward(_lean, want, delta * 160.0)
	var sway := 0.0
	var bob := 0.0
	if _waddle and velocity.length() > 4.0 and state in [State.WANDER, State.CHASE]:
		_walk_t += delta * (9.0 if state == State.CHASE else 6.0)
		sway = sin(_walk_t) * 6.0
		bob = -absf(sin(_walk_t)) * 1.5
	else:
		_walk_t = 0.0
	body.rotation_degrees = _lean + sway
	body.position.y = bob


func _die(dir: Vector2) -> void:
	state = State.DEAD
	velocity = Vector2.ZERO
	remove_from_group("hittable")
	bar.get_parent().visible = false
	collision_layer = 0
	var drawn_death := Pack.has_anim(actor, "death_" + _dir_name(-dir if dir.length() > 0.1 else _dir)) or Pack.has_anim(actor, "death")
	if drawn_death:
		_play_dir("death", -dir if dir.length() > 0.1 else _dir)
	else:
		# topple away from the blow, then lie still
		_play_dir("idle", _dir)
		var fall := 90.0 if dir.x >= 0.0 else -90.0
		var tw0 := create_tween()
		tw0.tween_property(body, "rotation_degrees", fall, 0.32).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
		tw0.parallel().tween_property(body, "position", Vector2(dir.x * 3.0, 1.0), 0.32)
		tw0.tween_property(body, "modulate", Color(0.7, 0.7, 0.75), 0.4)
	Game.hitstop(0.07)
	Game.shake(2.5)
	Game.note_kill(actor)
	Game.world.note_removed(self)
	for item in stats.loot:
		Game.world.drop(item, stats.loot[item], global_position + dir * 4.0)
	await get_tree().create_timer(4.0 if drawn_death else 1.6).timeout
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 0.0, 0.8)
	await tw.finished
	# gone until tomorrow (the area remembers)
	queue_free()


func _respawn() -> void:
	position = home
	hp = stats.hp
	state = State.IDLE
	modulate.a = 1.0
	visible = true
	collision_layer = 4
	add_to_group("hittable")
	_anim = ""
	_play_dir("idle", Vector2.DOWN)


func _dir_name(v: Vector2) -> String:
	if v.length_squared() < 0.01:
		return _facing
	if absf(v.x) >= absf(v.y):
		_facing = "right" if v.x >= 0.0 else "left"
	else:
		_facing = "down" if v.y >= 0.0 else "up"
	return _facing


## Play the best animation this actor has for what it's doing, facing `v`.
func _play_dir(base_anim: String, v: Vector2) -> void:
	var d := _dir_name(v)
	var tries: Array = []
	match base_anim:
		"walk":
			tries = ["walk_" + d, "run_" + d, "run", "idle_" + d, "idle"]
		"run":
			tries = ["run_" + d, "walk_" + d, "run", "idle_" + d, "idle"]
		"attack", "heavy_attack", "hit":
			tries = [base_anim + "_" + d, "idle_" + d, "idle"]
		"death":
			tries = ["death_" + d, "death", "idle_" + d, "idle"]
		_:
			tries = [base_anim + "_" + d, base_anim, "idle_" + d, "idle"]
	for anim in tries:
		if body.sprite_frames.has_animation(anim):
			# single-direction animations (the pack's) face left by mirroring
			var flip := false
			if not anim.ends_with("_" + d):
				flip = d == "left" or (d in ["up", "down"] and body.flip_h)
			if flip != body.flip_h:
				body.flip_h = flip
				_anim = ""
			_play(anim)
			return


func _play(anim: String) -> void:
	if anim == _anim:
		return
	_anim = anim
	body.play(anim)
	body.offset = Pack.actor_offset(actor, anim, body.flip_h)
