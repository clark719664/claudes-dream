extends Node
var failures: Array[String] = []
var checks := 0
func check(value: bool, description: String) -> void:
	checks += 1
	if not value:
		failures.append(description)
		print("FAIL: ", description)
func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	call_deferred("run")
func run() -> void:
	check("test_settings" in Preferences.config_path, "tests use isolated preferences")
	Preferences.reset_bindings()
	var original_events := InputMap.action_get_events("attack").size()
	check(not Preferences.rebind("attack", KEY_W).is_empty(), "movement binding conflict is rejected")
	check(Preferences.rebind("attack", KEY_K).is_empty(), "a free key can be assigned")
	check(Preferences.binding_text("attack") == "K", "binding label follows actual mapping")
	check(InputMap.action_get_events("attack").size() == original_events - 1, "mouse and controller events survive rebinding")
	Preferences.volume = 0.37
	Preferences.screen_shake = false
	Preferences.save_preferences()
	Preferences._apply_key("attack", KEY_P)
	Preferences.volume = 1.0
	Preferences.load_preferences()
	check(Preferences.binding_text("attack") == "K", "binding persists in configuration")
	check(is_equal_approx(Preferences.volume, 0.37), "audio setting persists")
	check(not Preferences.screen_shake, "shake setting persists")
	check(not Preferences.rebind("cancel", KEY_P).is_empty(), "escape remains available")
	check(not Preferences.rebind("attack", KEY_ESCAPE).is_empty(), "escape cannot be taken by gameplay")
	get_tree().paused = false
	Preferences.open_settings("controls")
	await get_tree().process_frame
	await get_tree().process_frame
	check(get_tree().paused, "opening controls pauses the world")
	check(Preferences.panel.get_rect().end.y <= 270, "controls panel fits native viewport")
	Preferences.capture_action = "attack"
	var cancel := InputEventKey.new()
	cancel.keycode = KEY_ESCAPE
	cancel.physical_keycode = KEY_ESCAPE
	cancel.pressed = true
	Preferences._input(cancel)
	check(Preferences.capture_action.is_empty(), "escape cancels key capture")
	check(Preferences.binding_text("attack") == "K", "canceled capture preserves binding")
	Preferences.close_settings()
	check(not get_tree().paused, "closing settings resumes an active game")
	get_tree().paused = true
	Preferences.open_settings()
	Preferences.close_settings()
	check(get_tree().paused, "closing settings preserves a pre-existing pause")
	get_tree().paused = false
	Game.areas = {"farm": {"crops": {"1,1": {"kind": "sativa", "age": 9}}}}
	Game.relationships = {"test": {"hearts": 9}}
	Game.cabin_tier = 3
	Game.earned = 10000
	Game.new_game()
	check(Game.areas.is_empty(), "new game clears previous world state")
	check(Game.relationships.is_empty(), "new game clears prior relationships")
	check(Game.cabin_tier == 1 and Game.earned == 0, "new game resets progression")
	Preferences.reset_bindings()
	check(Preferences.binding_text("attack") == "J / Space", "reset restores original keyboard defaults")
	check(InputMap.action_get_events("attack").size() == original_events, "reset restores every input event")
	DirAccess.remove_absolute(Preferences.config_path)
	print("SETTINGS TESTS: ", checks, " checks, ", failures.size(), " failures")
	get_tree().quit(0 if failures.is_empty() else 1)
