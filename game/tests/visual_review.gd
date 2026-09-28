extends Node
## Screenshots of every screen worth eyeballing, at the game's native 480x270.
## Run with a real renderer: Godot --path game res://tests/visual_review.tscn -- --out=<dir>
## --rooms captures only the interiors; --only=id,id captures just those rooms.
var output := "user://visual-review"
var only: PackedStringArray = []
var rooms_only := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			output = a.trim_prefix("--out=")
		elif a.begins_with("--only="):
			only = a.trim_prefix("--only=").split(",")
		elif a == "--rooms":
			rooms_only = true
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


## The whole room at native resolution: a second viewport sized to the room looks at the same world.
func room_shot(world: Node, name_: String) -> void:
	world.player.position = world.interior.door_inside() + Vector2(0, -8)
	for i in 3:
		await get_tree().process_frame
	var r: Rect2 = world.interior.room_rect()
	var sv := SubViewport.new()
	sv.size = Vector2i(r.size)
	sv.world_2d = get_viewport().world_2d
	sv.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	sv.snap_2d_transforms_to_pixel = true
	sv.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	var cam := Camera2D.new()
	cam.position = r.get_center()
	sv.add_child(cam)
	add_child(sv)
	cam.make_current()
	for i in 3:
		await RenderingServer.frame_post_draw
	sv.get_texture().get_image().save_png(output + "/room_" + name_ + ".png")
	print("VISUAL: room_", name_)
	sv.queue_free()


func rooms(world: Node = null) -> void:
	if world == null:
		Preferences.new_game_requested = true
		world = load("res://scenes/main.tscn").instantiate()
		add_child(world)
		Game.hud.dialog.hide()
	Game.time_of_day = 0.5
	for id in Interior.IDS:
		if not only.is_empty() and not id in only:
			continue
		if id.begins_with("house_"):
			Game.cabin_tier = int(id.substr(6))
			world.load_area("house", "door")
		else:
			world.load_area(id, "door")
		await room_shot(world, id)


func run() -> void:
	if rooms_only or not only.is_empty():
		await rooms()
		get_tree().quit()
		return
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
	await rooms(world)
	get_tree().quit()
