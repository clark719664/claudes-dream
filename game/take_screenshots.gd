extends SceneTree

func _init() -> void:
	# Wait for the engine to initialize
	await create_timer(0.5).timeout
	
	# Load the main scene
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await create_timer(1.0).timeout
	
	var Game = root.get_node("/root/Game")
	var player = Game.player
	
	# Teleport player to town near the Rancher shop
	Game.world.change_area("town", Vector2(105 * 16, 21 * 16))
	await create_timer(2.0).timeout
	
	# Take town screenshot
	var img = root.get_viewport().get_texture().get_image()
	img.save_png("res://town_screenshot.png")
	print("Saved town_screenshot.png")
	
	# Change mine floor to deep to see the elite mobs
	Game.mine_floor = 30
	# Teleport player to mine
	Game.world.change_area("mine", Vector2(100, 100))
	await create_timer(3.0).timeout
	
	# Take mine screenshot
	var img2 = root.get_viewport().get_texture().get_image()
	img2.save_png("res://mine_screenshot.png")
	print("Saved mine_screenshot.png")
	
	quit()
