class_name Hud
extends CanvasLayer
## Health and energy, level, the date, clock, weather and gold, the goal, the toolbar, messages,
## dialogue, and the menus: crafting, the pack, shops, the shipping crate, the map. Also the fade
## used for doors, area changes and sleep.

signal faded
signal answered(yes: bool)

const PANEL := Color(0.15, 0.1, 0.07, 0.93)
const EDGE := Color(0.62, 0.43, 0.24)
const TEXT := Color(0.98, 0.93, 0.82)
const DIM := Color(0.62, 0.55, 0.46)
const BAD := Color(0.95, 0.42, 0.35)
const GOOD := Color(0.6, 0.92, 0.5)
const GOLD := Color(1.0, 0.8, 0.45)
const STRIP_MAX := 10

var root: Control
var hp_bar: ColorRect
var hp_label: Label
var en_bar: ColorRect
var en_label: Label
var date_label: Label
var gold_label: Label
var xp_bar: ColorRect
var lv_label: Label
var clock: Label
var buff_label: Label
var goal_label: Label
var gear: HBoxContainer
var strip: HBoxContainer
var toast: Label
var hint: PanelContainer
var dialog: PanelContainer
var dialog_label: Label
var menu: PanelContainer        # crafting, inventory and upgrade screens share one panel
var menu_box: VBoxContainer
var black: ColorRect
var _toast_t := 0.0
var _mode := ""                 # "", "craft", "inventory", "shop", "ship", "travel", "map"
var _shop := ""
var _shop_owner := ""
var _goods: Array = []
var _ship_items: Array = []
var _station := ""
var _station_node: Node = null
var _selected := 0
var _confirm: Callable
var _stops: Array = []          # minecart stop ids listed in the travel menu
var _here := ""


func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	Game.hud = self
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var theme := Theme.new()
	theme.default_font = Pack.font
	theme.default_font_size = 8
	theme.set_color("font_color", "Label", TEXT)
	root.theme = theme
	add_child(root)
	_build_status()
	_build_clock()
	_build_strip()
	_build_toast()
	_build_hint()
	_build_dialog()
	_build_menu()
	black = ColorRect.new()
	black.color = Color(0, 0, 0, 0)
	black.set_anchors_preset(Control.PRESET_FULL_RECT)
	black.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(black)
	Inventory.changed.connect(_refresh_items)
	Game.message.connect(say)
	Game.goal_changed.connect(func(t): goal_label.text = t)
	_refresh_items()


func _process(delta: float) -> void:
	var p := Game.player as Player
	if p:
		hp_bar.size.x = 56.0 * clampf(float(p.hp) / p.max_hp, 0.0, 1.0)
		hp_bar.color = GOOD if p.hp > 50 else (Color(0.95, 0.75, 0.3) if p.hp > 25 else BAD)
		hp_label.text = "%d" % p.hp
	en_bar.size.x = 56.0 * clampf(float(Game.energy) / Game.MAX_ENERGY, 0.0, 1.0)
	en_bar.color = Color(0.45, 0.8, 1.0) if Game.energy > 60 else (Color(0.95, 0.75, 0.3) if Game.energy > 20 else BAD)
	en_label.text = "%d" % Game.energy
	date_label.text = "%s   %s" % [Game.date_text(), {"sun": "Sunny", "rain": "Rain", "storm": "Storm", "wind": "Windy", "snow": "Snow"}.get(Game.weather, "")]
	gold_label.text = "%dg" % Game.gold
	var lv := Inventory.level
	var lo := Inventory.xp_for(lv)
	var hi := Inventory.xp_for(lv + 1)
	xp_bar.size.x = 56.0 * clampf(float(Inventory.xp - lo) / maxf(hi - lo, 1), 0.0, 1.0)
	lv_label.text = "LV %d" % lv
	clock.text = Game.clock_text()
	var b := ""
	for k in Game.buffs:
		b += "%s %ds  " % [k.to_upper(), int(Game.buffs[k])]
	buff_label.text = b
	buff_label.visible = b != ""
	if _toast_t > 0.0:
		_toast_t -= delta
		toast.modulate.a = clampf(_toast_t * 2.0, 0.0, 1.0)


