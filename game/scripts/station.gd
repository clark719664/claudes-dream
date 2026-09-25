class_name Station
extends StaticBody2D
## A crafting station. Walk up and press E to see what it can make.

var station: String
var sprite_name: String
var variant := 0


func _init(name_: String, v := 0) -> void:
	sprite_name = name_
	variant = v
	station = Pack.spec(name_, v).station


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	var s := Pack.spec(sprite_name, variant)
	var shape := CollisionShape2D.new()
	var r := RectangleShape2D.new()
	r.size = Vector2(float(s.solid) * 2.0, 10)
	shape.shape = r
	shape.position = Vector2(0, -5)
	add_child(shape)
	World.add_shadow(self, s)
	add_child(Pack.sprite(sprite_name, variant))
	add_to_group("interactable")
	if station == "furnace":
		add_child(World.make_light(Color(1.0, 0.5, 0.2), 0.9, Vector2(0, -14), 72))


func interact(_player: Node) -> void:
	Game.hud.open_crafting(station)
