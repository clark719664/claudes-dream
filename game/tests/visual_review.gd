extends Node
## Screenshots of every screen worth eyeballing, at the game's native 480x270.
## Run with a real renderer: Godot --path game res://tests/visual_review.tscn -- --out=<dir>
var output := "user://visual-review"


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			output = a.trim_prefix("--out=")
	DirAccess.make_dir_recursive_absolute(output)
	call_deferred("run")


func shot(name_: String) -> void:
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(output + "/" + name_ + ".png")
	print("VISUAL: ", name_)


func look_at_spot(world: Node, at: Vector2, lift := 70.0) -> void:
	world.player.position = at
	world.player.camera.offset = Vector2(0, -lift)
	world.stream_now()
	for i in 4:
		await get_tree().process_frame
	world.player.camera.reset_smoothing()


func run() -> void:
	var title = load("res://scenes/start.tscn").instantiate()
	add_child(title)
	await shot("title")
	Preferences.open_settings()
	await shot("settings")
	Preferences.open_settings("controls")
	await shot("controls")
	Preferences.close_settings()
	title.queue_free()
	await get_tree().process_frame
	Preferences.new_game_requested = true
	var world = load("res://scenes/main.tscn").instantiate()
	add_child(world)
	Game.hud.dialog.hide()
	await shot("cabin")
	world.load_area("farm", "door")
	await shot("farm")
	var farm_spot: Vector2 = world.player.position
	var kinds := ["barn", "coop", "silo", "windmill", "greenhouse", "well"]
	for i in kinds.size():
		var o := {"t": "custom_building", "kind": kinds[i], "x": farm_spot.x + 140 + (i % 3) * 150, "y": farm_spot.y + 60 + (i / 3) * 170}
		world.spawn(o)
	await look_at_spot(world, farm_spot + Vector2(290, 90), 40.0)
	await shot("farm_buildings_1")
	await look_at_spot(world, farm_spot + Vector2(290, 260), 40.0)
	await shot("farm_buildings_2")
	world.player.camera.offset = Vector2(0, -12)
	world.load_area("farm", "door")
	Game.hud.toggle_inventory()
	await shot("inventory")
	Game.hud.close_menu()
	world.load_area("town", "")
	await shot("town")
	for x in [420, 900, 1380, 1720]:
		await look_at_spot(world, Vector2(x, 690))
		await shot("town_main_%d" % x)
	for x in [340, 820, 1180, 1520]:
		await look_at_spot(world, Vector2(x, 1042))
		await shot("town_south_%d" % x)
	await look_at_spot(world, Vector2(1440, 242))
	await shot("town_bathhouse")
	world.player.camera.offset = Vector2(0, -12)
	Game.hud.open_shop("general", "Tilda")
	await shot("shop")
	Game.hud.close_menu()
	for id in ["general_store", "saloon", "blacksmith_shop", "library", "clinic", "school", "church", "bathhouse", "museum", "inn", "mayors_manor", "npc_house_1", "npc_house_2", "dispensary"]:
		world.load_area(id, "door")
		for i in 3:
			await get_tree().process_frame
		world.player.camera.reset_smoothing()
		await shot("room_" + id)
	get_tree().quit()