func say(text: String) -> void:
	toast.text = text
	_toast_t = 3.5


# ---------------------------------------------------------------- building blocks
func _panel(min_size := Vector2.ZERO) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL
	sb.border_color = EDGE
	sb.set_border_width_all(1)
	sb.set_content_margin_all(4)
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_offset = Vector2(1, 1)
	sb.shadow_size = 1
	p.add_theme_stylebox_override("panel", sb)
	p.custom_minimum_size = min_size
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p


func _label(text := "", colour := TEXT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", colour)
	return l


func _icon(item: String, px: int) -> TextureRect:
	var t := TextureRect.new()
	t.texture = Pack.icon("carrot" if item == "any_veg" else item)
	t.custom_minimum_size = Vector2(px, px)
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	t.modulate = Inventory.tint(item)
	return t


func _bar(width: float, colour: Color) -> Array:
	var back := ColorRect.new()
	back.color = Color(0.08, 0.05, 0.04)
	back.custom_minimum_size = Vector2(width + 2, 6)
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var bar := ColorRect.new()
	bar.position = Vector2(1, 1)
	bar.size = Vector2(width, 4)
	bar.color = colour
	back.add_child(bar)
	return [back, bar]


func _clear(box: Node) -> void:
	for c in box.get_children():
		box.remove_child(c)
		c.queue_free()


# ---------------------------------------------------------------- always-on widgets
func _build_status() -> void:
	var box := _panel()
	box.position = Vector2(4, 4)
	root.add_child(box)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 3)
	box.add_child(v)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	v.add_child(row)
	row.add_child(_label("HP", BAD))
	var hp := _bar(56, GOOD)
	row.add_child(hp[0])
	hp_bar = hp[1]
	hp_label = _label("100")
	row.add_child(hp_label)
	var row_e := HBoxContainer.new()
	row_e.add_theme_constant_override("separation", 4)
	v.add_child(row_e)
	row_e.add_child(_label("EN", Color(0.45, 0.8, 1.0)))
	var en := _bar(56, Color(0.45, 0.8, 1.0))
	row_e.add_child(en[0])
	en_bar = en[1]
	en_label = _label("270")
	row_e.add_child(en_label)
	var row2 := HBoxContainer.new()
	row2.add_theme_constant_override("separation", 4)
	v.add_child(row2)
	lv_label = _label("LV 1", GOLD)
	row2.add_child(lv_label)
	var xp := _bar(56, GOLD)
	row2.add_child(xp[0])
	xp_bar = xp[1]
	gear = HBoxContainer.new()
	gear.add_theme_constant_override("separation", 2)
	v.add_child(gear)


func _build_clock() -> void:
	var box := _panel()
	box.position = Vector2(480 - 176 - 4, 4)
	box.custom_minimum_size = Vector2(176, 0)
	root.add_child(box)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	box.add_child(v)
	date_label = _label("Spring 1")
	date_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(date_label)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 14)
	v.add_child(row)
	clock = _label("6:00am")
	row.add_child(clock)
	gold_label = _label("0g", GOLD)
	row.add_child(gold_label)
	buff_label = _label("", GOOD)
	buff_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(buff_label)
	goal_label = _label(Game.goal_text(), GOLD)
	goal_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	goal_label.custom_minimum_size = Vector2(168, 0)
	v.add_child(goal_label)


func _build_strip() -> void:
	var box := _panel()
	box.name = "Items"
	root.add_child(box)
	strip = HBoxContainer.new()
	strip.add_theme_constant_override("separation", 1)
	box.add_child(strip)
	box.resized.connect(func(): box.position = Vector2(roundf((480 - box.size.x) / 2.0), 270 - box.size.y - 3))


