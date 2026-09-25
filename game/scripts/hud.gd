class_name Hud
extends CanvasLayer
## Health, clock, gear, carried items, messages, dialog and the crafting menu.

const PANEL := Color(0.15, 0.1, 0.07, 0.92)
const EDGE := Color(0.62, 0.43, 0.24)
const TEXT := Color(0.98, 0.93, 0.82)
const DIM := Color(0.62, 0.55, 0.46)
const BAD := Color(0.95, 0.42, 0.35)
const GOOD := Color(0.6, 0.92, 0.5)

var root: Control
var hp_bar: ColorRect
var hp_label: Label
var clock: Label
var gear: HBoxContainer
var strip: HBoxContainer
var toast: Label
var hint: PanelContainer
var dialog: PanelContainer
var dialog_label: Label
var craft: PanelContainer
var craft_list: VBoxContainer
var craft_title: Label
var craft_desc: Label
var _toast_t := 0.0
var _station := ""
var _selected := 0


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
	_build_strip()
	_build_toast()
	_build_hint()
	_build_dialog()
	_build_craft()
	Inventory.changed.connect(_refresh_items)
	Game.message.connect(say)
	_refresh_items()


func _process(delta: float) -> void:
	var p := Game.player as Player
	if p:
		hp_bar.size.x = 56.0 * clampf(float(p.hp) / p.max_hp, 0.0, 1.0)
		hp_bar.color = GOOD if p.hp > 50 else (Color(0.95, 0.75, 0.3) if p.hp > 25 else BAD)
		hp_label.text = "%d" % p.hp
	clock.text = Game.clock_text() + ("  NIGHT" if Game.is_night() else "")
	if _toast_t > 0.0:
		_toast_t -= delta
		toast.modulate.a = clampf(_toast_t * 2.0, 0.0, 1.0)


func say(text: String) -> void:
	toast.text = text
	_toast_t = 3.0


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
	var back := ColorRect.new()
	back.color = Color(0.08, 0.05, 0.04)
	back.custom_minimum_size = Vector2(58, 6)
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(back)
	hp_bar = ColorRect.new()
	hp_bar.position = Vector2(1, 1)
	hp_bar.size = Vector2(56, 4)
	back.add_child(hp_bar)
	hp_label = _label("100")
	row.add_child(hp_label)
	gear = HBoxContainer.new()
	gear.add_theme_constant_override("separation", 2)
	v.add_child(gear)
	var cbox := _panel()
	root.add_child(cbox)
	cbox.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	cbox.position = Vector2(480 - 108, 4)
	cbox.custom_minimum_size = Vector2(104, 0)
	clock = _label("Day 1")
	clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cbox.add_child(clock)


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
	toast.position = Vector2(0, 222)
	toast.size = Vector2(480, 10)
	toast.add_theme_color_override("font_outline_color", Color(0.08, 0.05, 0.03))
	toast.add_theme_constant_override("outline_size", 3)
	root.add_child(toast)


func _build_hint() -> void:
	hint = _panel()
	hint.position = Vector2(4, 40)
	var l := _label("WASD  move     SHIFT  run\nJ / SPACE / CLICK  swing\nE  use / talk / harvest\nQ  eat     ESC  close", DIM)
	hint.add_child(l)
	root.add_child(hint)
	var tw := hint.create_tween()
	tw.tween_interval(16.0)
	tw.tween_property(hint, "modulate:a", 0.0, 1.5)


func _build_dialog() -> void:
	dialog = _panel(Vector2(360, 0))
	dialog.position = Vector2(60, 196)
	dialog.visible = false
	var l := _label("")
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(350, 0)
	dialog.add_child(l)
	dialog_label = l
	root.add_child(dialog)


func show_dialog(who: String, text: String) -> void:
	dialog_label.text = who.to_upper() + "\n" + text
	dialog.visible = true
	dialog.reset_size()
	dialog.position = Vector2(60, 212 - dialog.size.y)


func _build_craft() -> void:
	craft = _panel(Vector2(260, 0))
	craft.visible = false
	craft.mouse_filter = Control.MOUSE_FILTER_STOP
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 3)
	craft.add_child(v)
	craft_title = _label("", Color(1.0, 0.8, 0.45))
	craft_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(craft_title)
	craft_list = VBoxContainer.new()
	craft_list.add_theme_constant_override("separation", 2)
	v.add_child(craft_list)
	craft_desc = _label("", DIM)
	craft_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	craft_desc.custom_minimum_size = Vector2(250, 18)
	v.add_child(craft_desc)
	v.add_child(_label("W/S choose   E craft   ESC close", DIM))
	root.add_child(craft)


