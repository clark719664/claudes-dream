class_name FarmAnimal
extends CharacterBody2D
## Peaceful farm animals that wander, can be housed, bred, and yield products.

const STATS := {
	"cow": {"hp": 50, "speed": 15, "loot": {"meat": 3, "leather": 2}, "product": "milk", "baby": "baby_cow"},
	"sheep": {"hp": 40, "speed": 18, "loot": {"meat": 2}, "product": "wool", "baby": "baby_sheep"},
	"pig": {"hp": 45, "speed": 20, "loot": {"meat": 4}, "product": "", "baby": "baby_pig"},
	"chicken": {"hp": 15, "speed": 25, "loot": {"meat": 1}, "product": "egg", "baby": "baby_chicken"},
	"horse": {"hp": 60, "speed": 35, "loot": {"meat": 2, "leather": 2}, "product": "", "baby": "baby_horse"},
	"dog": {"hp": 30, "speed": 40, "loot": {}, "product": "", "baby": "puppy"},
	"tabby_cat": {"hp": 20, "speed": 30, "loot": {}, "product": "", "baby": "kitten"},
	"duck": {"hp": 12, "speed": 22, "loot": {"meat": 1}, "product": "egg", "baby": "baby_duck"},
	"goat": {"hp": 35, "speed": 22, "loot": {"meat": 2}, "product": "milk", "baby": "baby_goat"},
	"alpaca": {"hp": 45, "speed": 16, "loot": {"meat": 2}, "product": "wool", "baby": "baby_alpaca"},
	"llama": {"hp": 50, "speed": 18, "loot": {"meat": 2, "leather": 1}, "product": "wool", "baby": "baby_llama"},
	"donkey": {"hp": 55, "speed": 20, "loot": {"meat": 2, "leather": 2}, "product": "", "baby": "baby_donkey"},
	"turkey": {"hp": 18, "speed": 20, "loot": {"meat": 2}, "product": "egg", "baby": "baby_turkey"},
	"baby_cow": {"hp": 20, "speed": 18, "loot": {"meat": 1}, "product": "", "adult": "cow"},
	"baby_sheep": {"hp": 15, "speed": 22, "loot": {"meat": 1}, "product": "", "adult": "sheep"},
	"baby_pig": {"hp": 18, "speed": 24, "loot": {"meat": 1}, "product": "", "adult": "pig"},
	"baby_chicken": {"hp": 5, "speed": 30, "loot": {}, "product": "", "adult": "chicken"},
	"baby_horse": {"hp": 25, "speed": 40, "loot": {"meat": 1}, "product": "", "adult": "horse"},
	"puppy": {"hp": 15, "speed": 45, "loot": {}, "product": "", "adult": "dog"},
	"kitten": {"hp": 10, "speed": 35, "loot": {}, "product": "", "adult": "tabby_cat"},
	"baby_duck": {"hp": 5, "speed": 28, "loot": {}, "product": "", "adult": "duck"},
	"baby_goat": {"hp": 15, "speed": 26, "loot": {}, "product": "", "adult": "goat"},
	"baby_alpaca": {"hp": 18, "speed": 20, "loot": {}, "product": "", "adult": "alpaca"},
	"baby_llama": {"hp": 20, "speed": 22, "loot": {}, "product": "", "adult": "llama"},
	"baby_donkey": {"hp": 22, "speed": 24, "loot": {}, "product": "", "adult": "donkey"},
	"baby_turkey": {"hp": 5, "speed": 25, "loot": {}, "product": "", "adult": "turkey"},
}

enum State { IDLE, WANDER, HURT, DEAD, EATING }

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

var _fed := false
var _product_timer := 0.0
var _growth_timer := 0.0

func _init(actor_name := "chicken") -> void:
	actor = actor_name
	stats = STATS.get(actor, STATS.chicken)

func _ready() -> void:
	home = position
	hp = stats.hp
	add_to_group("hittable")
	add_to_group("farm_animals")
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
	if stats.has("adult"):
		body.scale = Vector2(0.65, 0.65)
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
	_play_dir("idle", Vector2.DOWN)
	_t = randf_range(0.5, 2.5)
	
	_product_timer = randf_range(60.0, 120.0)
	_growth_timer = 300.0 # 5 minutes to grow up

func hit_centre() -> Vector2:
	return global_position + Vector2(0, -9)

func hit_radius() -> float:
	return 8.0 if state != State.DEAD else -999.0

