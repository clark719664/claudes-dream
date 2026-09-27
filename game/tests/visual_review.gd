extends Node
var output := "C:/Users/lil_c/pixellab-recovery/visual-review"
func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	DirAccess.make_dir_recursive_absolute(output)
	call_deferred("run")
func shot(name_: String) -> void:
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(output + "/" + name_ + ".png")
	print("VISUAL: ", name_)
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
	Game.hud.toggle_inventory()
	await shot("inventory")
	Game.hud.close_menu()
	world.load_area("town", "")
	await shot("town")
	Game.hud.open_shop("general", "Tilda")
	await shot("shop")
	Game.hud.close_menu()
	get_tree().quit()