func open_crafting(station: String) -> void:
	_station = station
	_selected = 0
	craft.visible = true
	dialog.visible = false
	get_tree().paused = true
	_refresh_craft()


func close_crafting() -> void:
	craft.visible = false
	get_tree().paused = false


func _unhandled_input(event: InputEvent) -> void:
	if dialog.visible and (event.is_action_pressed("interact") or event.is_action_pressed("cancel") or event.is_action_pressed("attack")):
		dialog.visible = false
		get_viewport().set_input_as_handled()
		return
	if not craft.visible:
		return
	var recipes: Array = Inventory.RECIPES[_station]
	if event.is_action_pressed("cancel"):
		close_crafting()
	elif event.is_action_pressed("move_up"):
		_selected = (_selected - 1 + recipes.size()) % recipes.size()
		_refresh_craft()
	elif event.is_action_pressed("move_down"):
		_selected = (_selected + 1) % recipes.size()
		_refresh_craft()
	elif event.is_action_pressed("interact") or (event is InputEventKey and event.is_action_pressed("attack")):
		_craft_selected()
	else:
		return
	get_viewport().set_input_as_handled()


func _craft_selected() -> void:
	var recipe: Dictionary = Inventory.RECIPES[_station][_selected]
	if Inventory.craft(recipe):
		say("Made %s!" % Inventory.display_name(recipe.out))
	elif recipe.out in Inventory.GEAR and Inventory.has(recipe.out):
		say("You already have one.")
	else:
		say("Not enough materials.")
	_refresh_craft()


func _refresh_craft() -> void:
	craft_title.text = Inventory.STATION_NAMES[_station].to_upper()
	_clear(craft_list)
	var recipes: Array = Inventory.RECIPES[_station]
	for i in recipes.size():
		var r: Dictionary = recipes[i]
		var row := PanelContainer.new()
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.3, 0.2, 0.12, 0.9) if i == _selected else Color(0, 0, 0, 0)
		sb.border_color = EDGE if i == _selected else Color(0, 0, 0, 0)
		sb.set_border_width_all(1)
		sb.set_content_margin_all(2)
		row.add_theme_stylebox_override("panel", sb)
		row.mouse_filter = Control.MOUSE_FILTER_STOP
		row.gui_input.connect(_on_row_input.bind(i))
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 3)
		row.add_child(h)
		h.add_child(_icon(r.out, 16))
		var owned: bool = r.out in Inventory.GEAR and Inventory.has(r.out)
		var name_text: String = Inventory.display_name(r.out) + (" x%d" % r.n if r.has("n") else "")
		var nl := _label(name_text + (" (owned)" if owned else ""), DIM if owned else (TEXT if Inventory.can_craft(r) else DIM))
		nl.custom_minimum_size = Vector2(118, 0)
		h.add_child(nl)
		for k in r.cost:
			h.add_child(_icon("carrot" if k == "any_veg" else k, 12))
			var have := Inventory.count(k)
			h.add_child(_label("%d/%d" % [have, r.cost[k]], GOOD if have >= r.cost[k] else BAD))
		craft_list.add_child(row)
	craft_desc.text = recipes[_selected].desc
	craft.reset_size()
	craft.position = Vector2(roundf((480 - craft.size.x) / 2.0), roundf((270 - craft.size.y) / 2.0) - 10)


func _clear(box: Node) -> void:
	for c in box.get_children():
		box.remove_child(c)
		c.queue_free()


func _on_row_input(event: InputEvent, i: int) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if _selected == i:
			_craft_selected()
		else:
			_selected = i
			_refresh_craft()


func _icon(item: String, px: int) -> TextureRect:
	var t := TextureRect.new()
	t.texture = Pack.icon(item)
	t.custom_minimum_size = Vector2(px, px)
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	t.modulate = Color(0.78, 0.85, 1.0) if item == "sword_iron" else Color.WHITE
	return t


func _refresh_items() -> void:
	_clear(strip)
	_clear(gear)
	var any := false
	for item in Inventory.items:
		if item in Inventory.GEAR:
			gear.add_child(_icon(item, 12))
			continue
		any = true
		var slot := HBoxContainer.new()
		slot.add_theme_constant_override("separation", 1)
		slot.add_child(_icon(item, 14))
		slot.add_child(_label(str(Inventory.count(item))))
		strip.add_child(slot)
	if not any:
		strip.add_child(_label("Your pack is empty. Chop a tree!", DIM))
	if gear.get_child_count() == 0:
		gear.add_child(_label("Fists", DIM))
	strip.get_parent().reset_size()
	gear.get_parent().get_parent().reset_size()
