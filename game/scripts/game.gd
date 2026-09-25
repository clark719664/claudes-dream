extends Node
## Global game state: controls, the clock and the calendar, weather, gold and energy, what has
## changed in each area, goals, sleeping and saving.

signal message(text: String)
signal hour_changed(hour: int)
signal goal_changed(text: String)
signal day_started

const DAY_LENGTH := 840.0  # real seconds for a full day
const SAVE_PATH := "user://hearthwild_save.json"
const SEASONS := ["Spring", "Summer", "Fall", "Winter"]
const DAYS_PER_SEASON := 28
const MAX_ENERGY := 270
## season index, day of the season -> festival id (the town dresses up for it)
const FESTIVALS := {"0-13": "spring", "1-11": "summer", "2-16": "fall", "3-25": "winter"}
const FESTIVAL_NAMES := {"spring": "the Blossom Fair", "summer": "the Midsummer Bonfire", "fall": "the Harvest Fair", "winter": "the Night of Lanterns"}

## What to do next, one step at a time. Each has a check in _goal_done().
const GOALS := [
	["clear", "Clear your overgrown farm: cut weeds, break stones, chop stumps (10)"],
	["plant", "Till soil with the hoe and plant your carrot seeds"],
	["water", "Water your crops (refill the can at the pond)"],
	["ship", "Harvest something and put it in the shipping crate by your door"],
	["gold", "Earn 1,000 gold from shipping"],
	["workbench", "Buy a workbench kit from Tilda in Brindle and set it up on your farm"],
	["spring", "Find one of the hidden springs deep in the woods"],
	["furnace", "Set up a furnace and smelt an iron bar (ore on the mountain)"],
	["deepways", "Find the Deepways shaft in Brindle and get a cart running"],
	["cabin2", "Have Tilda rebuild your cabin"],
	["warlord", "Defeat the orc warlord in the badlands"],
	["frost", "Plunder the Frost Shrine on the summit"],
	["cabin3", "Have Tilda build you a farmhouse"],
]

var player: Node2D
var world: Node2D
var hud: CanvasLayer
var day := 1
var time_of_day := 0.25    # 0 = midnight, 0.5 = noon
var area := "house"        # the area you're in
var cabin_tier := 1
var upgrade_pending := false
var goal := 0
var gold := 0
var energy := MAX_ENERGY
var weather := "sun"       # sun, rain, storm, wind, snow
var shipped := {}          # item -> count, paid out overnight
var earned := 0            # all gold ever made from shipping
var areas := {}            # area id -> {"removed": {id: day}, "placed": [], "soil": {}, "crops": {}}
var springs := {}          # spring name -> last day you drank
var stats := {"gathered": {}, "crafted": {}, "kills": {}, "cleared": 0}
var opened := {}           # chests already looted, by id
var buffs := {}            # name -> seconds left
var station_tiers := {}    # station -> 1..3
var stations_found := {}   # minecart stop id -> name (unused since v5; kept for old saves)
var report := ""           # the morning report, shown after waking
var look := "player_male"  # which character you are (the wardrobe changes it)
var can_tier := 0          # the watering can: 0 plain, 1 copper, 2 iron, 3 gold
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
	_bind("slot_next", [], -1, 0.0, MOUSE_BUTTON_WHEEL_DOWN, JOY_BUTTON_DPAD_RIGHT)
	_bind("slot_prev", [], -1, 0.0, MOUSE_BUTTON_WHEEL_UP, JOY_BUTTON_DPAD_LEFT)
	for i in 10:
		_bind("slot_%d" % i, [KEY_1 + i if i < 9 else KEY_0])
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


# ---------------------------------------------------------------- calendar and weather
func hour() -> int:
	return int(time_of_day * 24.0)


func season() -> int:
	return int((day - 1) / DAYS_PER_SEASON) % 4


func day_of_season() -> int:
	return (day - 1) % DAYS_PER_SEASON + 1


func year() -> int:
	return int((day - 1) / (DAYS_PER_SEASON * 4)) + 1


func date_text() -> String:
	return "%s %d" % [SEASONS[season()], day_of_season()] + ("  Y%d" % year() if year() > 1 else "")


