class_name CabinFixture
extends Node2D
## Furniture you can use inside the cabin: the bed (sleep and save), the kitchen stove, the alchemy bench.

var role: String


func _init(role_: String) -> void:
	role = role_


func _ready() -> void:
	add_to_group("interactable")


func interact(_player: Node) -> void:
	match role:
		"bed":
			Game.hud.confirm("Go to sleep? The day ends and the game saves.", Game.sleep)
		"kitchen":
			Game.hud.open_crafting("kitchen")
		"alchemy":
			Game.hud.open_crafting("alchemy")
