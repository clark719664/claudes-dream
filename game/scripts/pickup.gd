class_name Pickup
extends Node2D
## A dropped item: pops out, bobs, then flies to the player when they come close.

const MAGNET := 36.0
const COLLECT := 7.0

var item: String
var icon: Sprite2D
var _age := 0.0
var _vel := Vector2.ZERO
var _z := 0.0
var _vz := 0.0


func _init(item_name := "wood") -> void:
	item = item_name


func _ready() -> void:
	var sh := Pack.sprite("shadow_actor")
	sh.scale = Vector2(0.45, 0.6)
	sh.z_index = -1
	add_child(sh)
	icon = Sprite2D.new()
	icon.texture = Pack.icon(item)
	icon.modulate = Inventory.tint(item)
	var s := icon.texture.get_size()
	var k := minf(1.0, 12.0 / maxf(s.x, s.y))
	icon.scale = Vector2(k, k)
	icon.offset = Vector2(0, -s.y * 0.5)
	add_child(icon)


func burst(v: Vector2) -> void:
	_vel = v * 3.0
	_vz = randf_range(55, 80)


func _process(delta: float) -> void:
	_age += delta
	# little hop on the way out
	_vz -= 260.0 * delta
	_z = maxf(_z + _vz * delta, 0.0)
	position += _vel * delta
	_vel = _vel.move_toward(Vector2.ZERO, 120.0 * delta)
	var bob := sin(_age * 4.0) * 1.0 if _z <= 0.0 else 0.0
	icon.position.y = -_z + bob - 2.0
	var p := Game.player as Player
	if p == null or p.dead or _age < 0.45:
		return
	var to := p.global_position + Vector2(0, -6) - global_position
	var d := to.length()
	if d < COLLECT:
		Inventory.add(item)
		Game.note_gather(item)
		Game.world.pickup_text(item, p.global_position + Vector2(0, -6))
		queue_free()
	elif d < MAGNET:
		position += to.normalized() * (60.0 + (MAGNET - d) * 5.0) * delta