func clock_text() -> String:
	var minutes := int(time_of_day * 24.0 * 60.0)
	var h := minutes / 60
	var ap := "am" if h < 12 else "pm"
	return "%d:%02d%s" % [(h + 11) % 12 + 1, (minutes % 60) / 10 * 10, ap]


## The festival on today's date ("" if none): "spring", "summer", "fall" or "winter".
func festival() -> String:
	return FESTIVALS.get("%d-%d" % [season(), day_of_season()], "")


## Tomorrow's weather is decided by the date, so it's the same on every playthrough.
func roll_weather(d: int) -> String:
	var s := int((d - 1) / DAYS_PER_SEASON) % 4
	var dos := (d - 1) % DAYS_PER_SEASON + 1
	if d <= 2 or FESTIVALS.has("%d-%d" % [s, dos]):
		return "sun"
	var r := float(hash(d * 7919 + 13) % 1000) / 1000.0
	match s:
		0: return "rain" if r < 0.26 else ("storm" if r < 0.31 else ("wind" if r < 0.4 else "sun"))
		1: return "rain" if r < 0.12 else ("storm" if r < 0.25 else "sun")
		2: return "rain" if r < 0.24 else ("wind" if r < 0.5 else "sun")
		_: return "snow" if r < 0.45 else "sun"


func raining() -> bool:
	return weather in ["rain", "storm"]


## 0 in daylight, 1 in the middle of the night.
func darkness() -> float:
	var sun := sin((time_of_day - 0.25) * TAU)  # 1 at noon, -1 at midnight
	return clampf(0.35 - sun * 1.3, 0.0, 1.0)


func is_night() -> bool:
	return darkness() > 0.6


func indoors() -> bool:
	return area == "house" or underground()


func underground() -> bool:
	return area.begins_with("mine") or area == "deepways"


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


# ---------------------------------------------------------------- energy and gold
## Spend energy on a tool swing. false (and a message) if you're too tired.
func use_energy(n: int) -> bool:
	if energy <= 0:
		say("You're too exhausted. Eat something or go to bed.")
		return false
	energy = maxi(0, energy - n)
	if energy == 0:
		say("You're exhausted...")
	return true


func restore_energy(n: int) -> void:
	energy = mini(MAX_ENERGY, energy + n)


func pay(n: int) -> bool:
	if gold < n:
		return false
	gold -= n
	return true


# ---------------------------------------------------------------- what's changed in each area
func area_state(id: String) -> Dictionary:
	if not areas.has(id):
		areas[id] = {"removed": {}, "placed": [], "soil": {}, "crops": {}}
	return areas[id]


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


func note(key: String, n := 1) -> void:
	stats[key] = int(stats.get(key, 0)) + n
	_check_goal()


func goal_text() -> String:
	return GOALS[goal][1] if goal < GOALS.size() else "Your farm is thriving. Make yourself at home."


func _goal_done(id: String) -> bool:
	match id:
		"clear": return int(stats.get("cleared", 0)) >= 10
		"plant": return int(stats.get("planted", 0)) >= 1
		"water": return int(stats.get("watered", 0)) >= 1
		"ship": return int(stats.get("shipped", 0)) >= 1
		"gold": return earned >= 1000
		"workbench": return int(stats.get("placed_workbench", 0)) >= 1
		"spring": return not springs.is_empty()
		"furnace": return stats.crafted.has("iron_bar")
		"deepways": return not stations_found.is_empty()
		"cabin2": return cabin_tier >= 2 or (upgrade_pending and cabin_tier == 1)
		"warlord": return stats.kills.get("orc_warrior", 0) >= 1
		"frost": return opened.has("frost")
		"cabin3": return cabin_tier >= 3 or (upgrade_pending and cabin_tier == 2)
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


# ---------------------------------------------------------------- the house, sleep, save
## Tilda starts on the next house. Paid with gold and materials; done by morning.
func request_upgrade() -> String:
	var next := cabin_tier + 1
	if upgrade_pending:
		return "Tilda is already working on it. Sleep, and it'll be done by morning."
	if next >= Inventory.CABIN_TIERS.size():
		return "That's the finest house in the valley. Nothing left to build!"
	var t: Dictionary = Inventory.CABIN_TIERS[next]
	if gold < int(t.gold) or not Inventory.has_all(t.cost):
		return "Tilda: \"Not enough gold or materials yet.\""
	gold -= int(t.gold)
	Inventory.take_all(t.cost)
	upgrade_pending = true
	_check_goal()
	return "Tilda: \"Leave it to me. It'll be ready when you wake up.\""


