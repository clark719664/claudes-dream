with open('game/scripts/hud.gd', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('''	elif _mode in ["craft", "travel", "shop", "ship"] and event.is_action_pressed("move_up"):''',
'''	elif _mode in ["inventory", "social"] and event.is_action_pressed("move_right"):
		_mode = "social" if _mode == "inventory" else "inventory"
		_selected = 0
		_refresh_menu()
	elif _mode in ["inventory", "social"] and event.is_action_pressed("move_left"):
		_mode = "inventory" if _mode == "social" else "social"
		_selected = 0
		_refresh_menu()
	elif _mode in ["craft", "travel", "shop", "ship", "social"] and event.is_action_pressed("move_up"):''')

text = text.replace('''	elif _mode in ["craft", "travel", "shop", "ship"] and event.is_action_pressed("move_down"):''',
'''	elif _mode in ["craft", "travel", "shop", "ship", "social"] and event.is_action_pressed("move_down"):''')

text = text.replace('''	if event.is_action_pressed("cancel") or (_mode == "inventory" and event.is_action_pressed("inventory"))''',
'''	if event.is_action_pressed("cancel") or (_mode in ["inventory", "social"] and event.is_action_pressed("inventory"))''')

text = text.replace('''		"inventory": _fill_inventory()''', '''		"inventory": _fill_inventory()
		"social": _fill_social()''')

text = text.replace('''func _fill_inventory() -> void:
	_title("PACK")''', '''func _fill_inventory() -> void:
	_title("PACK  < >  SOCIAL")''')

social_func = '''
func _fill_social() -> void:
	_title("PACK  < >  SOCIAL")
	
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 6)
	menu_box.add_child(grid)
	
	var npcs = Game.relationships.keys()
	npcs.sort()
	
	for i in range(npcs.size()):
		var npc = npcs[i]
		var rel = Game.relationships[npc]
		var row_array = _row(_selected == i)
		var cell = row_array[0]
		var h = row_array[1]
		cell.custom_minimum_size = Vector2(130, 32)
		
		var p = TextureRect.new()
		p.custom_minimum_size = Vector2(24, 24)
		p.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		var slug = npc.to_lower().replace(" ", "_")
		if ResourceLoader.exists("res://assets/portraits/" + slug + ".png"):
			p.texture = load("res://assets/portraits/" + slug + ".png")
		h.add_child(p)
		
		var vbox = VBoxContainer.new()
		var lname = _label(npc.capitalize())
		vbox.add_child(lname)
		
		var hearts = ""
		for hj in range(10):
			hearts += "♥" if hj < rel.get("hearts", 0) else "♡"
		var lhearts = _label(hearts, GOOD if rel.get("hearts", 0) == 10 else BAD)
		vbox.add_child(lhearts)
		
		h.add_child(vbox)
		grid.add_child(cell)

func _row_count() -> int:'''

text = text.replace('func _row_count() -> int:', social_func)
text = text.replace('	if _mode == "shop": return _goods.size()', '	if _mode == "social": return Game.relationships.keys().size()\n	if _mode == "shop": return _goods.size()')

with open('game/scripts/hud.gd', 'w', encoding='utf-8') as f:
    f.write(text)
print('Social tab injected into hud.gd!')
