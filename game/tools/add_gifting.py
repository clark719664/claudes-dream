with open('game/scripts/npc.gd', 'r', encoding='utf-8') as f:
    text = f.read()

# Add LOVES and HATES
add_vars = """
const LOVES := {
	"mayor_holt": ["crystal_amulet", "cake", "wine"],
	"barkeep_cass": ["ale", "mead", "stew"],
	"farmer_dell": ["pumpkin", "melon", "corn"],
	"wren": ["health_potion", "wild_mushroom", "flower"],
	"elena": ["carrot", "tomato", "salad"],
}

const HATES := {
	"mayor_holt": ["slime", "bone", "bat_wing"],
	"elena": ["stone", "wood", "coal"],
	"wren": ["meat", "cooked_meat"],
}
"""

text = text.replace('var actor: String', add_vars + '\nvar actor: String')

interact_old = """func interact(_player: Node) -> void:
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

text = text.replace(interact_old, interact_new)

with open('game/scripts/npc.gd', 'w', encoding='utf-8') as f:
    f.write(text)
print('Gifting added to npc.gd!')