func sleep(passed_out := false) -> void:
	if _sleeping:
		return
	_sleeping = true
	await hud.fade(true)
	if time_of_day > 0.25:
		day += 1
	time_of_day = 0.25
	player.hp = player.max_hp
	energy = MAX_ENERGY if not passed_out else MAX_ENERGY / 2
	buffs.clear()
	var lines: Array[String] = []
	# the carter came by in the night for whatever you shipped
	var total := 0
	var parts: Array[String] = []
	for item in shipped:
		var n: int = shipped[item]
		var v := Inventory.sell_price(item) * n
		total += v
		parts.append("%d %s" % [n, Inventory.display_name(item)])
	if total > 0:
		gold += total
		earned += total
		lines.append("Shipped %s: +%dg" % [", ".join(parts), total])
	shipped = {}
	var upgraded := false
	if upgrade_pending:
		upgrade_pending = false
		cabin_tier += 1
		upgraded = true
		lines.append("Tilda finished your %s overnight!" % Inventory.CABIN_TIERS[cabin_tier].name)
	weather = roll_weather(day)
	var died: int = world.new_day()
	if died > 0:
		lines.append("%d crop%s withered out of season." % [died, "s" if died > 1 else ""])
	if passed_out:
		lines.append("You passed out. Someone carried you home.")
	var fest := festival()
	if fest != "":
		lines.append("Today is %s in Brindle!" % FESTIVAL_NAMES[fest])
	lines.append({"sun": "Clear skies today.", "rain": "Rain today: your crops are watered.", "storm": "A storm is coming in.",
		"wind": "A windy day.", "snow": "Snow is falling."}[weather])
	report = "%s, Day %d.\n%s" % [SEASONS[season()], day_of_season(), "\n".join(lines)]
	if upgraded:
		world.rebuild_cabin()
	world.wake_up()
	save_game()
	await get_tree().create_timer(0.5).timeout
	await hud.fade(false)
	_sleeping = false
	hud.show_dialog("Morning", report)
	day_started.emit()
	_check_goal()


func pass_out() -> void:
	if _sleeping or player == null or player.dead:
		return
	say("It's 2 AM... you collapse from exhaustion.")
	await get_tree().create_timer(1.2).timeout
	sleep(true)


func save_game() -> void:
	var data := {
		"version": 5, "day": day, "time": time_of_day, "cabin_tier": cabin_tier, "upgrade_pending": upgrade_pending,
		"goal": goal, "stats": stats, "opened": opened.keys(), "inventory": Inventory.save_data(),
		"stations": station_tiers, "gold": gold, "energy": energy, "weather": weather, "shipped": shipped,
		"earned": earned, "areas": areas, "springs": springs, "look": look, "can_tier": can_tier, "carts": stations_found,
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))


func load_game() -> bool:
	if "--new" in OS.get_cmdline_user_args() or not FileAccess.file_exists(SAVE_PATH):
		return false
	var data = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if typeof(data) != TYPE_DICTIONARY or int(data.get("version", 0)) < 5:
		return false
	day = int(data.get("day", 1))
	time_of_day = 0.25
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
	gold = int(data.get("gold", 0))
	energy = int(data.get("energy", MAX_ENERGY))
	weather = str(data.get("weather", "sun"))
	shipped = data.get("shipped", {})
	earned = int(data.get("earned", 0))
	areas = data.get("areas", {})
	springs = data.get("springs", {})
	look = str(data.get("look", "player_male"))
	can_tier = int(data.get("can_tier", 0))
	stations_found = data.get("carts", {})
	Inventory.load_data(data.get("inventory", {}))
	return true


func new_game() -> void:
	day = 1
	time_of_day = 0.25
	gold = Inventory.START_GOLD
	energy = MAX_ENERGY
	weather = "sun"
	Inventory.start_new()
