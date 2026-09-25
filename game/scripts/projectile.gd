class_name Projectile
extends Node2D
## An arrow from the hunter's bow or a spore bolt from the spore staff: flies straight, hits the
## first thing in its way that can be hit, or falls after a while.

const SPEED := {"arrow": 230.0, "spore": 150.0}
const LIFE := 0.9

var kind := "arrow"
var dir := Vector2.RIGHT
var damage := 10
var _t := 0.0


func _init(kind_: String, dir_: Vector2, dmg: int) -> void:
	kind = kind_
	dir = dir_ if dir_.length() > 0.1 else Vector2.RIGHT
	damage = dmg


func _ready() -> void:
	z_index = 5
	rotation = dir.angle()
	if kind == "spore":
		add_child(World.make_light(Color(0.7, 1.0, 0.5), 0.6, Vector2.ZERO, 40))
	queue_redraw()


func _draw() -> void:
	if kind == "arrow":
		draw_line(Vector2(-7, 0), Vector2(4, 0), Color(0.45, 0.3, 0.16), 1.5)
		draw_line(Vector2(4, 0), Vector2(7, 0), Color(0.8, 0.82, 0.86), 2.0)
		draw_line(Vector2(-7, -2), Vector2(-5, 0), Color(0.9, 0.9, 0.85), 1.0)
		draw_line(Vector2(-7, 2), Vector2(-5, 0), Color(0.9, 0.9, 0.85), 1.0)
	else:
		draw_circle(Vector2.ZERO, 3.5, Color(0.55, 0.85, 0.35, 0.8))
		draw_circle(Vector2.ZERO, 1.8, Color(0.95, 1.0, 0.7))


func _physics_process(delta: float) -> void:
	_t += delta
	position += dir * SPEED.get(kind, 200.0) * delta
	if kind == "spore":
		scale = Vector2.ONE * (1.0 + sin(_t * 30.0) * 0.12)
	for n in get_tree().get_nodes_in_group("hittable"):
		if n is Harvestable:
			continue
		if not is_instance_valid(n) or n == Game.player:
			continue
		if n.hit_centre().distance_to(global_position) <= n.hit_radius() + 3.0:
			n.hit(damage, dir, Game.player)
			FX.chips(get_parent(), global_position, Color(0.9, 0.9, 0.8) if kind == "arrow" else Color(0.6, 0.9, 0.4), 5)
			queue_free()
			return
	# stop against rock, walls and trees
	var q := PhysicsPointQueryParameters2D.new()
	q.position = global_position + Vector2(0, 8)
	q.collision_mask = 1
	if _t > 0.05 and not get_world_2d().direct_space_state.intersect_point(q, 1).is_empty():
		queue_free()
		return
	if _t > LIFE:
		queue_free()