func _build_toast() -> void:
	toast = _label("")
	toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast.position = Vector2(0, 226)
	toast.size = Vector2(480, 10)
	toast.add_theme_color_override("font_outline_color", Color(0.08, 0.05, 0.03))
	toast.add_theme_constant_override("outline_size", 3)
	root.add_child(toast)


func _build_hint() -> void:
	hint = _panel()
	hint.position = Vector2(4, 62)
	hint.add_child(_label("WASD move   SHIFT run\n1-0 / WHEEL pick a tool\nSPACE / CLICK use it\nE talk - open - harvest\nC craft  I pack  M map\nQ eat   ESC close", DIM))
	root.add_child(hint)
	var tw := hint.create_tween()
	tw.tween_interval(18.0)
	tw.tween_property(hint, "modulate:a", 0.0, 1.5)


func _refresh_items() -> void:
	_clear(strip)
	_clear(gear)
	var p := Game.player as Player
	var sel := p.slot if p else 0
	for i in 10:
		var item := Inventory.slot(i)
		var cell := PanelContainer.new()
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.36, 0.24, 0.14, 0.95) if i == sel else Color(0.1, 0.07, 0.05, 0.6)
		sb.border_color = GOLD if i == sel else Color(0.35, 0.25, 0.16)
		sb.set_border_width_all(1)
		sb.set_content_margin_all(1)
		cell.add_theme_stylebox_override("panel", sb)
		cell.custom_minimum_size = Vector2(22, 22)
		var holder := Control.new()
		holder.custom_minimum_size = Vector2(20, 20)
		cell.add_child(holder)
		if item != "":
			var ic := _icon(item, 16)
			ic.position = Vector2(2, 1)
			holder.add_child(ic)
			var n := Inventory.count(item)
			if n > 1:
				var l := _label(str(n))
				l.add_theme_color_override("font_outline_color", Color(0.05, 0.03, 0.02))
				l.add_theme_constant_override("outline_size", 2)
				l.position = Vector2(10 if n < 10 else 6, 11)
				holder.add_child(l)
			if item == "watering_can":
				var back := ColorRect.new()
				back.color = Color(0.05, 0.05, 0.1)
				back.position = Vector2(2, 18)
				back.size = Vector2(16, 2)
				holder.add_child(back)
				var bar := ColorRect.new()
				bar.color = Color(0.4, 0.65, 1.0)
				bar.size = Vector2(16.0 * Inventory.water / Inventory.CAN_SIZE, 2)
				back.add_child(bar)
		strip.add_child(cell)
	var name_text := Inventory.display_name(Inventory.slot(sel)) if Inventory.slot(sel) != "" else ""
	gear.add_child(_label(name_text, DIM))
	strip.get_parent().reset_size()
	gear.get_parent().get_parent().reset_size()
	if _mode != "":
		_refresh_menu()


# ---------------------------------------------------------------- dialogue, confirm, fade
func _build_dialog() -> void:
	dialog = _panel(Vector2(360, 0))
	dialog.visible = false
	var l := _label("")
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(350, 0)
	dialog.add_child(l)
	dialog_label = l
	root.add_child(dialog)


func show_dialog(who: String, text: String) -> void:
	_confirm = Callable()
	dialog_label.text = who.to_upper() + "\n" + text
	_show_dialog()


func confirm(question: String, on_yes: Callable) -> void:
	_confirm = on_yes
	dialog_label.text = question + "\nE  yes        ESC  no"
	_show_dialog()


func _show_dialog() -> void:
	dialog.visible = true
	dialog.reset_size()
	dialog.position = Vector2(60, 218 - dialog.size.y)


func fade(to_black: bool, time := 0.35) -> void:
	var tw := black.create_tween()
	tw.tween_property(black, "color:a", 1.0 if to_black else 0.0, time)
	await tw.finished


# ---------------------------------------------------------------- menus
func _build_menu() -> void:
	menu = _panel(Vector2(300, 0))
	menu.visible = false
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	menu_box = VBoxContainer.new()
	menu_box.add_theme_constant_override("separation", 2)
	menu.add_child(menu_box)
	root.add_child(menu)


