extends Node

var failures: Array[String] = []
var checks := 0

func _ready() -> void:
	call_deferred("run")

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		print("FAIL: ", message)

func run() -> void:
	var kinds := ["sativa", "hybrid", "indica"]
	for kind in kinds:
		check(Inventory.CROPS.has(kind), kind + " is registered as a growable crop")
		check(Inventory.is_seed(kind + "_seeds"), kind + " canonical seeds can be planted")
		check(Inventory.is_seed(kind + "_seed"), kind + " legacy seeds remain usable")
		check(Pack.has_sprite("crop_" + kind), kind + " has dedicated growth artwork")
		check(Pack.catalog.items.has(kind), kind + " has a harvest icon")
	check(not Inventory.is_seed("nonexistent_seeds"), "unknown seeds are rejected safely")
	if not failures.is_empty():
		print("CROP TESTS: ", checks, " checks, ", failures.size(), " failures")
		get_tree().quit(1)
		return
	var world := World.new()
	Game.world = world
	world.area_id = "farm"
	world.entities = Node2D.new()
	get_tree().root.add_child(world.entities)
	Game.areas = {}
	Game.day = 1
	Game.weather = "sun"
	var state: Dictionary = Game.area_state("farm")
	var soil := Soil.new(state)
	world.soil = soil
	get_tree().root.add_child(soil)
	for i in range(kinds.size()):
		var kind: String = kinds[i]
		var cell := Vector2i(i * 2, 0)
		var key: String = Soil.key_of(cell)
		soil.till(cell)
		check(soil.plant(cell, kind), kind + " plants in tilled soil")
		check(not soil.plant(cell, kind), "occupied crop cell cannot be replanted")
		world.new_day()
		check(int(state.crops[key].age) == 0, kind + " does not grow without watering")
		check(soil.harvest(cell) == 0, kind + " cannot be harvested early")
		var days: int = Inventory.CROPS[kind].days
		for day in range(days):
			soil.water(cell)
			world.new_day()
		check(Crop.stage_of(state.crops[key]) == 3, kind + " matures after its watered days")
		check(soil.harvest(cell) >= 1, kind + " yields a harvest")
		check(not state.crops.has(key), kind + " harvest clears the saved crop state")
		check(Inventory.sell_price(kind) > 0, kind + " harvest can be shipped")
		check(Inventory.tint(kind) == Color.WHITE, kind + " preserves original bud colors")
		var spec: Dictionary = Pack.spec("crop_" + kind, 3)
		check(str(spec.sheet).begins_with("curated/strains/"), kind + " uses curated foliage")
	var winter_cell := Vector2i(10, 0)
	soil.till(winter_cell)
	soil.plant(winter_cell, "sativa")
	Game.day = 85
	check(world.new_day() == 1, "out-of-season crops wither")
	check(not state.crops.has(Soil.key_of(winter_cell)), "winter removes crop from save state")
	soil.queue_free()
	world.entities.queue_free()
	world.free()
	Game.world = null
	print("CROP TESTS: ", checks, " checks, ", failures.size(), " failures")
	get_tree().quit(0 if failures.is_empty() else 1)
