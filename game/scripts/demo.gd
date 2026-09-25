extends Node
## Scripted tour used for automated checks and trailers:
##   godot --path game -- --demo --shots=/tmp/shots
## Walks through chopping, crafting, fighting and night time, saving screenshots on the way.

var shots_dir := ""
var _n := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots_dir = a.substr(8)
	if shots_dir != "":
		DirAccess.make_dir_recursive_absolute(shots_dir)
	_run()


func _run() -> void:
	var p: Player = Game.player
	await _wait(1.2)
	await _shot("yard")
	# chop the nearest tree
	var tree := _nearest(func(n): return n is Harvestable and n.kind == "wood" and n.sprite_name in ["oak", "pine"], p.global_position)
	if tree:
		p.global_position = tree.global_position + Vector2(-16, 2)
		p.facing = Vector2.RIGHT
		await _wait(0.8)
		for i in 5:
			await _swing(p)
			if i == 1:
				await _shot("chop")
		await _wait(0.6)
		p.global_position = tree.global_position + Vector2(-8, 6)
		await _wait(1.2)
		await _shot("collected")
	# craft at the workbench
	Inventory.add("wood", 12)
	Inventory.add("stone", 8)
	Inventory.add("fiber", 4)
	var bench := _nearest(func(n): return n is Station and n.station == "workbench", p.global_position)
	if bench:
		p.global_position = bench.global_position + Vector2(0, 18)
		p.facing = Vector2.UP
		await _wait(0.6)
		bench.interact(p)
		await _wait(0.3)
		_press("move_down")
		await _wait(0.2)
		await _shot("crafting")
		_press("interact")
		await _wait(0.2)
		_press("move_down")
		_press("interact")
		await _wait(0.3)
		await _shot("crafted")
		Game.hud.close_crafting()
	# fight at the orc camp
	var orc := _nearest(func(n): return n is Enemy and n.actor.begins_with("orc"), p.global_position)
	if orc:
		Inventory.add("sword_wood")
		p.global_position = orc.home + Vector2(-60, 10)
		await _wait(1.6)
		for i in 8:
			var e := _nearest(func(n): return n is Enemy and n.state != Enemy.State.DEAD, p.global_position)
			if e:
				p.facing = (e.global_position - p.global_position).normalized()
			await _swing(p)
			if i == 2:
				await _shot("combat")
		await _wait(0.8)
		await _shot("combat_after")
	# graveyard and lake views
	p.hp = p.max_hp
	p.global_position = Vector2(40 * 16, 9 * 16)
	await _wait(1.5)
	await _shot("graveyard")
	p.global_position = Vector2(24 * 16, 22 * 16)
	await _wait(1.5)
	await _shot("lake")
	# night at the camp
	Game.time_of_day = 0.9
	p.global_position = Vector2(38 * 16, 28 * 16)
	await _wait(1.5)
	await _shot("night")
	Game.time_of_day = 0.78
	await _wait(0.3)
	await _shot("dusk")
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
