extends Node
## Scripted tour used for automated checks and trailers:
##   godot --path game -- --demo --shots=/tmp/shots
## Walks through chopping, crafting, fighting and night time, saving screenshots on the way.

var shots_dir := ""
var mapshot := ""
var _n := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots_dir = a.substr(8)
		elif a.begins_with("--mapshot="):
			mapshot = a.substr(10)
	if shots_dir != "":
		DirAccess.make_dir_recursive_absolute(shots_dir)
	if mapshot != "":
		_map()
	else:
		_run()


## Render the whole map at 1:1 by stepping a camera across it, then quit.
func _map() -> void:
	Game.time_of_day = 0.5
	Game.hud.visible = false
	await _wait(0.5)
	var cam := Camera2D.new()
	cam.anchor_mode = Camera2D.ANCHOR_MODE_FIXED_TOP_LEFT
	Game.world.add_child(cam)
	cam.make_current()
	Game.player.visible = false
	var size: Vector2 = Game.world.size
	var full := Image.create(int(size.x), int(size.y), false, Image.FORMAT_RGBA8)
	var y := 0
	while y < int(size.y):
		var x := 0
		while x < int(size.x):
			cam.position = Vector2(x, y)
			await RenderingServer.frame_post_draw
			await RenderingServer.frame_post_draw
			var img := get_viewport().get_texture().get_image()
			img.convert(Image.FORMAT_RGBA8)
			full.blit_rect(img, Rect2i(0, 0, mini(480, int(size.x) - x), mini(270, int(size.y) - y)), Vector2i(x, y))
			x += 480
		y += 270
	full.save_png(mapshot)
	get_tree().quit()


func _run() -> void:
	var p: Player = Game.player
	await _wait(1.2)
	await _shot("homestead")
	# inside the log shack
	Game.world.enter_cabin(true)
	await _wait(0.8)
	await _shot("cabin_1")
	Game.world.exit_cabin()
	await _wait(1.2)
	# chop a tree, then hand-craft
	var tree := _nearest(func(n): return n is Harvestable and n.kind == "wood" and n.sprite_name in ["oak", "pine"], p.global_position)
	if tree:
		p.global_position = tree.global_position + Vector2(-16, 2)
		p.facing = Vector2.RIGHT
		await _wait(0.6)
		for i in 5:
			await _swing(p)
			if i == 1:
				await _shot("chop")
		p.global_position = tree.global_position + Vector2(-6, 6)
		await _wait(1.0)
	Inventory.add("fiber", 6)
	Game.hud.open_crafting("hands")
	_press("move_down")
	await _wait(0.2)
	_press("interact")
	await _wait(0.2)
	await _shot("hand_crafting")
	Game.hud.close_menu()
	# stations
	for k in {"wood": 30, "stone": 20, "iron_ore": 10, "coal": 8, "crystal": 3, "twine": 4}:
		pass
	Inventory.add("wood", 30)
	Inventory.add("stone", 20)
	Inventory.add("iron_ore", 10)
	Inventory.add("coal", 8)
	Inventory.add("twine", 4)
	Inventory.gain_xp(120)
	var bench := _nearest(func(n): return n is Station and n.station == "workbench", p.global_position)
	if bench:
		p.global_position = bench.global_position + Vector2(0, 18)
		await _wait(0.6)
		bench.interact(p)
		await _wait(0.3)
		await _shot("workbench")
		Game.hud.close_menu()
		var anvil := _nearest(func(n): return n is Station and n.station == "anvil", p.global_position)
		anvil.interact(p)
		await _wait(0.3)
		await _shot("anvil")
		Game.hud.close_menu()
	# Tilda rebuilds the cabin, twice
	for tier in [2, 3]:
		var cost: Dictionary = Inventory.CABIN_TIERS[tier].cost
		for k in cost:
			Inventory.add(k, cost[k])
		var tilda := _nearest(func(n): return n is Npc and n.display_name == "Tilda", p.global_position)
		p.global_position = tilda.global_position + Vector2(0, 16)
		await _wait(1.0)
		tilda.interact(p)
		await _wait(0.3)
		if tier == 2:
			await _shot("tilda")
		_press("interact")
		await _wait(0.3)
		Game.hud.close_menu()
		Game.world.enter_cabin(true)
		await _wait(0.4)
		await Game.sleep()
		await _wait(0.6)
		await _shot("cabin_%d" % tier)
		Game.world.exit_cabin()
		await _wait(1.2)
		p.global_position = Game.world.cabin.global_position + Vector2(0, 40)
		await _wait(1.0)
		await _shot("home_%d" % tier)
	# around the world
	for spot in [["village", Vector2(66, 47)], ["frostvale", Vector2(106, 24)], ["quarry", Vector2(104, 70)], ["lake", Vector2(30, 50)], ["graveyard", Vector2(22, 25)]]:
		p.hp = p.max_hp
		p.global_position = spot[1] * 16.0
		await _wait(1.4)
		await _shot(spot[0])
	# fight at the fort with a real sword
	Inventory.add("sword_iron")
	var orc := _nearest(func(n): return n is Enemy and n.actor.begins_with("orc"), Vector2(110, 47) * 16.0)
	if orc:
		p.global_position = orc.home + Vector2(-60, 10)
		await _wait(1.6)
		for i in 8:
			var e := _nearest(func(n): return n is Enemy and n.state != Enemy.State.DEAD, p.global_position)
			if e:
				p.facing = (e.global_position - p.global_position).normalized()
			await _swing(p)
			if i == 3:
				await _shot("combat")
	# nightfall at home
	p.hp = p.max_hp
	Game.time_of_day = 0.9
	p.global_position = Game.world.cabin.global_position + Vector2(0, 60)
	await _wait(1.5)
	await _shot("night")
	Inventory.add("lantern")
	p.global_position = Vector2(30, 20) * 16.0
	await _wait(1.2)
	await _shot("night_lantern")
	if shots_dir != "":
		get_tree().quit()


func _swing(_p: Player) -> void:
	_press("attack")
	await _wait(0.4)


func _press(action: String) -> void:
	var e := InputEventAction.new()
	e.action = action
	e.pressed = true
	Input.parse_input_event(e)
	var r := InputEventAction.new()
	r.action = action
	r.pressed = false
	Input.parse_input_event(r)


func _nearest(pred: Callable, from: Vector2) -> Node2D:
	var best: Node2D = null
	var bd := INF
	for n in Game.world.entities.get_children():
		if pred.call(n):
			var d := from.distance_to(n.global_position)
			if d < bd:
				bd = d
				best = n
	return best


func _wait(t: float) -> void:
	await get_tree().create_timer(t, true, false, true).timeout


func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	if shots_dir == "":
		return
	var img := get_viewport().get_texture().get_image()
	img.resize(img.get_width() * 3, img.get_height() * 3, Image.INTERPOLATE_NEAREST)
	_n += 1
	img.save_png("%s/%02d_%s.png" % [shots_dir, _n, name])