func open_crafting(station: String, node: Node = null) -> void:
	_station_node = node
	_open("craft", station)


func toggle_inventory() -> void:
	if _mode == "inventory":
		close_menu()
	else:
		_open("inventory", "")


func open_shop(shop: String, owner: String) -> void:
	_shop = shop
	_shop_owner = owner
	_goods = Inventory.shop_goods(shop, Game.season())
	_open("shop", "")


func open_shipping() -> void:
	_open("ship", "")


## A new area: say where you are.
func area_changed() -> void:
	var w = Game.world
	if w.area_id == "house":
		return
	var name: String = w.data.get("name", "") if w.data else ""
	if name != "":
		say(name)


func open_travel(from_id: String) -> void:
	_here = from_id
	_stops = Game.stations_found.keys()
	_open("travel", "")
	_selected = maxi(0, _stops.find(from_id))
	_refresh_menu()


func toggle_map() -> void:
	if _mode == "map":
		close_menu()
	else:
		_open("map", "")


func _open(mode: String, station: String) -> void:
	_mode = mode
	_station = station
	_selected = 0
	dialog.visible = false
	menu.visible = true
	get_tree().paused = true
	_refresh_menu()


func close_menu() -> void:
	_mode = ""
	menu.visible = false
	get_tree().paused = false


## kept for older callers
func close_crafting() -> void:
	close_menu()


func _unhandled_input(event: InputEvent) -> void:
	if dialog.visible:
		if event.is_action_pressed("interact") or event.is_action_pressed("attack") or event.is_action_pressed("cancel"):
			dialog.visible = false
			get_viewport().set_input_as_handled()
			if _confirm.is_valid() and event.is_action_pressed("interact"):
				var c := _confirm
				_confirm = Callable()
				c.call()
		return
	if _mode == "":
		return
	if event.is_action_pressed("cancel") or (_mode == "inventory" and event.is_action_pressed("inventory")) or (_mode == "craft" and _station == "hands" and event.is_action_pressed("craft")) or (_mode == "map" and event.is_action_pressed("map")):
		close_menu()
	elif _mode in ["craft", "travel", "shop", "ship"] and event.is_action_pressed("move_up"):
		_selected = (_selected - 1 + _row_count()) % _row_count()
		_refresh_menu()
	elif _mode in ["craft", "travel", "shop", "ship"] and event.is_action_pressed("move_down"):
		_selected = (_selected + 1) % _row_count()
		_refresh_menu()
	elif event.is_action_pressed("interact") or (event is InputEventKey and event.is_action_pressed("attack")):
		if _mode == "craft":
			_craft_selected()
		elif _mode == "shop":
			_buy_selected()
		elif _mode == "ship":
			_ship_selected(Input.is_action_pressed("sprint"))
		elif _mode == "travel":
			_ride_selected()
	else:
		return
	get_viewport().set_input_as_handled()


func _recipes() -> Array:
	return Inventory.RECIPES[_station]


func _tier() -> int:
	return Game.station_tier(_station) if Inventory.STATION_UPGRADES.has(_station) else 3


func _can_upgrade() -> bool:
	return Inventory.STATION_UPGRADES.has(_station) and _tier() < 3


func _row_count() -> int:
	if _mode == "travel":
		return maxi(1, _stops.size())
	if _mode == "shop":
		return maxi(1, _goods.size())
	if _mode == "ship":
		return maxi(1, _ship_items.size())
	return _recipes().size() + (1 if _can_upgrade() else 0)


func _craft_selected() -> void:
	if _selected >= _recipes().size():
		_upgrade_station()
		return
	var recipe: Dictionary = _recipes()[_selected]
	var why := Inventory.blocker(recipe, _tier())
	if why == "":
		var made := Inventory.craft(recipe, _tier())
		Game.note_craft(recipe.out, made)
		say("Made %s%s" % [Inventory.display_name(recipe.out), (" x%d" % made) if made > 1 else ""])
	else:
		say(why + ".")
	_refresh_menu()


