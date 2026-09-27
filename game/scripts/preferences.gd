extends Node
## Persistent player preferences are kept separately from the farm save.
signal changed
const CONFIG_PATH := "user://hearthwild_settings.cfg"
const ACTIONS := {
	"move_up": "Walk north", "move_down": "Walk south", "move_left": "Walk west", "move_right": "Walk east",
	"attack": "Use tool / attack", "interact": "Talk / harvest / open", "sprint": "Run", "eat": "Eat selected food",
	"inventory": "Backpack", "craft": "Crafting", "map": "Map", "cancel": "Back / game menu",
	"slot_prev": "Previous tool", "slot_next": "Next tool",
	"slot_0": "Tool 1", "slot_1": "Tool 2", "slot_2": "Tool 3", "slot_3": "Tool 4", "slot_4": "Tool 5",
	"slot_5": "Tool 6", "slot_6": "Tool 7", "slot_7": "Tool 8", "slot_8": "Tool 9", "slot_9": "Tool 10"
}
var new_game_requested := false
var fullscreen := false
var window_scale := 3
var volume := 0.8
var screen_shake := true
var defaults: Dictionary = {}
var bindings: Dictionary = {}
var overlay: CanvasLayer
var panel: PanelContainer
var content: VBoxContainer
var status: Label
var active_tab := "settings"
var capture_action := ""
var prior_pause := false
var prior_focus: WeakRef
var config_path := CONFIG_PATH

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if "--test-mode" in OS.get_cmdline_user_args():
		config_path = "user://hearthwild_test_settings.cfg"
	for action in ACTIONS:
		defaults[action] = InputMap.action_get_events(action).duplicate()
	load_preferences()

func load_preferences() -> void:
	var config := ConfigFile.new()
	if config.load(config_path) == OK:
		fullscreen = bool(config.get_value("video", "fullscreen", false))
		window_scale = clampi(int(config.get_value("video", "scale", 3)), 2, 4)
		volume = clampf(float(config.get_value("audio", "volume", 0.8)), 0, 1)
		screen_shake = bool(config.get_value("game", "screen_shake", true))
		var saved = config.get_value("controls", "bindings", {})
		if saved is Dictionary:
			for action in saved:
				if ACTIONS.has(action) and action != "cancel" and int(saved[action]) > 0:
					_apply_key(action, int(saved[action]))
	apply_display()

func apply_display() -> void:
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(volume, 0.0001)))
	AudioServer.set_bus_mute(0, volume <= 0)
	if DisplayServer.get_name() != "headless":
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if fullscreen else DisplayServer.WINDOW_MODE_WINDOWED)
		if not fullscreen:
			DisplayServer.window_set_size(Vector2i(480, 270) * window_scale)

func save_preferences() -> void:
	var config := ConfigFile.new()
	config.set_value("video", "fullscreen", fullscreen)
	config.set_value("video", "scale", window_scale)
	config.set_value("audio", "volume", volume)
	config.set_value("game", "screen_shake", screen_shake)
	config.set_value("controls", "bindings", bindings)
	if config.save(config_path) != OK and is_instance_valid(status):
		status.text = "Settings could not be saved. Check available disk space."
	changed.emit()

func _apply_key(action: String, code: int) -> void:
	for event in InputMap.action_get_events(action):
		if event is InputEventKey:
			InputMap.action_erase_event(action, event)
	var key := InputEventKey.new()
	key.physical_keycode = code
	InputMap.action_add_event(action, key)
	bindings[action] = code

func rebind(action: String, code: int) -> String:
	if not ACTIONS.has(action) or action == "cancel" or code == KEY_ESCAPE or code <= 0:
		return "Escape stays available for Back and canceling changes."
	for other in ACTIONS:
		if other == action:
			continue
		for event in InputMap.action_get_events(other):
			if event is InputEventKey and (event.physical_keycode == code or event.keycode == code):
				return "%s is already used for %s." % [OS.get_keycode_string(code), ACTIONS[other]]
	_apply_key(action, code)
	save_preferences()
	return ""

func reset_bindings() -> void:
	for action in defaults:
		InputMap.action_erase_events(action)
		for event in defaults[action]:
			InputMap.action_add_event(action, event)
	bindings.clear()
	save_preferences()

func binding_text(action: String) -> String:
	var names: Array[String] = []
	for event in InputMap.action_get_events(action):
		if event is InputEventKey:
			names.append(OS.get_keycode_string(event.physical_keycode if event.physical_keycode else event.keycode))
	return " / ".join(names) if not names.is_empty() else "Not assigned"

func _input(event: InputEvent) -> void:
	if capture_action.is_empty():
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE or event.physical_keycode == KEY_ESCAPE:
			capture_action = ""
			status.text = "Rebinding canceled."
		else:
			var result := rebind(capture_action, event.physical_keycode if event.physical_keycode else event.keycode)
			if result.is_empty():
				capture_action = ""
				_fill()
				status.text = "Binding saved."
			else:
				status.text = result
	get_viewport().set_input_as_handled()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("cancel"):
		if is_instance_valid(overlay):
			close_settings()
		elif is_instance_valid(Game.world) and is_instance_valid(Game.hud) and not Game.hud.dialog.visible and Game.hud._mode.is_empty():
			open_settings()
		else:
			return
		get_viewport().set_input_as_handled()

