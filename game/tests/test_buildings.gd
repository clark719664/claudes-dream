extends "res://scripts/world.gd"
## Curated buildings: art, spacing, doors that only open on interact, and the way back out.

var failures: Array[String] = []
var checks := 0


func _ready() -> void:
	super._ready()
	call_deferred("run")


func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		print("FAIL: ", message)


func settle(frames := 6) -> void:
	for i in frames:
		await get_tree().physics_frame


func buildings() -> Array:
	var out := []
	for n in entities.get_children():
		if n is CustomBuilding:
			out.append(n)
	return out


func find(kind: String) -> CustomBuilding:
	for b in buildings():
		if b.building_id == kind:
			return b
	return null


func art_rect(b: CustomBuilding) -> Rect2:
	var s := b.sprite
	return Rect2(b.global_position + s.offset * s.scale, s.texture.get_size() * s.scale)


func run() -> void:
	Game.hud.dialog.hide()
	get_tree().paused = false
	load_area("town", "")
	player.global_position = Vector2(880, 720)
	stream_around(Vector2(880, 800), true)
	stream_around(Vector2(1500, 800), true)
	await settle()
	var town := buildings()
	check(town.size() >= 17, "all town buildings spawn (%d)" % town.size())
	for b in town:
		check(b.sprite.texture != null, b.building_id + " has art")
		check(Pack.spec(b.building_id).get("curated", false), b.building_id + " uses curated art")
		var r := art_rect(b)
		check(r.position.x >= 0.0 and r.end.x <= size.x, "%s stands inside the map (%s)" % [b.building_id, r])
	for i in town.size():
		for j in range(i + 1, town.size()):
			var a: Rect2 = art_rect(town[i])
			var b: Rect2 = art_rect(town[j])
			check(not a.grow(-2).intersects(b.grow(-2)), "%s and %s do not overlap" % [town[i].building_id, town[j].building_id])

	var lib := find("library")
	var door: Vector2 = lib.global_position + lib.door_area.position
	player.global_position = door + Vector2(0, 60)
	await settle()
	lib.interact(player)
	player.facing = Vector2.UP
	player._interact()
	await settle(20)
	check(area_id == "town", "interact away from the door does not enter")
	player.global_position = door + Vector2(0, 4)
	await settle()
	player.facing = Vector2.UP
	player._interact()
	await get_tree().create_timer(1.0).timeout
	check(area_id == "library", "interact at the library door enters it (in %s)" % area_id)
	check(interior != null and props_root_count() >= 5, "library furniture is placed")
	player.global_position.y = interior.exit_line() + 4 if interior else 0.0
	await get_tree().create_timer(1.2).timeout
	check(area_id == "town", "walking out of the library returns to town (in %s)" % area_id)
	check(player.global_position.distance_to(door) < 24.0, "you come out at the library door (%s vs %s)" % [player.global_position, door])

	var tower := find("wizard_tower")
	player.global_position = tower.global_position + tower.door_area.position + Vector2(0, 4)
	await settle()
	player.facing = Vector2.UP
	player._interact()
	await get_tree().create_timer(0.6).timeout
	check(area_id == "town", "a building without an interior stays shut")
	check(Game.hud.dialog.visible, "a locked door says so")
	Game.hud.dialog.hide()

	for id in ["general_store", "saloon", "blacksmith_shop", "library", "clinic", "school", "church", "bathhouse", "museum", "inn", "mayors_manor", "npc_house_1", "npc_house_2", "dispensary"]:
		load_area(id, "door")
		await settle(2)
		var want: int = Interior.load_layout(id).sorted_count
		check(props_root_count() == want, "%s furniture all placed (%d of %d)" % [id, props_root_count(), want])

	load_area("farm", "door")
	await settle()
	var at: Vector2 = player.global_position + Vector2(200, 80)
	for kind in ["barn", "silo"]:
		var o := {"t": "custom_building", "kind": kind, "x": at.x + (0 if kind == "barn" else 160), "y": at.y}
		spawn(o)
	await settle()
	var silo := find("silo")
	check(silo != null and silo.door_area == null, "the silo has no door")
	var barn := find("barn")
	player.global_position = barn.global_position + barn.door_area.position + Vector2(0, 4)
	await settle()
	player.facing = Vector2.UP
	player._interact()
	await get_tree().create_timer(1.0).timeout
	check(area_id == "barn", "the built barn opens (in %s)" % area_id)
	player.global_position.y = interior.exit_line() + 4 if interior else 0.0
	await get_tree().create_timer(1.2).timeout
	check(area_id == "farm" and player.global_position.distance_to(barn.global_position if is_instance_valid(barn) else at) < 40.0, "leaving the barn puts you at its door on the farm")

	print("BUILDING TESTS: ", checks, " checks, ", failures.size(), " failures")
	get_tree().quit(0 if failures.is_empty() else 1)


func props_root_count() -> int:
	var n := 0
	for c in entities.get_children():
		if c.name == "CabinProps" and not c.is_queued_for_deletion():
			n += c.get_child_count()
	return n
