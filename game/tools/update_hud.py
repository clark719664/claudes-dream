with open('game/scripts/hud.gd', 'r') as f:
    text = f.read()

text = text.replace('var dialog: PanelContainer\nvar dialog_label: Label', 'var dialog: PanelContainer\nvar dialog_hbox: HBoxContainer\nvar dialog_portrait: TextureRect\nvar dialog_label: Label')

old_build = """func _build_dialog() -> void:
	dialog = _panel(Vector2(360, 0))
	dialog.visible = false
	var l := _label("")
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(350, 0)
	dialog.add_child(l)
	dialog_label = l
	root.add_child(dialog)"""

new_build = """func _build_dialog() -> void:
	dialog = _panel(Vector2(440, 0))
	dialog.visible = false
	dialog_hbox = HBoxContainer.new()
	dialog_hbox.add_theme_constant_override("separation", 16)
	dialog.add_child(dialog_hbox)
	
	dialog_portrait = TextureRect.new()
	dialog_portrait.custom_minimum_size = Vector2(64, 64)
	dialog_portrait.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	dialog_hbox.add_child(dialog_portrait)
	
	var l := _label("")
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(340, 0)
	dialog_hbox.add_child(l)
	dialog_label = l
	root.add_child(dialog)"""

text = text.replace(old_build, new_build)

old_show = """func show_dialog(who: String, text: String) -> void:
	_confirm = Callable()
	dialog_label.text = who.to_upper() + "\\n" + text
	_show_dialog()"""

new_show = """func show_dialog(who: String, text: String) -> void:
	_confirm = Callable()
	dialog_label.text = who.to_upper() + "\\n" + text
	dialog_portrait.visible = false
	if who != "":
		var slug = who.to_lower().replace(" ", "_")
		if ResourceLoader.exists("res://assets/portraits/" + slug + ".png"):
			dialog_portrait.texture = load("res://assets/portraits/" + slug + ".png")
			dialog_portrait.visible = true
	_show_dialog()"""

text = text.replace(old_show, new_show)

old_conf = """func confirm(question: String, on_yes: Callable) -> void:
	_confirm = on_yes
	dialog_label.text = question + "\\nE  yes        ESC  no"
	_show_dialog()"""

new_conf = """func confirm(question: String, on_yes: Callable) -> void:
	_confirm = on_yes
	dialog_label.text = question + "\\nE  yes        ESC  no"
	dialog_portrait.visible = false
	_show_dialog()"""

text = text.replace(old_conf, new_conf)

with open('game/scripts/hud.gd', 'w') as f:
    f.write(text)
print('HUD updated!')