func _upgrade_station() -> void:
	var next := _tier() + 1
	var cost: Dictionary = Inventory.STATION_UPGRADES[_station][next]
	if not Inventory.has_all(cost):
		say("Not enough materials for the upgrade.")
		return
	Inventory.take_all(cost)
	if _station_node and _station_node.has_method("upgrade"):
		_station_node.upgrade()
	else:
		Game.station_tiers[_station] = next
	Inventory.gain_xp(15 * next)
	say("Built the %s!" % Pack.station_spec(_station, next).name)
	Game._check_goal()
	_selected = 0
	_refresh_menu()


func _buy_selected() -> void:
	if _goods.is_empty():
		return
	var g: Dictionary = _goods[_selected]
	if g.has("house"):
		say(Game.request_upgrade())
		_refresh_menu()
		return
	var cost: Dictionary = g.get("cost", {})
	if Game.gold < int(g.gold):
		say("Not enough gold.")
	elif not Inventory.has_all(cost):
		say("You need the materials too.")
	elif g.item in Inventory.GEAR and Inventory.has(g.item):
		say("You already have one.")
	else:
		Game.pay(int(g.gold))
		Inventory.take_all(cost)
		Inventory.add(g.item, int(g.get("n", 1)))
		say("Bought %s%s." % [Inventory.display_name(g.item), (" x%d" % int(g.n)) if int(g.get("n", 1)) > 1 else ""])
	_refresh_menu()


func _ship_selected(all: bool) -> void:
	if _ship_items.is_empty():
		return
	var item: String = _ship_items[_selected]
	var n := Inventory.count(item) if all else 1
	Inventory.take(item, n)
	Game.shipped[item] = int(Game.shipped.get(item, 0)) + n
	Game.note("shipped", n)
	_selected = mini(_selected, maxi(0, _row_count() - 1))
	_refresh_menu()


func _refresh_menu() -> void:
	_clear(menu_box)
	match _mode:
		"craft": _fill_craft()
		"inventory": _fill_inventory()
		"shop": _fill_shop()
		"ship": _fill_ship()
		"travel": _fill_travel()
		"map": _fill_map()
	menu.reset_size()
	menu.position = Vector2(roundf((480 - menu.size.x) / 2.0), maxf(4, roundf((270 - menu.size.y) / 2.0) - 8))


func _title(text: String) -> void:
	var t := _label(text, GOLD)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	menu_box.add_child(t)


func _row(selected: bool) -> Array:
	var row := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.3, 0.2, 0.12, 0.9) if selected else Color(0, 0, 0, 0)
	sb.border_color = EDGE if selected else Color(0, 0, 0, 0)
	sb.set_border_width_all(1)
	sb.set_content_margin_all(2)
	row.add_theme_stylebox_override("panel", sb)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 3)
	row.add_child(h)
	menu_box.add_child(row)
	return [row, h]


func _costs(h: HBoxContainer, cost: Dictionary) -> void:
	for k in cost:
		h.add_child(_icon(k, 12))
		var have := Inventory.count(k)
		h.add_child(_label("%d/%d" % [have, cost[k]], GOOD if have >= cost[k] else BAD))


