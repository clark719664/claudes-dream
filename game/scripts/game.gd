extends Node
## Global game state: controls, the clock, the cabin, goals, buffs, sleeping and saving.

signal message(text: String)
signal hour_changed(hour: int)
signal goal_changed(text: String)

const DAY_LENGTH := 600.0  # real seconds for a full day
const SAVE_PATH := "user://hearthwild_save.json"

## The story so far, one step at a time. Each has a check in _goal_done().
const GOALS := [
	["gather", "Gather wood and fiber (swing at trees and bushes)"],
	["twine", "Twist twine: press C for hand crafting"],
	["axe", "Make a stone axe at the workbench"],
	["planks", "Saw planks at the sawmill"],
	["iron", "Mine iron ore and smelt a bar at the furnace"],
	["nails", "Forge nails at the anvil"],
	["furnace2", "Upgrade the kiln into a brick furnace"],
	["cabin2", "Ask Tilda in Brindle to rebuild your cabin"],
	["graveyard", "Clear the skeletons from the old graveyard"],
	["warlord", "Defeat the orc warlord in the east"],
	["glass", "Fire glass from crystal at the furnace"],
	["cabin3", "Have Tilda build you a farmhouse"],
	["steel", "Forge a steel sword"],
	["frost", "Plunder the Frostvale shrine"],
]

var player: Node2D
var world: Node2D
var hud: CanvasLayer
var day := 1
var time_of_day := 0.3     # 0 = midnight, 0.5 = noon
var area := "world"
var cabin_tier := 1
var upgrade_pending := false
var goal := 0
var stats := {"gathered": {}, "crafted": {}, "kills": {}}
var opened := {}           # chests already looted, by id
var buffs := {}            # name -> seconds left
var station_tiers := {}    # station -> 1..3
var stations_found := {}   # minecart stop id -> name
var _last_hour := -1
var _goal_timer := 0.0
var _sleeping := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_bind("move_left", [KEY_A, KEY_LEFT], JOY_AXIS_LEFT_X, -1.0)
	_bind("move_right", [KEY_D, KEY_RIGHT], JOY_AXIS_LEFT_X, 1.0)
	_bind("move_up", [KEY_W, KEY_UP], JOY_AXIS_LEFT_Y, -1.0)
	_bind("move_down", [KEY_S, KEY_DOWN], JOY_AXIS_LEFT_Y, 1.0)
	_bind("attack", [KEY_J, KEY_SPACE], -1, 0.0, MOUSE_BUTTON_LEFT, JOY_BUTTON_X)
	_bind("interact", [KEY_E, KEY_ENTER], -1, 0.0, MOUSE_BUTTON_RIGHT, JOY_BUTTON_A)
	_bind("eat", [KEY_Q], -1, 0.0, -1, JOY_BUTTON_Y)
	_bind("sprint", [KEY_SHIFT], -1, 0.0, -1, JOY_BUTTON_RIGHT_SHOULDER)
	_bind("craft", [KEY_C], -1, 0.0, -1, JOY_BUTTON_LEFT_SHOULDER)
	_bind("inventory", [KEY_I, KEY_TAB], -1, 0.0, -1, JOY_BUTTON_BACK)
	_bind("map", [KEY_M], -1, 0.0, -1, JOY_BUTTON_START)
	_bind("cancel", [KEY_ESCAPE], -1, 0.0, -1, JOY_BUTTON_B)
	Inventory.changed.connect(_check_goal)
	Inventory.leveled.connect(func(lv): say("Crafting level %d! New recipes unlocked." % lv))


func _bind(action: String, keys: Array, axis := -1, axis_dir := 0.0, mouse := -1, joy := -1) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action, 0.3)
	for k in keys:
		var e := InputEventKey.new()
		e.physical_keycode = k
		InputMap.action_add_event(action, e)
	if axis >= 0:
		var j := InputEventJoypadMotion.new()
		j.axis = axis
		j.axis_value = axis_dir
		InputMap.action_add_event(action, j)
	if mouse >= 0:
		var m := InputEventMouseButton.new()
		m.button_index = mouse
		InputMap.action_add_event(action, m)
	if joy >= 0:
		var b := InputEventJoypadButton.new()
		b.button_index = joy
		InputMap.action_add_event(action, b)


func _process(delta: float) -> void:
	if get_tree().paused or world == null or _sleeping:
		return
	time_of_day += delta / DAY_LENGTH
	if time_of_day >= 1.0:
		time_of_day -= 1.0
		day += 1
	var h := hour()
	if h != _last_hour:
		_last_hour = h
		hour_changed.emit(h)
		if h == 2:
			pass_out()
	for b in buffs.keys():
		buffs[b] -= delta
		if buffs[b] <= 0.0:
			buffs.erase(b)
			say("The %s wears off." % b)
	_goal_timer -= delta
	if _goal_timer <= 0.0:
		_goal_timer = 1.0
		_check_goal()


func hour() -> int:
	return int(time_of_day * 24.0)


func clock_text() -> String:
	var minutes := int(time_of_day * 24.0 * 60.0)
	return "Day %d  %02d:%02d" % [day, minutes / 60, (minutes % 60) / 10 * 10]


## 0 in daylight, 1 in the middle of the night.
func darkness() -> float:
	var sun := sin((time_of_day - 0.25) * TAU)  # 1 at noon, -1 at midnight
	return clampf(0.35 - sun * 1.3, 0.0, 1.0)


func is_night() -> bool:
	return darkness() > 0.6


func say(text: String) -> void:
	message.emit(text)


