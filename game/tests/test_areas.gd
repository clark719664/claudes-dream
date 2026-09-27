extends "res://scripts/world.gd"

func _ready() -> void:
	super._ready()
	call_deferred("review_areas")

func review_areas() -> void:
	Game.hud.dialog.hide()
	get_tree().paused = false
	var areas_to_check := ["house", "barn", "coop", "general_store", "saloon", "blacksmith_shop", "library", "clinic", "school", "church", "bathhouse", "museum", "inn", "mayors_manor", "npc_house_1", "npc_house_2", "dispensary", "farm", "town", "oldwood", "pinewood", "riverlands", "stonegate", "mountain", "summit", "badlands", "mine1"]
	for id in areas_to_check:
		print("AREA BEGIN: ", id)
		load_area(id, "")
		stream_now()
		await get_tree().process_frame
		await get_tree().process_frame
		print("AREA OK: ", id)
	print("AREA TESTS: ", areas_to_check.size(), " loaded")
	get_tree().quit()
