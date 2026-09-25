class_name Ladder
extends Node2D
## A ladder: down through a hole in the floor, or up a shaft into daylight. Use it (E) to go to
## area `to`, arriving at its spawn `at`.

var down := true
var to := ""
var at := ""


func _init(down_: bool, to_: String, at_: String) -> void:
	down = down_
	to = to_
	at = at_


func _ready() -> void:
	add_to_group("interactable")
	z_index = -3 if down else 0
	if not down:
		# daylight falling down the shaft
		var beam := Polygon2D.new()
		beam.polygon = PackedVector2Array([Vector2(-10, -60), Vector2(10, -60), Vector2(16, 2), Vector2(-16, 2)])
		beam.color = Color(1.0, 0.95, 0.7, 0.12)
		beam.z_index = 20
		add_child(beam)
		add_child(World.make_light(Color(1.0, 0.92, 0.7), 0.9, Vector2(0, -8), 72))
	queue_redraw()


func _draw() -> void:
	var wood := Color(0.45, 0.28, 0.14)
	var dark := Color(0.2, 0.12, 0.06)
	if down:
		# a hole in the floor with the ladder's top rungs showing
		draw_circle(Vector2(0, -2), 8.0, Color(0.05, 0.03, 0.02))
		draw_arc(Vector2(0, -2), 8.0, 0, TAU, 20, Color(0.3, 0.22, 0.15), 1.5)
		for x in [-4.0, 4.0]:
			draw_line(Vector2(x, -10), Vector2(x, 2), wood, 2.0)
		for y in [-7.0, -3.0, 1.0]:
			draw_line(Vector2(-4, y), Vector2(4, y), wood, 1.5)
	else:
		# a ladder standing against the rock, going up into the shaft
		for x in [-5.0, 5.0]:
			draw_line(Vector2(x, -40), Vector2(x, 0), dark, 3.0)
			draw_line(Vector2(x, -40), Vector2(x, 0), wood, 2.0)
		for i in 7:
			var y := -36.0 + i * 6.0
			draw_line(Vector2(-5, y), Vector2(5, y), wood, 1.5)


func interact(_p: Node) -> void:
	if to != "":
		Game.world.go_to(to, at)