func _fill_craft() -> void:
	var tier := _tier()
	var title: String = Inventory.STATION_NAMES[_station]
	if Inventory.STATION_UPGRADES.has(_station):
		title = "%s  (tier %d)" % [Pack.station_spec(_station, tier).name, tier]
	_title("%s     crafting LV %d" % [title.to_upper(), Inventory.level])
	var recipes := _recipes()
	for i in recipes.size():
		var r: Dictionary = recipes[i]
		var parts := _row(i == _selected)
		var row: PanelContainer = parts[0]
		var h: HBoxContainer = parts[1]
		row.mouse_filter = Control.MOUSE_FILTER_STOP
		row.gui_input.connect(_on_row_input.bind(i))
		var why := Inventory.blocker(r, tier)
		h.add_child(_icon(r.out, 16))
		var made := Inventory.yield_of(r, tier)
		var name_text: String = Inventory.display_name(r.out) + ((" x%d" % made) if made > 1 else "")
		var nl := _label(name_text, DIM if why != "" else TEXT)
		nl.custom_minimum_size = Vector2(112, 0)
		h.add_child(nl)
		if tier < int(r.get("st", 1)):
			h.add_child(_label("TIER %d STATION" % r.st, BAD))
		elif Inventory.level < int(r.get("lv", 1)):
			h.add_child(_label("LV %d" % r.lv, BAD))
		else:
			_costs(h, r.cost)
	if _can_upgrade():
		var next := tier + 1
		var parts := _row(_selected == recipes.size())
		var row: PanelContainer = parts[0]
		var h: HBoxContainer = parts[1]
		row.mouse_filter = Control.MOUSE_FILTER_STOP
		row.gui_input.connect(_on_row_input.bind(recipes.size()))
		var nl := _label("UPGRADE: " + String(Pack.station_spec(_station, next).name).to_upper(), GOLD)
		nl.custom_minimum_size = Vector2(128, 0)
		h.add_child(nl)
		_costs(h, Inventory.STATION_UPGRADES[_station][next])
	var desc := ""
	if _selected < recipes.size():
		var sel: Dictionary = recipes[_selected]
		var why := Inventory.blocker(sel, tier)
		desc = sel.desc + ("   " + why if why != "" else "")
	else:
		desc = "Rebuild this station. Better stations make more per batch and unlock new recipes."
	var d := _label(desc, DIM)
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	d.custom_minimum_size = Vector2(300, 18)
	menu_box.add_child(d)
	menu_box.add_child(_label("W/S choose    E craft    ESC close", DIM))


func _on_row_input(event: InputEvent, i: int) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if _selected == i:
			if _mode == "travel":
				_ride_selected()
			elif _mode == "shop":
				_buy_selected()
			elif _mode == "ship":
				_ship_selected(false)
			else:
				_craft_selected()
		else:
			_selected = i
			_refresh_menu()


func _fill_inventory() -> void:
	_title("PACK")
	var stats := "Crafting LV %d   XP %d / %d   Gold %dg\nDamage %d   Chop x%d   Mine x%d   Armour %d%%\nHome: %s%s" % [
		Inventory.level, Inventory.xp, Inventory.xp_for(Inventory.level + 1), Game.gold,
		Inventory.damage(), Inventory.tool_power(Inventory.AXES), Inventory.tool_power(Inventory.PICKAXES),
		int(round((1.0 - Inventory.damage_taken_factor()) * 100)),
		Inventory.CABIN_TIERS[Game.cabin_tier].name, "  (upgrade tonight)" if Game.upgrade_pending else ""]
	menu_box.add_child(_label(stats, DIM))
	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 3)
	menu_box.add_child(grid)
	for item in Inventory.items:
		var cell := HBoxContainer.new()
		cell.add_theme_constant_override("separation", 2)
		cell.custom_minimum_size = Vector2(56, 14)
		cell.add_child(_icon(item, 12))
		var l := _label("%d %s" % [Inventory.count(item), Inventory.display_name(item)])
		l.clip_text = true
		l.custom_minimum_size = Vector2(40, 0)
		cell.add_child(l)
		grid.add_child(cell)
	if Inventory.items.is_empty():
		menu_box.add_child(_label("Nothing yet.", DIM))
	menu_box.add_child(_label("C  hand crafting     I / ESC  close", DIM))


