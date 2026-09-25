extends Node
## Scripted tour used for automated checks and trailers:
##   godot --path game -- --demo --shots=/tmp/shots
## Walks through chopping, crafting, fighting and night time, saving screenshots on the way.

var shots_dir := ""
var mapshot := ""
var region := Rect2i()      # tiles; empty = the whole map, scaled down
var map_scale := 4
var _n := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots_dir = a.substr(8)
		elif a.begins_with("--mapshot="):
			mapshot = a.substr(10)
		elif a.begins_with("--region="):
			var r := a.substr(9).split(",")
			region = Rect2i(int(r[0]), int(r[1]), int(r[2]), int(r[3]))
		elif a.begins_with("--mapscale="):
			map_scale = int(a.substr(11))
	if shots_dir != "":
		DirAccess.make_dir_recursive_absolute(shots_dir)
	if mapshot != "":
		_map()
	else:
		_run()


## Render the map by stepping a camera across it, then quit. With --region=x,y,w,h (tiles) the
## region comes out at 1:1; otherwise the whole map, shrunk by --mapscale (default 4).
func _map() -> void:
	Game.time_of_day = 0.5
	Game.hud.visible = false
	await _wait(0.5)
	var cam := Camera2D.new()
	cam.anchor_mode = Camera2D.ANCHOR_MODE_FIXED_TOP_LEFT
	Game.world.add_child(cam)
	cam.make_current()
	Game.player.visible = false
	var area := Rect2i(Vector2i.ZERO, Vector2i(Game.world.size))
	var k := map_scale
	if region.has_area():
		area = Rect2i(region.position * 16, region.size * 16)
		k = 1
	var full := Image.create(area.size.x / k, area.size.y / k, false, Image.FORMAT_RGBA8)
	var y := area.position.y
	while y < area.end.y:
		var x := area.position.x
		while x < area.end.x:
			cam.position = Vector2(x, y)
			Game.world.focus = Vector2(x + 240, y + 135)
			Game.world.stream_around(Game.world.focus, true)
			await RenderingServer.frame_post_draw
			await RenderingServer.frame_post_draw
			var img := get_viewport().get_texture().get_image()
			img.convert(Image.FORMAT_RGBA8)
			var w := mini(480, area.end.x - x)
			var h := mini(270, area.end.y - y)
			img = img.get_region(Rect2i(0, 0, w, h))
			if k > 1:
				img.resize(maxi(1, w / k), maxi(1, h / k), Image.INTERPOLATE_BILINEAR)
			full.blit_rect(img, Rect2i(Vector2i.ZERO, img.get_size()), Vector2i((x - area.position.x) / k, (y - area.position.y) / k))
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
	var tree := _nearest(func(n): return n is Harvestable and n.kind == "wood" and n.sprite_name in ["oak", "pine", "oak_young"], p.global_position)
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
		Game.world.stream_now()
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
		Game.world.stream_now()
		await _wait(1.0)
		await _shot("home_%d" % tier)
	# around the valley: every town and a few wild places
	for spot in ["Brindle", "Reedwater", "Ironridge", "The quarry", "Frosthold", "The Frost Shrine", "Millbrook", "Stonegate", "The old graveyard", "The stone circle", "The witch's hut", "Harrow farm"]:
		var at := _poi(spot)
		if at == Vector2.ZERO:
			continue
		p.hp = p.max_hp
		p.global_position = at + Vector2(0, 40)
		Game.world.stream_now()
		await _wait(1.2)
		await _shot(spot.to_lower().replace(" ", "_").replace("'", ""))
	# the minecart menu and the world map
	for m in get_tree().get_nodes_in_group("minecarts"):
		Game.stations_found[m.id] = m.label
	var cart := _nearest(func(n): return n is Minecart, _poi("Brindle"))
	if cart:
		p.global_position = cart.global_position + Vector2(0, 22)
		Game.world.stream_now()
		await _wait(0.8)
		cart.interact(p)
		await _wait(0.3)
		await _shot("minecart")
		Game.hud.close_menu()
	Game.hud.toggle_map()
	await _wait(0.3)
	await _shot("map")
	Game.hud.close_menu()
	# fight at Grimtusk's stockade with a real sword
	Inventory.add("sword_iron")
	p.global_position = _poi("Grimtusk stockade") + Vector2(-240, 0)
	Game.world.stream_now()
	await _wait(0.5)
	var orc := _nearest(func(n): return n is Enemy and n.actor.begins_with("orc"), _poi("Grimtusk stockade"))
	if orc:
		p.global_position = orc.global_position + Vector2(-60, 10)
		Game.world.stream_now()
		await _wait(1.6)
		for i in 8:
			var e := _nearest(func(n): return n is Enemy and n.state != Enemy.State.DEAD, p.global_position)
			if e:
				p.facing = (e.global_position - p.global_position).normalized()
			await _swing(p)
			if i == 3:
				await _shot("combat")
	# nightfall at home, then the lantern in the pinewood
	p.hp = p.max_hp
	Game.time_of_day = 0.9
	p.global_position = Game.world.cabin.global_position + Vector2(0, 60)
	Game.world.stream_now()
	await _wait(1.5)
	await _shot("night")
	Inventory.add("lantern")
	p.global_position = _poi("Brindle") + Vector2(0, 40)
	Game.world.stream_now()
	await _wait(1.2)
	await _shot("night_village")
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


func _poi(name: String) -> Vector2:
	for q in Game.world.pois:
		if q.name == name:
			return Vector2(q.x, q.y) * 16.0
	return Vector2.ZERO


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
