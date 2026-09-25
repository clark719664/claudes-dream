class_name Hud
extends CanvasLayer
## Health, level, clock, goal, carried items, messages, dialogue, the crafting menu,
## the inventory screen, Tilda's cabin plans and the fade used for doors and sleep.

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
var _mode := ""                 # "", "craft", "inventory", "upgrade"
var _station := ""
var _station_node: Node = null
var _selected := 0
var _confirm: Callable


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
	var lv := Inventory.level
	var lo := Inventory.xp_for(lv)
	var hi := Inventory.xp_for(lv + 1)
	xp_bar.size.x = 56.0 * clampf(float(Inventory.xp - lo) / maxf(hi - lo, 1), 0.0, 1.0)
	lv_label.text = "LV %d" % lv
	clock.text = Game.clock_text() + ("  NIGHT" if Game.is_night() else "")
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
	clock = _label("Day 1")
	clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(clock)
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
	strip.add_theme_constant_override("separation", 3)
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
	hint.position = Vector2(4, 52)
	hint.add_child(_label("WASD move   SHIFT run\nJ / SPACE / CLICK swing\nE use - talk - harvest\nC craft   I inventory\nQ eat   ESC close", DIM))
	root.add_child(hint)
	var tw := hint.create_tween()
	tw.tween_interval(18.0)
	tw.tween_property(hint, "modulate:a", 0.0, 1.5)


func _refresh_items() -> void:
	_clear(strip)
	_clear(gear)
	var shown := 0
	var extra := 0
	for item in Inventory.items:
		if item in Inventory.GEAR:
			gear.add_child(_icon(item, 12))
			continue
		if shown >= STRIP_MAX:
			extra += 1
			continue
		shown += 1
		var slot := HBoxContainer.new()
		slot.add_theme_constant_override("separation", 1)
		slot.add_child(_icon(item, 14))
		slot.add_child(_label(str(Inventory.count(item))))
		strip.add_child(slot)
	if shown == 0:
		strip.add_child(_label("Your pack is empty. Chop a tree!", DIM))
	elif extra > 0:
		strip.add_child(_label("+%d  (I)" % extra, DIM))
	if gear.get_child_count() == 0:
		gear.add_child(_label("Fists", DIM))
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


func open_upgrades() -> void:
	_open("upgrade", "")


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
	if event.is_action_pressed("cancel") or (_mode == "inventory" and event.is_action_pressed("inventory")) or (_mode == "craft" and _station == "hands" and event.is_action_pressed("craft")):
		close_menu()
	elif _mode == "craft" and event.is_action_pressed("move_up"):
		_selected = (_selected - 1 + _row_count()) % _row_count()
		_refresh_menu()
	elif _mode == "craft" and event.is_action_pressed("move_down"):
		_selected = (_selected + 1) % _row_count()
		_refresh_menu()
	elif event.is_action_pressed("interact") or (event is InputEventKey and event.is_action_pressed("attack")):
		if _mode == "craft":
			_craft_selected()
		elif _mode == "upgrade":
			_build_selected()
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


func _build_selected() -> void:
	if Game.upgrade_pending:
		say("Tilda is already working on it. Sleep, and it'll be done by morning.")
	elif Game.request_upgrade():
		say("Tilda: \"Leave it to me. It'll be ready when you wake up.\"")
	else:
		say("Tilda: \"Not enough materials yet.\"")
	_refresh_menu()


func _refresh_menu() -> void:
	_clear(menu_box)
	match _mode:
		"craft": _fill_craft()
		"inventory": _fill_inventory()
		"upgrade": _fill_upgrade()
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
			_craft_selected()
		else:
			_selected = i
			_refresh_menu()


func _fill_inventory() -> void:
	_title("PACK")
	var stats := "Crafting LV %d   XP %d / %d\nDamage %d   Chop x%d   Mine x%d   Armour %d%%\nHome: %s%s" % [
		Inventory.level, Inventory.xp, Inventory.xp_for(Inventory.level + 1),
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


func _fill_upgrade() -> void:
	_title("TILDA'S CABIN PLANS")
	var next := Game.cabin_tier + 1
	menu_box.add_child(_label("Your home now: %s" % Inventory.CABIN_TIERS[Game.cabin_tier].name, DIM))
	if next >= Inventory.CABIN_TIERS.size():
		menu_box.add_child(_label("\"That's the finest house in Brindle. Nothing left to build!\"", GOOD))
	else:
		var t: Dictionary = Inventory.CABIN_TIERS[next]
		var parts := _row(true)
		var h: HBoxContainer = parts[1]
		h.add_child(_label(t.name.to_upper(), GOLD))
		var d := _label(t.desc, TEXT)
		d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		d.custom_minimum_size = Vector2(290, 0)
		menu_box.add_child(d)
		var cost_row := HBoxContainer.new()
		cost_row.add_theme_constant_override("separation", 3)
		menu_box.add_child(cost_row)
		_costs(cost_row, t.cost)
		if Game.upgrade_pending:
			menu_box.add_child(_label("Under construction - sleep and it'll be done by morning.", GOOD))
		else:
			menu_box.add_child(_label("E  build     ESC  close", DIM))