func _fill_travel() -> void:
	_title("MINECART")
	menu_box.add_child(_label("Ride the old mine railway to any stop you've found.", DIM))
	for i in _stops.size():
		var parts := _row(i == _selected)
		var row: PanelContainer = parts[0]
		var h: HBoxContainer = parts[1]
		var here: bool = _stops[i] == _here
		h.add_child(_label(Game.stations_found[_stops[i]] + ("   (you are here)" if here else ""), DIM if here else TEXT))
		row.mouse_filter = Control.MOUSE_FILTER_STOP
		row.gui_input.connect(_on_row_input.bind(i))
	menu_box.add_child(_label("Stops you haven't used yet stay off the list.", DIM))
	menu_box.add_child(_label("W/S  choose     E  ride     ESC  stay", DIM))


func _ride_selected() -> void:
	if _stops.is_empty():
		return
	var id: String = _stops[_selected]
	close_menu()
	if id != _here:
		Game.world.travel_to(id)


## The area you're in, with its places and where you are.
func _fill_map() -> void:
	var w = Game.world
	_title(String(w.data.get("name", "Home")).to_upper() if w.data else "HOME")
	var img: Image = w.map_image
	if img == null:
		menu_box.add_child(_label("You're indoors.", DIM))
		return
	var holder := Control.new()
	var scale := minf(440.0 / img.get_width(), 200.0 / img.get_height())
	var sz := Vector2(img.get_width(), img.get_height()) * scale
	holder.custom_minimum_size = sz
	var tex := TextureRect.new()
	tex.texture = ImageTexture.create_from_image(img)
	tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tex.stretch_mode = TextureRect.STRETCH_SCALE
	tex.size = sz
	holder.add_child(tex)
	var to_map := func(tile: Vector2) -> Vector2: return tile * scale
	for p in w.pois:
		var l := _label(p.name, GOLD if p.get("kind", "") == "home" else TEXT)
		l.add_theme_color_override("font_outline_color", Color(0.1, 0.07, 0.05))
		l.add_theme_constant_override("outline_size", 2)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.size = Vector2(90, 10)
		l.position = to_map.call(Vector2(p.x, p.y)) - Vector2(45, 5)
		holder.add_child(l)
	for e in w.data.get("exits", []):
		var l := _label(_area_name(e.to), DIM)
		l.add_theme_color_override("font_outline_color", Color(0.1, 0.07, 0.05))
		l.add_theme_constant_override("outline_size", 2)
		l.size = Vector2(80, 10)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var at: Vector2 = to_map.call(Vector2(e.x + e.w / 2.0, e.y + e.h / 2.0))
		l.position = Vector2(clampf(at.x - 40, 0, sz.x - 80), clampf(at.y - 5, 0, sz.y - 10))
		holder.add_child(l)
	var me := ColorRect.new()
	me.color = Color(1.0, 0.25, 0.2)
	me.size = Vector2(4, 4)
	me.position = to_map.call(Game.player.global_position / 16.0) - Vector2(2, 2)
	holder.add_child(me)
	menu_box.add_child(holder)
	menu_box.add_child(_label("Red: you.  Grey names: where each path leads.     M / ESC  close", DIM))


static func _area_name(id: String) -> String:
	return {"farm": "Your farm", "town": "Brindle", "pinewood": "The Pinewood", "oldwood": "The Oldwood", "riverlands": "Riverlands",
		"mountain": "The Mountain", "summit": "The Summit", "badlands": "Badlands", "stonegate": "Stonegate"}.get(id, id)


