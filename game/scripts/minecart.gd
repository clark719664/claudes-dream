class_name Minecart
extends StaticBody2D
## A minecart stop. Every town has one on the old mine railway; use a stop once to add it to
## your map, then ride from any stop to any other you've found.

var id := ""
var label := ""


func _init(id_: String, label_: String) -> void:
	id = id_
	label = label_


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	add_to_group("interactable")
	add_to_group("minecarts")
	add_child(World.foot_shape(9))
	# a short run of track with the cart on it, and a lamp on a pole beside it
	for i in range(-2, 2):
		var rail := Pack.sprite("rail_h")
		rail.position = Vector2(i * 16 + 8, 4)
		rail.z_index = -3
		add_child(rail)
	World.add_shadow(self, Pack.spec("minecart"))
	add_child(Pack.sprite("minecart"))
	var lamp := Pack.sprite("lamp_post")
	lamp.position = Vector2(30, 4)
	add_child(lamp)
	add_child(World.make_light(Color(1.0, 0.78, 0.45), 0.9, Vector2(40, -18), 72))


func interact(_player: Node) -> void:
	if not Game.stations_found.has(id):
		Game.stations_found[id] = label
		Game.say("Found the %s minecart stop. Ride from any stop you've found." % label)
	Game.hud.open_travel(id)