func open_settings(tab := "settings") -> void:
	active_tab = tab
	if is_instance_valid(overlay):
		_fill()
		return
	prior_pause = get_tree().paused
	var focused := get_viewport().gui_get_focus_owner()
	prior_focus = weakref(focused) if focused else null
	get_tree().paused = true
	overlay = CanvasLayer.new()
	overlay.layer = 100
	overlay.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(overlay)
	var shade := ColorRect.new()
	shade.color = Color(0.06, 0.10, 0.08, 0.78)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(shade)
	panel = PanelContainer.new()
	panel.position = Vector2(34, 16)
	panel.size = Vector2(412, 229)
	panel.theme = _theme()
	panel.add_theme_stylebox_override("panel", _style())
	overlay.add_child(panel)
	content = VBoxContainer.new()
	content.add_theme_constant_override("separation", 5)
	panel.add_child(content)
	_fill()

func close_settings() -> void:
	capture_action = ""
	if is_instance_valid(overlay):
		overlay.queue_free()
		overlay = null
	get_tree().paused = prior_pause
	if prior_focus and is_instance_valid(prior_focus.get_ref()):
		prior_focus.get_ref().grab_focus()

func _button(text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size.y = 20
	button.pressed.connect(callback)
	return button

func _label(text: String) -> Label:
	var label := Label.new()
	label.text = text
	return label

func _fill() -> void:
	for child in content.get_children():
		content.remove_child(child)
		child.queue_free()
	var tabs := HBoxContainer.new()
	content.add_child(tabs)
	for tab in ["settings", "controls"]:
		var button := _button(tab.capitalize(), func(): active_tab = tab; capture_action = ""; _fill())
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.disabled = active_tab == tab
		tabs.add_child(button)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(384, 125)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	content.add_child(scroll)
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 5)
	scroll.add_child(body)
	if active_tab == "controls":
		var intro := _label("Select a key to change it. Escape cancels capture.")
		body.add_child(intro)
		for action in ACTIONS:
			var row := HBoxContainer.new()
			body.add_child(row)
			var title := _label(ACTIONS[action])
			title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(title)
			var key := _button(binding_text(action), func(): capture_action = action; status.text = "Press a key for %s. Escape cancels." % ACTIONS[action])
			key.custom_minimum_size.x = 133
			key.disabled = action == "cancel"
			row.add_child(key)
		body.add_child(_label("Mouse: left = tool, right = interact, wheel = tools."))
		body.add_child(_label("Controller: stick = move; A = interact; X = tool; Y = eat."))
		body.add_child(_label("LB = craft; RB = run; Back = pack; Start = map; B = back."))
		body.add_child(_button("Restore default controls", func(): reset_bindings(); _fill(); status.text = "Default controls restored."))
	else:
		var fullscreen_box := CheckButton.new()
		fullscreen_box.text = "Fullscreen"
		fullscreen_box.button_pressed = fullscreen
		fullscreen_box.toggled.connect(func(value): fullscreen = value; apply_display(); save_preferences())
		body.add_child(fullscreen_box)
		var row := HBoxContainer.new()
		body.add_child(row)
		row.add_child(_label("Window size"))
		var scale_choice := OptionButton.new()
		for factor in [2, 3, 4]:
			scale_choice.add_item("%dx  (%d x %d)" % [factor, 480 * factor, 270 * factor])
		scale_choice.select(window_scale - 2)
		scale_choice.item_selected.connect(func(index): window_scale = index + 2; apply_display(); save_preferences())
		row.add_child(scale_choice)
		var audio_row := HBoxContainer.new()
		body.add_child(audio_row)
		audio_row.add_child(_label("Master volume"))
		var slider := HSlider.new()
		slider.min_value = 0
		slider.max_value = 100
		slider.value = volume * 100
		slider.step = 1
		slider.custom_minimum_size.x = 145
		audio_row.add_child(slider)
		var percent := _label("%d%%" % roundi(volume * 100))
		audio_row.add_child(percent)
		slider.value_changed.connect(func(value): volume = value / 100.0; percent.text = "%d%%" % value; apply_display(); save_preferences())
		var shake_box := CheckButton.new()
		shake_box.text = "Screen shake"
		shake_box.button_pressed = screen_shake
		shake_box.toggled.connect(func(value): screen_shake = value; save_preferences())
		body.add_child(shake_box)
		body.add_child(_label("Pixel art: Anokolisa / Pixel Crawler"))
	status = _label("Changes save automatically. Your farm save is separate.")
	status.custom_minimum_size = Vector2(384, 24)
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	content.add_child(status)
	var done := _button("Return to game" if is_instance_valid(Game.world) else "Back to title", close_settings)
	content.add_child(done)
	done.grab_focus.call_deferred()

func _theme() -> Theme:
	if ResourceLoader.exists("res://scripts/ui_theme.gd"):
		return load("res://scripts/ui_theme.gd").make_theme()
	var theme := Theme.new()
	theme.default_font = Pack.font
	theme.default_font_size = 8
	return theme

func _style() -> StyleBoxFlat:
	if ResourceLoader.exists("res://scripts/ui_theme.gd"):
		return load("res://scripts/ui_theme.gd").panel_style()
	var style := StyleBoxFlat.new()
	style.bg_color = Color("30271e")
	style.border_color = Color("b68d52")
	style.set_border_width_all(2)
	style.set_content_margin_all(10)
	return style
