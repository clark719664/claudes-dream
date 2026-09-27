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
		"bathhouse_pool":
			var best_actor := ""
			for actor in Game.relationships.keys():
				var rel: Dictionary = Game.relationships[actor]
				if rel.get("status", "") in ["dating", "married"]:
					best_actor = actor
			if best_actor != "" and Game.energy > 0:
				Game.hud.confirm("Get freaky with your partner in the pool? (Drains stamina completely, adds 1 heart)", func():
					Game.energy = 0
					var rel = Game.relationships[best_actor]
					rel["hearts"] = min(10, rel.get("hearts", 0) + 1)
					Game.relationships[best_actor] = rel
					Game.say("It got steamy... you are completely exhausted.")
					Game.hud.area_changed()
				)
			else:
				Game.hud.confirm("Bathe in the restorative waters for 50g? (Regenerates full stamina)", func():
					if Game.gold >= 50:
						Game.gold -= 50
						Game.energy = Game.MAX_ENERGY
						Game.say("You feel completely refreshed.")
						Game.hud.area_changed()
					else:
						Game.say("You need 50g.")
				)
		"alchemy":
			Game.hud.open_crafting("alchemy")