func hit(damage: int, dir: Vector2, _by: Node) -> void:
	if state == State.DEAD:
		return
	hp -= damage
	FX.flash(body)
	FX.chips(get_parent(), hit_centre(), Color(0.9, 0.2, 0.2), 5)
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
	
	var speed: float = stats.speed
	_t -= delta
	_product_timer -= delta
	_growth_timer -= delta
	
	if _product_timer <= 0.0:
		_produce()
		_product_timer = randf_range(60.0, 120.0)
		
	if _growth_timer <= 0.0 and stats.has("adult"):
		_grow_up()
		
	match state:
		State.IDLE:
			velocity = Vector2.ZERO
			_play_dir("idle", _dir)
			if _t <= 0.0:
				if randf() < 0.2 and not _fed:
					state = State.EATING
					_t = randf_range(2.0, 4.0)
				else:
					state = State.WANDER
					_t = randf_range(1.0, 3.0)
					var target := home + Vector2.from_angle(randf() * TAU) * randf_range(8, 40)
					_dir = (target - global_position).normalized()
		State.WANDER:
			velocity = _dir * speed * 0.45
			_play_dir("walk", velocity)
			if _t <= 0.0:
				state = State.IDLE
				_t = randf_range(1.0, 3.0)
		State.EATING:
			velocity = Vector2.ZERO
			_play_dir("idle", _dir)
			if _t <= 0.0:
				_fed = true
				state = State.IDLE
				_t = randf_range(1.0, 3.0)
				_breed_check()
		State.HURT:
			velocity = velocity.move_toward(Vector2.ZERO, 700.0 * delta)
			_play_dir("hit", _dir)
			if _t <= 0.0:
				state = State.WANDER
				_dir = (home - global_position).normalized()
				_t = 1.5
	move_and_slide()

func _produce() -> void:
	var prod: String = stats.get("product", "")
	if prod != "" and _fed:
		Game.world.drop(prod, 1, global_position)
		_fed = false

func _breed_check() -> void:
	if not _fed or not stats.has("baby"): return
	# Find another fed adult of the same type nearby
	for a in get_tree().get_nodes_in_group("farm_animals"):
		if a != self and a.actor == self.actor and a._fed and a.global_position.distance_to(global_position) < 40.0:
			# Breed!
			self._fed = false
			a._fed = false
			Game.world.float_text("<3", global_position + Vector2(0, -16), Color.PINK)
			var baby = load("res://scripts/farm_animal.gd").new(stats.baby)
			baby.global_position = global_position + Vector2(0, 10)
			get_parent().add_child(baby)
			break

func _grow_up() -> void:
	var adult_name: String = stats.get("adult", "")
	if adult_name == "": return
	
	var adult = load("res://scripts/farm_animal.gd").new(adult_name)
	adult.global_position = global_position
	get_parent().add_child(adult)
	queue_free()

func _die(dir: Vector2) -> void:
	state = State.DEAD
	velocity = Vector2.ZERO
	remove_from_group("hittable")
	bar.get_parent().visible = false
	collision_layer = 0
	_play_dir("death", -dir if dir.length() > 0.1 else _dir)
	Game.hitstop(0.07)
	Game.world.note_removed(self)
	for item in stats.loot:
		Game.world.drop(item, stats.loot[item], global_position + dir * 4.0)
	await get_tree().create_timer(4.0).timeout
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 0.0, 0.8)
	await tw.finished
	queue_free()

func _dir_name(v: Vector2) -> String:
	if v.length_squared() < 0.01:
		return _facing
	if absf(v.x) >= absf(v.y):
		_facing = "right" if v.x >= 0.0 else "left"
	else:
		_facing = "down" if v.y >= 0.0 else "up"
	return _facing

func _play_dir(base_anim: String, v: Vector2) -> void:
	var d := _dir_name(v)
	var directional := "%s_%s" % [base_anim, d]
	if body.sprite_frames.has_animation(directional):
		body.flip_h = false
		_play(directional)
		return
	if absf(v.x) > 0.1:
		body.flip_h = v.x < 0.0
	var fallback := base_anim
	if not body.sprite_frames.has_animation(fallback):
		if base_anim in ["walk", "attack", "heavy_attack"]:
			fallback = "run" if body.sprite_frames.has_animation("run") else "idle"
		else:
			fallback = "idle"
	_play(fallback)

func _play(anim: String) -> void:
	if anim == _anim:
		return
	_anim = anim
	body.play(anim)
	body.offset = Pack.actor_offset(actor, anim, body.flip_h)