func _fill_shop() -> void:
	_title(Inventory.SHOPS[_shop].title)
	menu_box.add_child(_label("%s: \"%s\"" % [_shop_owner, Inventory.SHOPS[_shop].greet], DIM))
	for i in _goods.size():
		var g: Dictionary = _goods[i]
		var parts := _row(i == _selected)
		var row: PanelContainer = parts[0]
		var h: HBoxContainer = parts[1]
		row.mouse_filter = Control.MOUSE_FILTER_STOP
		row.gui_input.connect(_on_row_input.bind(i))
		if g.has("house"):
			var next := Game.cabin_tier + 1
			if next >= Inventory.CABIN_TIERS.size():
				h.add_child(_label("YOUR HOUSE: nothing left to build", DIM))
				continue
			var t: Dictionary = Inventory.CABIN_TIERS[next]
			var nl := _label("BUILD: " + String(t.name).to_upper(), GOLD)
			nl.custom_minimum_size = Vector2(118, 0)
			h.add_child(nl)
			h.add_child(_label("%dg" % int(t.gold), GOOD if Game.gold >= int(t.gold) else BAD))
			_costs(h, t.cost)
			continue
		h.add_child(_icon(g.item, 14))
		var n := int(g.get("n", 1))
		var name_l := _label(Inventory.display_name(g.item) + (" x%d" % n if n > 1 else ""))
		name_l.custom_minimum_size = Vector2(104, 0)
		h.add_child(name_l)
		h.add_child(_label("%dg" % int(g.gold), GOOD if Game.gold >= int(g.gold) else BAD))
		_costs(h, g.get("cost", {}))
	var desc := ""
	if not _goods.is_empty():
		var g: Dictionary = _goods[_selected]
		if g.has("house"):
			var next := Game.cabin_tier + 1
			desc = Inventory.CABIN_TIERS[next].desc if next < Inventory.CABIN_TIERS.size() else ""
			if Game.upgrade_pending:
				desc = "Under construction - sleep and it'll be done by morning."
		elif g.item.ends_with("_seeds"):
			var c: Dictionary = Inventory.CROPS[g.item.trim_suffix("_seeds")]
			desc = "Ripens in %d days. Sells for %dg. Grows in %s." % [int(c.days), int(c.sell), ", ".join(c.seasons.map(func(x): return Game.SEASONS[x]))]
		elif g.item.begins_with("kit_"):
			desc = "Set it up anywhere on your farm: select it in the toolbar and use it on an empty spot."
		elif g.item == "fence":
			desc = "A section of wooden fence. Put it up on your farm; an axe takes it down again."
	var d := _label(desc, DIM)
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	d.custom_minimum_size = Vector2(300, 18)
	menu_box.add_child(d)
	menu_box.add_child(_label("Gold: %dg        W/S choose    E buy    ESC leave" % Game.gold, DIM))


func _fill_ship() -> void:
	_title("SHIPPING CRATE")
	menu_box.add_child(_label("The carter collects overnight and pays at dawn.", DIM))
	_ship_items = []
	for item in Inventory.slots:
		if item != "" and Inventory.sell_price(item) > 0 and not item in Inventory.GEAR:
			_ship_items.append(item)
	_selected = mini(_selected, maxi(0, _ship_items.size() - 1))
	var shown := 0
	var first := maxi(0, _selected - 6)
	for i in range(first, mini(_ship_items.size(), first + 8)):
		var item: String = _ship_items[i]
		var parts := _row(i == _selected)
		var row: PanelContainer = parts[0]
		var h: HBoxContainer = parts[1]
		row.mouse_filter = Control.MOUSE_FILTER_STOP
		row.gui_input.connect(_on_row_input.bind(i))
		h.add_child(_icon(item, 14))
		var nl := _label("%d %s" % [Inventory.count(item), Inventory.display_name(item)])
		nl.custom_minimum_size = Vector2(150, 0)
		h.add_child(nl)
		h.add_child(_label("%dg each" % Inventory.sell_price(item), GOLD))
		shown += 1
	if shown == 0:
		menu_box.add_child(_label("Nothing to ship. Crops, forage, ore and goods all sell.", DIM))
	var total := 0
	var in_crate := []
	for item in Game.shipped:
		total += Inventory.sell_price(item) * int(Game.shipped[item])
		in_crate.append("%d %s" % [Game.shipped[item], Inventory.display_name(item)])
	var c := _label("In the crate: " + (", ".join(in_crate) if not in_crate.is_empty() else "nothing yet") + ("   (%dg)" % total if total > 0 else ""), GOOD if total > 0 else DIM)
	c.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	c.custom_minimum_size = Vector2(300, 0)
	menu_box.add_child(c)
	menu_box.add_child(_label("W/S choose    E ship one    SHIFT+E ship all    ESC close", DIM))
