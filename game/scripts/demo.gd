extends Node
## Scripted tour used for automated checks and trailers:
##   godot --path game -- --demo --new --shots=/tmp/shots
##   godot --path game -- --demo --new --area=farm --mapshot=/tmp/farm.png [--region=x,y,w,h] [--mapscale=2] [--day=N]
## The tour wakes up at home, clears and plants a bit of the farm, ships, shops in Brindle, sets
## up a workbench and walks through every area, saving screenshots on the way.

var shots_dir := ""
var mapshot := ""
var area := "farm"
var region := Rect2i()      # tiles; empty = the whole area, scaled down
var map_scale := 2
var _n := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots_dir = a.substr(8)
		elif a.begins_with("--mapshot="):
			mapshot = a.substr(10)
		elif a.begins_with("--area="):
			area = a.substr(7)
		elif a.begins_with("--region="):
			var r := a.substr(9).split(",")
			region = Rect2i(int(r[0]), int(r[1]), int(r[2]), int(r[3]))
		elif a.begins_with("--mapscale="):
			map_scale = int(a.substr(11))
		elif a.begins_with("--day="):
			Game.day = int(a.substr(6))
		elif a.begins_with("--weather="):
			Game.weather = a.substr(10)
	if shots_dir != "":
		DirAccess.make_dir_recursive_absolute(shots_dir)
	Game.hud.dialog.visible = false
	if mapshot != "":
		_map()
	else:
		_run()


## Render an area by stepping a camera across it, then quit. With --region=x,y,w,h (tiles) the
## region comes out at 1:1; otherwise the whole area, shrunk by --mapscale.
func _map() -> void:
	Game.time_of_day = 0.5
	Game.hud.visible = false
	Game.world.load_area(area, "")
	await _wait(0.5)
	var cam := Camera2D.new()
	cam.anchor_mode = Camera2D.ANCHOR_MODE_FIXED_TOP_LEFT
	Game.world.add_child(cam)
	cam.make_current()
	Game.player.visible = false
	var rect := Rect2i(Vector2i.ZERO, Vector2i(Game.world.size))
	var k := map_scale
	if region.has_area():
		rect = Rect2i(region.position * 16, region.size * 16)
		k = 1
	var full := Image.create(rect.size.x / k, rect.size.y / k, false, Image.FORMAT_RGBA8)
	var y := rect.position.y
	while y < rect.end.y:
		var x := rect.position.x
		while x < rect.end.x:
			cam.position = Vector2(x, y)
			Game.world.focus = Vector2(x + 240, y + 135)
			Game.world.stream_around(Game.world.focus, true)
			await RenderingServer.frame_post_draw
			await RenderingServer.frame_post_draw
			var img := get_viewport().get_texture().get_image()
			img.convert(Image.FORMAT_RGBA8)
			var w := mini(480, rect.end.x - x)
			var h := mini(270, rect.end.y - y)
			img = img.get_region(Rect2i(0, 0, w, h))
			if k > 1:
				img.resize(maxi(1, w / k), maxi(1, h / k), Image.INTERPOLATE_BILINEAR)
			full.blit_rect(img, Rect2i(Vector2i.ZERO, img.get_size()), Vector2i((x - rect.position.x) / k, (y - rect.position.y) / k))
			x += 480
		y += 270
	full.save_png(mapshot)
	get_tree().quit()


