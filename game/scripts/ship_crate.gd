class_name ShipCrate
extends StaticBody2D
## The shipping crate by your door. Put things in it any time; the carter comes by in the night
## and you're paid in the morning at the crate's prices.

var sprite: Sprite2D


func _ready() -> void:
	add_to_group("interactable")
	collision_layer = 1
	collision_mask = 0
	var s := Pack.spec("ship_crate")
	World.add_shadow(self, s)
	var shape := CollisionShape2D.new()
	var box := RectangleShape2D.new()
	box.size = Vector2(28, 8)
	shape.shape = box
	shape.position = Vector2(0, -4)
	add_child(shape)
	sprite = Pack.sprite("ship_crate")
	add_child(sprite)


func interact(_player: Node) -> void:
	Game.hud.open_shipping()
