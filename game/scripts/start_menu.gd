extends Control
## A quiet valley framing the title; all foliage uses the game's own sprites.
var menu_box: VBoxContainer
var confirmation: PanelContainer

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if "--demo" in OS.get_cmdline_user_args():
		get_tree().change_scene_to_file.call_deferred("res://scenes/main.tscn")
		return
	Game.world = null
	Game.player = null
	Game.hud = null
	theme = Preferences._theme()
	_build_scenery()
	var title := Label.new()
	title.text = "Hearthwild"
	title.position = Vector2(0, 20)
	title.size.x = 480
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 28)
	title.add_theme_color_override("font_color", Color("f6dfa1"))
	title.add_theme_color_override("font_outline_color", Color("344333"))
	title.add_theme_constant_override("outline_size", 5)
	add_child(title)
	var subtitle := Label.new()
	subtitle.text = "A little land. A life of your own."
	subtitle.position = Vector2(0, 59)
	subtitle.size.x = 480
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.modulate = Color("f7edcd")
	add_child(subtitle)
	var panel := PanelContainer.new()
	panel.position = Vector2(160, 85)
	panel.custom_minimum_size = Vector2(160, 140)
	panel.add_theme_stylebox_override("panel", Preferences._style())
	add_child(panel)
	menu_box = VBoxContainer.new()
	menu_box.add_theme_constant_override("separation", 4)
	panel.add_child(menu_box)
	var continuing := _button("Continue", func(): _start(false))
	continuing.disabled = not _has_save()
	menu_box.add_child(continuing)
	var fresh := _button("New farm", _ask_new)
	menu_box.add_child(fresh)
	menu_box.add_child(_button("Settings", func(): Preferences.open_settings()))
	menu_box.add_child(_button("Controls", func(): Preferences.open_settings("controls")))
	menu_box.add_child(_button("Quit", func(): get_tree().quit()))
	if continuing.disabled:
		fresh.grab_focus()
	else:
		continuing.grab_focus()
	var credit := Label.new()
	credit.text = "Pixel Crawler art by Anokolisa"
	credit.position = Vector2(0, 254)
	credit.size.x = 480
	credit.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	credit.modulate = Color("e4dcad")
	credit.add_theme_color_override("font_outline_color", Color("293c30"))
	credit.add_theme_constant_override("outline_size", 2)
	add_child(credit)

func _has_save() -> bool:
	if not FileAccess.file_exists(Game.SAVE_PATH):
		return false
	var data = JSON.parse_string(FileAccess.get_file_as_string(Game.SAVE_PATH))
	return data is Dictionary and int(data.get("version", 0)) >= 5

func _button(text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(140, 20)
	button.pressed.connect(callback)
	return button

func _ask_new() -> void:
	if not _has_save():
		_start(true)
		return
	if is_instance_valid(confirmation):
		return
	confirmation = PanelContainer.new()
	confirmation.position = Vector2(90, 91)
	confirmation.size = Vector2(300, 120)
	confirmation.add_theme_stylebox_override("panel", Preferences._style())
	add_child(confirmation)
	for child in menu_box.get_children():
		child.disabled = true
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	confirmation.add_child(box)
	var text := Label.new()
	text.text = "Start a new farm?\nYour previous farm will be replaced when this one is saved."
	text.custom_minimum_size.x = 275
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(text)
	box.add_child(_button("Start new farm", func(): _start(true)))
	var cancel := _button("Keep my farm", _dismiss_confirmation)
	box.add_child(cancel)
	cancel.grab_focus()

func _dismiss_confirmation() -> void:
	if is_instance_valid(confirmation):
		confirmation.queue_free()
		confirmation = null
	for child in menu_box.get_children():
		child.disabled = false
	menu_box.get_child(1).grab_focus()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("cancel") and is_instance_valid(confirmation):
		_dismiss_confirmation()
		get_viewport().set_input_as_handled()

func _start(fresh: bool) -> void:
	Preferences.new_game_requested = fresh
	get_tree().paused = false
	get_tree().change_scene_to_file("res://scenes/main.tscn")

func _build_scenery() -> void:
	var backdrop := Node2D.new()
	backdrop.set_script(load("res://scripts/title_landscape.gd"))
	add_child(backdrop)
	for entry in [["oak", 29, 245, 0.85], ["oak_big", 464, 253, 0.90], ["oak", 99, 228, 0.55], ["oak", 387, 230, 0.55], ["bush", 73, 252, 1.0], ["bush", 406, 254, 1.0]]:
		if Pack.has_sprite(entry[0]):
			var sprite := Pack.sprite(entry[0])
			sprite.position = Vector2(entry[1], entry[2])
			sprite.scale = Vector2.ONE * entry[3]
			add_child(sprite)
	for i in 20:
		var flower := Pack.sprite("flower_white" if i % 3 else "flower_yellow")
		flower.position = Vector2(17 + i * 23, 241 + (i * 7) % 15)
		add_child(flower)