func _run() -> void:
	var p: Player = Game.player
	await _wait(1.0)
	await _shot("wake_up")
	# out of the door onto the farm
	await _go("farm", "door")
	p.global_position += Vector2(0, 30)
	await _wait(0.8)
	await _shot("farm_door")
	# clear a patch: cut weeds, break stones, then till, plant and water a few rows
	var spot := p.global_position + Vector2(-60, 60)
	for n in Game.world.entities.get_children():
		if n is Harvestable and n.global_position.distance_to(spot) < 40:
			n._gone()
	await _wait(0.3)
	p.global_position = spot
	p.facing = Vector2.RIGHT
	await _wait(0.3)
	_select("hoe")
	for i in 6:
		p.global_position = spot + Vector2(i * 16, 0)
		await _use(p)
	_select("carrot_seeds")
	for i in 6:
		p.global_position = spot + Vector2(i * 16, 0)
		await _use(p)
	_select("watering_can")
	for i in 3:
		p.global_position = spot + Vector2(i * 16, 0)
		await _use(p)
	await _shot("planted")
	# a few days later: ripe carrots, harvest, ship
	for key in Game.area_state("farm").crops:
		Game.area_state("farm").crops[key].age = 9
	await _go("farm", "door")
	p.global_position = spot + Vector2(-16, 0)
	await _wait(0.6)
	await _shot("ripe")
	for c in Game.world.soil.crops.values():
		c.interact(p)
	var crate := _nearest(func(n): return n is ShipCrate, p.global_position)
	p.global_position = crate.global_position + Vector2(0, 18)
	p.facing = Vector2.UP
	await _wait(0.5)
	crate.interact(p)
	await _wait(0.2)
	await _shot("shipping")
	Game.hud._ship_selected(true)
	Game.hud.close_menu()
	# into town: shops
	Game.gold += 3000
	Inventory.add("wood", 60)
	Inventory.add("stone", 40)
	await _go("town", "from_farm")
	await _wait(0.6)
	await _shot("town_gate")
	for who in ["Pell", "Tilda", "Brom"]:
		var k := _nearest(func(n): return n is Npc and n.display_name == who, p.global_position)
		if k == null:
			continue
		p.global_position = k.global_position + Vector2(0, 18)
		Game.world.stream_now()
		await _wait(0.8)
		if who == "Tilda":
			await _shot("carpentry")
		k.interact(p)
		await _wait(0.3)
		await _shot("shop_" + who.to_lower())
		if who == "Tilda":
			_press("interact")
			await _wait(0.2)
		Game.hud.close_menu()
	for spot_name in ["Brindle", "Brindle churchyard"]:
		p.global_position = _poi(spot_name) + Vector2(0, 48)
		Game.world.stream_now()
		await _wait(1.0)
		await _shot(spot_name.to_lower().replace(" ", "_"))
	# back home: set up the workbench
	await _go("farm", "from_town")
	p.global_position = Game.world.cabin.global_position + Vector2(90, 40)
	p.facing = Vector2.RIGHT
	for n in Game.world.entities.get_children():
		if n is Harvestable and n.global_position.distance_to(p.global_position + Vector2(20, 0)) < 40:
			n._gone()
	await _wait(0.3)
	_select("kit_workbench")
	await _use(p)
	await _wait(0.4)
	await _shot("workbench")
	Game.hud.toggle_map()
	await _wait(0.3)
	await _shot("map_farm")
	Game.hud.close_menu()
	# every other area
	for a in [["pinewood", "from_farm"], ["oldwood", "from_farm"], ["riverlands", "from_town"], ["mountain", "from_town"], ["summit", "from_mountain"],
			["badlands", "from_town"], ["stonegate", "from_badlands"]]:
		await _go(a[0], a[1])
		p.hp = p.max_hp
		await _wait(0.8)
		await _shot(a[0])
		for q in Game.world.pois:
			if q.get("kind", "") == "town":
				continue
			p.global_position = Vector2(q.x, q.y) * 16.0 + Vector2(0, 56)
			Game.world.stream_now()
			await _wait(0.9)
			await _shot(String(q.name).to_lower().replace(" ", "_").replace("'", ""))
			break
	# down the Old Mine
	await _go("mountain", "mine")
	await _wait(0.6)
	await _shot("mine_mouth")
	for lv in [1, 4, 9, 15]:
		await _go("mine_%d" % lv, "top")
		await _wait(0.8)
		await _shot("mine_%d" % lv)
		if lv == 4:
			var r := _nearest(func(n): return n is Harvestable and n.has_meta("ladder"), p.global_position)
			if r:
				p.global_position = r.global_position + Vector2(0, 18)
				Game.world.stream_now()
				r._gone()
				await _wait(0.6)
				await _shot("mine_ladder")
	# a fight at the stockade
	await _go("badlands", "from_town")
	Inventory.add("sword_iron")
	var orc := _nearest(func(n): return n is Enemy, _poi("Grimtusk stockade") * 1.0)
	if orc:
		p.global_position = orc.global_position + Vector2(-50, 10)
		Game.world.stream_now()
		_select("sword_iron")
		await _wait(1.4)
		for i in 6:
			var e := _nearest(func(n): return n is Enemy and n.state != Enemy.State.DEAD, p.global_position)
			if e:
				p.facing = (e.global_position - p.global_position).normalized()
			await _use(p)
			if i == 3:
				await _shot("combat")
	# the seasons: fall woods, a rainy day, winter on the farm
	p.hp = p.max_hp
	Game.day = 2 * 28 + 5
	await _go("pinewood", "from_farm")
	p.global_position += Vector2(0, -200)
	Game.world.stream_now()
	await _wait(1.0)
	await _shot("fall_woods")
	Game.weather = "rain"
	await _go("town", "from_farm")
	p.global_position = _poi("Brindle") * 1.0 + Vector2(0, 40)
	Game.world.stream_now()
	await _wait(1.2)
	await _shot("rain_town")
	Game.weather = "snow"
	Game.day = 3 * 28 + 5
	await _go("farm", "door")
	await _wait(1.2)
	await _shot("winter_farm")
	Game.weather = "sun"
	Game.day = 13
	await _go("town", "from_farm")
	p.global_position = _poi("Brindle") * 1.0 + Vector2(0, 60)
	Game.world.stream_now()
	await _wait(1.0)
	await _shot("blossom_fair")
	Game.time_of_day = 0.9
	await _wait(1.2)
	await _shot("night_town")
	if shots_dir != "":
		get_tree().quit()


func _go(id: String, at: String) -> void:
	await Game.world.go_to(id, at)
	await _wait(0.3)


func _select(item: String) -> void:
	var i := Inventory.slots.find(item)
	if i < 0:
		return
	if i >= 10:
		# move it into the toolbar's last slot
		Inventory.slots.remove_at(i)
		var old: String = Inventory.slots[9]
		Inventory.slots[9] = item
		Inventory.slots.append(old)
		i = 9
	Game.player.select(i)


func _use(p: Player) -> void:
	p.use_selected()
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
