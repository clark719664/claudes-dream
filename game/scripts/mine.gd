class_name Mine
extends Node2D
## Procedural underground levels

var _level := 1
var _world: Node2D
var _exit_rect: Rect2
var _deeper_rect: Rect2

func _init(level: int) -> void:
	_level = level

func build(world: Node2D, at: String) -> Vector2:
	_world = world
	var w := 32
	var h := 32
	
	# Floor background
	var back := ColorRect.new()
	back.color = Color(0.1, 0.08, 0.08, 1.0)
	back.size = Vector2(w * 16, h * 16)
	back.position = Vector2(-16 * 16, -16 * 16)
	back.z_index = -10
	add_child(back)

	# Spawn enemies based on depth
	var biomes = ["stone", "crystal", "magma", "nest", "ice", "radioactive", "shadow"]
	var biome = biomes[randi() % biomes.size()]
	
	if _level <= 3:
		biome = "stone" # Standard start

	var enemies = []
	if biome == "stone":
		enemies = ["cave_bat", "rock_slime", "stone_based_slime", "cave_goblin", "cave_snake"]
		back.color = Color(0.12, 0.1, 0.1, 1.0)
	elif biome == "crystal":
		enemies = ["crystal_basilisk", "tunnel_spider", "stone_based_slime"]
		back.color = Color(0.1, 0.12, 0.15, 1.0)
	elif biome == "magma":
		enemies = ["magma_slime", "magma_golem", "cave_bat"]
		back.color = Color(0.15, 0.05, 0.05, 1.0)
	elif biome == "nest":
		enemies = ["small_jumping_spider", "tunnel_spider", "radioactive_centipede"]
		back.color = Color(0.08, 0.1, 0.05, 1.0)
	elif biome == "ice":
		enemies = ["polar_bear", "artic_wolf", "frost_yeti", "crystal_basilisk"]
		back.color = Color(0.15, 0.15, 0.2, 1.0)
	elif biome == "radioactive":
		enemies = ["radioactive_centipede", "green_forest_slime", "abyssal_crawler"]
		back.color = Color(0.05, 0.15, 0.05, 1.0)
	elif biome == "shadow":
		enemies = ["shadow_fiend", "creepy_ghost_child", "ghost_male", "ghost_female", "abyssal_crawler"]
		back.color = Color(0.05, 0.02, 0.08, 1.0)

	if _level > 5 and randf() > 0.5:
		enemies.append("bear")
	if _level > 8 and randf() > 0.5:
		enemies.append("forest_wolf")

	var num_enemies = clampi(8 + _level * 2, 8, 60)
	for i in range(num_enemies):
		var en := Enemy.new(enemies[randi() % enemies.size()])
		en.position = Vector2(randf_range(-14, 14) * 16, randf_range(-14, 14) * 16)
		if en.position.length() > 64: # keep away from spawn
			add_child(en)
		else:
			en.free()
			
	# Inject elite minibosses based on depth (e.g. 1 at floor 10, 3 at floor 30)
	if _level >= 10:
		var num_bosses = int(_level / 10.0)
		var boss_pool = ["frost_yeti", "magma_golem", "shadow_fiend", "bone_pax", "reaper_m", "archon_vex"]
		if biome == "ice": boss_pool = ["frost_yeti"]
		elif biome == "magma": boss_pool = ["magma_golem"]
		elif biome == "shadow": boss_pool = ["shadow_fiend", "reaper_m", "archon_vex"]
		elif biome == "stone": boss_pool = ["bone_pax", "garrick"]
		
		for b in range(num_bosses):
			var boss := Enemy.new(boss_pool[randi() % boss_pool.size()])
			boss.position = Vector2(randf_range(-12, 12) * 16, randf_range(-12, 12) * 16)
			if boss.position.length() > 64:
				add_child(boss)
			else:
				boss.free()
	# Exit ladder (up)
	var up_lad := _ladder(false)
	up_lad.position = Vector2(0, -32)
	add_child(up_lad)
	_exit_rect = Rect2(-16, -48, 32, 32)
	
	# Exit ladder (down)
	var down_lad := _ladder(true)
	down_lad.position = Vector2(0, (h/2 - 2) * 16)
	add_child(down_lad)
	_deeper_rect = Rect2(-16, down_lad.position.y - 16, 32, 32)

	# Place a minecart out if it's a multiple of 5
	if _level % 5 == 0:
		var stop = Minecart.new("mine_" + str(_level), "Level " + str(_level))
		stop.position = Vector2(-32, 0)
		add_child(stop)
		
	# Spawn rocks and ores
	var num_rocks = clampi(20 + _level * 2, 20, 80)
	var rock_pool = ["rock", "rock", "rock", "ore_rock"]
	if _level > 5:
		rock_pool.extend(["copper_rock", "geode_rock", "boulder", "boulder_iron"])
	if _level > 15:
		rock_pool.extend(["gold_rock", "boulder_copper", "boulder_geode", "crystal"])
	if _level > 25:
		rock_pool.extend(["boulder_gold", "meteorite"])
		
	for i in range(num_rocks):
		var r_type = rock_pool[randi() % rock_pool.size()]
		var r = Harvestable.new(r_type, 0)
		r.position = Vector2(randf_range(-14, 14) * 16, randf_range(-14, 14) * 16)
		if r.position.length() > 64 and r.position.distance_to(down_lad.position) > 64:
			add_child(r)
		else:
			r.free()
			
	# A little ambient light
	var light = PointLight2D.new()
	var glow := GradientTexture2D.new()
	var ramp := Gradient.new()
	ramp.set_color(0, Color.WHITE)
	ramp.set_color(1, Color(1, 1, 1, 0))
	glow.gradient = ramp
	glow.width = 128
	glow.height = 128
	glow.fill = GradientTexture2D.FILL_RADIAL
	glow.fill_from = Vector2(0.5, 0.5)
	glow.fill_to = Vector2(1, 0.5)
	light.texture = glow
	light.scale = Vector2(4, 4)
	light.energy = 0.5
	light.color = Color(0.8, 0.7, 0.6)
	add_child(light)

	if at == "bottom":
		return down_lad.position + Vector2(0, -16)
	return Vector2(0, 0)

func check_exit(p: Vector2) -> void:
	if _exit_rect.has_point(p):
		if _level > 1:
			Game.world.go_to("mine_" + str(_level - 1), "bottom")
		else:
			Game.world.go_to("mountain", "mine")
	elif _deeper_rect.has_point(p):
		Game.world.go_to("mine_" + str(_level + 1), "top")


func _ladder(descending: bool) -> Node2D:
	var ladder := Node2D.new()
	var opening := Polygon2D.new()
	opening.polygon = PackedVector2Array([Vector2(-11,-17), Vector2(11,-17), Vector2(11,5), Vector2(-11,5)])
	opening.color = Color("18171a") if descending else Color("343136")
	ladder.add_child(opening)
	for x in [-7, 7]:
		var rail := Line2D.new()
		rail.points = PackedVector2Array([Vector2(x,-19),Vector2(x,5)])
		rail.width = 3
		rail.default_color = Color("ad7d48")
		ladder.add_child(rail)
	for y in [-15, -9, -3, 3]:
		var rung := Line2D.new()
		rung.points = PackedVector2Array([Vector2(-7,y),Vector2(7,y)])
		rung.width = 2
		rung.default_color = Color("dfb573")
		ladder.add_child(rung)
	return ladder
