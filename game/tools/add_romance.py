with open('game/scripts/npc.gd', 'r', encoding='utf-8') as f:
    text = f.read()

# I want to find the existing interact_new I just added and upgrade it to handle 'bouquet' and 'sunforged_ring'.
interact_old = """func interact(_player: Node) -> void:
	var item = _player.selected()
	if item != "" and not item in Inventory.TOOLS and not item in Inventory.WEAPONS and not item in Inventory.AXES and not item in Inventory.PICKAXES:
		if not Game.relationships.has(actor):
			Game.relationships[actor] = {"hearts": 0, "gifted_today": false, "status": "single"}
		var rel = Game.relationships[actor]
		
		if rel.get("gifted_today", false):
			Game.hud.show_dialog(display_name, "You already gave me a gift today. But thank you!")
			return
			
		var pref = "like"
		if LOVES.has(actor) and item in LOVES[actor]: pref = "love"
		if HATES.has(actor) and item in HATES[actor]: pref = "hate"
		
		if pref == "love":
			Game.hud.show_dialog(display_name, "Oh wow, I absolutely love this! Thank you so much!")
			rel["hearts"] = min(10, rel.get("hearts", 0) + 2)
		elif pref == "hate":
			Game.hud.show_dialog(display_name, "Ew... what am I supposed to do with this?")
			rel["hearts"] = max(0, rel.get("hearts", 0) - 1)
		else:
			Game.hud.show_dialog(display_name, "Thank you, that's very kind.")
			rel["hearts"] = min(10, rel.get("hearts", 0) + 1)
			
		rel["gifted_today"] = true
		Game.relationships[actor] = rel
		Inventory.take(item) # consumes it from inventory
		_face(_player.global_position.x < global_position.x)
		return

	if shop != "":
		Game.hud.open_shop(shop, display_name)
		return
	var lines: Array = custom if not custom.is_empty() else LINES.get(lines_key, LINES.villager)
	Game.hud.show_dialog(display_name, lines[_line % lines.size()])
	_line += 1"""

interact_new = """func interact(_player: Node) -> void:
	var item = _player.selected()
	if item != "" and not item in Inventory.TOOLS and not item in Inventory.WEAPONS and not item in Inventory.AXES and not item in Inventory.PICKAXES:
		if not Game.relationships.has(actor):
			Game.relationships[actor] = {"hearts": 0, "gifted_today": false, "status": "single"}
		var rel = Game.relationships[actor]
		
		if item == "sunforged_ring":
			if rel.get("hearts", 0) == 10 and rel.get("status", "single") == "dating":
				Game.hud.show_dialog(display_name, "A Sunforged Ring... Oh my goodness! Yes, I will marry you!")
				rel["status"] = "married"
				Game.relationships[actor] = rel
				Inventory.take(item)
			else:
				Game.hud.show_dialog(display_name, "I... I don't think we're ready for this step yet.")
			_face(_player.global_position.x < global_position.x)
			return
			
		if item == "bouquet":
			if rel.get("hearts", 0) == 8 and rel.get("status", "single") == "single":
				Game.hud.show_dialog(display_name, "A bouquet? For me? I... I have feelings for you too.")
				rel["status"] = "dating"
				Game.relationships[actor] = rel
				Inventory.take(item)
			else:
				Game.hud.show_dialog(display_name, "Oh, flowers! How nice.")
				rel["hearts"] = min(8, rel.get("hearts", 0) + 1)
				Inventory.take(item)
			_face(_player.global_position.x < global_position.x)
			return
		
		if rel.get("gifted_today", false):
			Game.hud.show_dialog(display_name, "You already gave me a gift today. But thank you!")
			return
			
		var pref = "like"
		if LOVES.has(actor) and item in LOVES[actor]: pref = "love"
		if HATES.has(actor) and item in HATES[actor]: pref = "hate"
		
		var max_hearts = 10 if rel.get("status", "single") in ["dating", "married"] else 8
		
		if pref == "love":
			Game.hud.show_dialog(display_name, "Oh wow, I absolutely love this! Thank you so much!")
			rel["hearts"] = min(max_hearts, rel.get("hearts", 0) + 2)
		elif pref == "hate":
			Game.hud.show_dialog(display_name, "Ew... what am I supposed to do with this?")
			rel["hearts"] = max(0, rel.get("hearts", 0) - 1)
		else:
			Game.hud.show_dialog(display_name, "Thank you, that's very kind.")
			rel["hearts"] = min(max_hearts, rel.get("hearts", 0) + 1)
			
		rel["gifted_today"] = true
		Game.relationships[actor] = rel
		Inventory.take(item)
		_face(_player.global_position.x < global_position.x)
		return

	if shop != "":
		Game.hud.open_shop(shop, display_name)
		return
	var lines: Array = custom if not custom.is_empty() else LINES.get(lines_key, LINES.villager)
	Game.hud.show_dialog(display_name, lines[_line % lines.size()])
	_line += 1"""

text = text.replace(interact_old, interact_new)

with open('game/scripts/npc.gd', 'w', encoding='utf-8') as f:
    f.write(text)
print('Romance logic added to npc.gd!')