func station_tier(station: String) -> int:
	return int(station_tiers.get(station, 1))


func has_buff(name: String) -> bool:
	return buffs.has(name)


func add_buff(name: String, seconds: float) -> void:
	buffs[name] = seconds
	say("You feel %s!" % {"might": "mighty", "haste": "light on your feet"}.get(name, name))


## A tiny freeze on big hits sells the impact.
func hitstop(duration := 0.05) -> void:
	Engine.time_scale = 0.05
	await get_tree().create_timer(duration, true, false, true).timeout
	Engine.time_scale = 1.0


func shake(amount := 2.0) -> void:
	if player and player.has_method("shake"):
		player.shake(amount)


# ---------------------------------------------------------------- stats and goals
func note_gather(item: String, n := 1) -> void:
	stats.gathered[item] = stats.gathered.get(item, 0) + n
	Inventory.gain_xp(1)


func note_craft(item: String, n := 1) -> void:
	stats.crafted[item] = stats.crafted.get(item, 0) + n
	_check_goal()


func note_kill(actor: String) -> void:
	stats.kills[actor] = stats.kills.get(actor, 0) + 1
	Inventory.gain_xp(4)
	_check_goal()


func goal_text() -> String:
	return GOALS[goal][1] if goal < GOALS.size() else "Brindle is safe. Make yourself at home."


func _kills(prefix: String) -> int:
	var n := 0
	for k in stats.kills:
		if k.begins_with(prefix):
			n += stats.kills[k]
	return n


func _goal_done(id: String) -> bool:
	match id:
		"gather": return stats.gathered.get("wood", 0) >= 3 and stats.gathered.get("fiber", 0) >= 2
		"twine": return stats.crafted.has("twine")
		"axe": return Inventory.has("axe") or Inventory.has("axe_iron")
		"planks": return stats.crafted.has("plank")
		"iron": return stats.crafted.has("iron_bar")
		"nails": return stats.crafted.has("nails")
		"furnace2": return station_tier("furnace") >= 2
		"cabin2": return cabin_tier >= 2 or (upgrade_pending and cabin_tier == 1)
		"graveyard": return _kills("skeleton") >= 5
		"warlord": return stats.kills.get("orc_warrior", 0) >= 1
		"glass": return stats.crafted.has("glass")
		"cabin3": return cabin_tier >= 3 or (upgrade_pending and cabin_tier == 2)
		"steel": return Inventory.has("sword_steel")
		"frost": return opened.has("frost")
	return false


func _check_goal() -> void:
	var advanced := false
	while goal < GOALS.size() and _goal_done(GOALS[goal][0]):
		goal += 1
		advanced = true
		Inventory.gain_xp(10 + goal * 4)
	if advanced:
		say("Goal complete! " + ("Next: " + goal_text() if goal < GOALS.size() else ""))
		goal_changed.emit(goal_text())


# ---------------------------------------------------------------- cabin, sleep, save
func request_upgrade() -> bool:
	var next := cabin_tier + 1
	if upgrade_pending or next >= Inventory.CABIN_TIERS.size():
		return false
	var cost: Dictionary = Inventory.CABIN_TIERS[next].cost
	if not Inventory.has_all(cost):
		return false
	Inventory.take_all(cost)
	upgrade_pending = true
	_check_goal()
	return true


func sleep() -> void:
	if _sleeping:
		return
	_sleeping = true
	await hud.fade(true)
	if time_of_day > 0.25:
		day += 1
	time_of_day = 0.25
	player.hp = player.max_hp
	buffs.clear()
	var upgraded := false
	if upgrade_pending:
		upgrade_pending = false
		cabin_tier += 1
		upgraded = true
		world.rebuild_cabin()
	world.new_day()
	save_game()
	await get_tree().create_timer(0.6).timeout
	await hud.fade(false)
	_sleeping = false
	if upgraded:
		say("Day %d. Tilda and the villagers finished your %s overnight!" % [day, Inventory.CABIN_TIERS[cabin_tier].name])
	else:
		say("Day %d. You feel rested. (Saved)" % day)
	_check_goal()


func pass_out() -> void:
	if _sleeping or player == null or player.dead:
		return
	say("It's 2 AM... you collapse from exhaustion.")
	await get_tree().create_timer(1.2).timeout
	world.enter_cabin(true)
	sleep()


func save_game() -> void:
	var data := {
		"day": day, "time": time_of_day, "cabin_tier": cabin_tier, "upgrade_pending": upgrade_pending,
		"goal": goal, "stats": stats, "opened": opened.keys(), "inventory": Inventory.save_data(),
		"stations": station_tiers, "minecarts": stations_found,
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))


func load_game() -> bool:
	if "--new" in OS.get_cmdline_user_args() or not FileAccess.file_exists(SAVE_PATH):
		return false
	var data = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if typeof(data) != TYPE_DICTIONARY:
		return false
	day = int(data.get("day", 1))
	time_of_day = float(data.get("time", 0.25))
	cabin_tier = int(data.get("cabin_tier", 1))
	upgrade_pending = bool(data.get("upgrade_pending", false))
	goal = int(data.get("goal", 0))
	stats = data.get("stats", stats)
	for k in ["gathered", "crafted", "kills"]:
		if not stats.has(k):
			stats[k] = {}
	opened = {}
	for id in data.get("opened", []):
		opened[id] = true
	station_tiers = {}
	for k in data.get("stations", {}):
		station_tiers[k] = int(data.stations[k])
	stations_found = data.get("minecarts", {})
	Inventory.load_data(data.get("inventory", {}))
	return true
