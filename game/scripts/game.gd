extends Node
## Global game state: controls, the clock, and shortcuts to the player, world and HUD.

signal message(text: String)
signal hour_changed(hour: int)

const DAY_LENGTH := 480.0  # real seconds for a full day

var player: Node2D
var world: Node2D
var hud: CanvasLayer
var day := 1
var time_of_day := 0.3     # 0 = midnight, 0.5 = noon
var _last_hour := -1


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
	_bind("cancel", [KEY_ESCAPE, KEY_TAB], -1, 0.0, -1, JOY_BUTTON_B)


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
	if get_tree().paused or world == null:
		return
	time_of_day += delta / DAY_LENGTH
	if time_of_day >= 1.0:
		time_of_day -= 1.0
		day += 1
	var h := hour()
	if h != _last_hour:
		_last_hour = h
		hour_changed.emit(h)


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


## A tiny freeze on big hits sells the impact.
func hitstop(duration := 0.05) -> void:
	Engine.time_scale = 0.05
	await get_tree().create_timer(duration, true, false, true).timeout
	Engine.time_scale = 1.0


func shake(amount := 2.0) -> void:
	if player and player.has_method("shake"):
		player.shake(amount)
