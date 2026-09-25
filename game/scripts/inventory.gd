extends Node
## What the player carries and knows how to make.
##
## Crafting is a tree, not a list: raw materials (wood, stone, fiber, ore, coal, crystal, resin,
## herbs, meat, bones, crops) become components at the right station (sticks, twine, cloth, planks,
## iron and steel bars, nails, bricks, glass), and components become tools, gear, food and tonics.
## Recipes unlock with your crafting level; the kitchen and alchemy table only exist once your
## cabin has been upgraded.

signal changed
signal leveled(level: int)

const NAMES := {
	"wood": "Wood", "stone": "Stone", "fiber": "Fiber", "iron_ore": "Iron Ore", "coal": "Coal",
	"crystal": "Crystal", "resin": "Resin", "herb": "Wild Herb", "mushroom": "Mushroom", "bone": "Bone",
	"meat": "Raw Meat", "gem": "Gem", "ring": "Old Ring",
	"stick": "Stick", "twine": "Twine", "cloth": "Cloth", "plank": "Plank", "iron_bar": "Iron Bar",
	"steel_bar": "Steel Bar", "nails": "Nails", "brick": "Brick", "glass": "Glass Pane",
	"carrot": "Carrot", "beet": "Beet", "cabbage": "Cabbage", "lettuce": "Lettuce",
	"cauliflower": "Cauliflower", "broccoli": "Broccoli", "garlic": "Garlic",
	"sword_wood": "Wooden Sword", "sword_bone": "Bone Blade", "sword_iron": "Iron Sword", "sword_steel": "Steel Sword",
	"axe": "Stone Axe", "axe_iron": "Iron Axe", "pickaxe": "Stone Pickaxe", "pickaxe_iron": "Iron Pickaxe",
	"shield": "Buckler", "shield_iron": "Iron Shield", "lantern": "Lantern", "backpack": "Explorer's Pack",
	"poultice": "Herb Poultice", "cooked_meat": "Roast Meat", "stew": "Veggie Stew", "skewer": "Mushroom Skewer",
	"bread": "Hearth Bread", "hearty_meal": "Hearty Meal",
	"tonic_health": "Healing Tonic", "tonic_strength": "Tonic of Might", "tonic_swift": "Tonic of Haste",
}
const VEGGIES := ["carrot", "beet", "cabbage", "lettuce", "cauliflower", "broccoli", "garlic"]
const FOOD := {"hearty_meal": 90, "tonic_health": 70, "cooked_meat": 45, "bread": 40, "stew": 35, "skewer": 28, "poultice": 25,
	"mushroom": 4, "carrot": 6, "beet": 6, "cabbage": 8, "lettuce": 5, "cauliflower": 8, "broccoli": 8, "garlic": 4}
const BUFFS := {"tonic_strength": ["might", 120.0], "tonic_swift": ["haste", 120.0], "hearty_meal": ["haste", 60.0]}
const WEAPONS := {"sword_steel": 20, "sword_iron": 14, "sword_bone": 10, "sword_wood": 6}
const AXES := {"axe_iron": 5, "axe": 3}
const PICKAXES := {"pickaxe_iron": 5, "pickaxe": 3}
const FIST_DAMAGE := 3
const GEAR := ["sword_wood", "sword_bone", "sword_iron", "sword_steel", "axe", "axe_iron", "pickaxe", "pickaxe_iron", "shield", "shield_iron", "lantern", "backpack"]
const TINTS := {"sword_iron": Color(0.8, 0.86, 1.0), "sword_steel": Color(0.62, 0.95, 1.0), "axe_iron": Color(0.8, 0.86, 1.0),
	"pickaxe_iron": Color(0.8, 0.86, 1.0), "shield_iron": Color(0.8, 0.86, 1.0)}

## station -> recipes: out, n (a number, or one per station tier), cost, lv (crafting level),
## st (station tier needed), desc
const RECIPES := {
	"hands": [
		{"out": "stick", "n": 2, "cost": {"wood": 1}, "lv": 1, "desc": "Snap a log into handles and hafts."},
		{"out": "twine", "cost": {"fiber": 3}, "lv": 1, "desc": "Twist plant fiber into cord. Holds tools together."},
		{"out": "poultice", "cost": {"herb": 2, "fiber": 1}, "lv": 1, "desc": "Heals 25. Wild herbs grow by bushes."},
	],
	"workbench": [
		{"out": "sword_wood", "cost": {"plank": 2, "stick": 1}, "lv": 1, "st": 1, "desc": "6 damage. Better than fists."},
		{"out": "axe", "cost": {"stick": 1, "stone": 3, "twine": 1}, "lv": 1, "st": 1, "desc": "Chops 3x faster than bare hands."},
		{"out": "pickaxe", "cost": {"stick": 1, "stone": 4, "twine": 1}, "lv": 1, "st": 1, "desc": "Mines 3x faster. Needed for iron ore."},
		{"out": "cloth", "cost": {"twine": 3}, "lv": 2, "st": 1, "desc": "Woven twine. Bandages, sacks, curtains."},
		{"out": "shield", "cost": {"plank": 3, "twine": 2, "nails": 2}, "lv": 3, "st": 2, "desc": "Take a quarter less damage."},
		{"out": "lantern", "cost": {"iron_bar": 1, "glass": 1, "resin": 2}, "lv": 4, "st": 2, "desc": "Lights your way at night."},
		{"out": "backpack", "cost": {"cloth": 4, "twine": 4, "nails": 4, "resin": 2}, "lv": 5, "st": 3, "desc": "+30 max health. You carry yourself better."},
	],
	"sawmill": [
		{"out": "plank", "n": [1, 2, 3], "cost": {"wood": 1}, "lv": 1, "st": 1, "desc": "Boards. The chopping block splits one per log; the mills saw more."},
		{"out": "stick", "n": [3, 5, 8], "cost": {"wood": 1}, "lv": 1, "st": 1, "desc": "Clean hafts."},
	],
	"furnace": [
		{"out": "coal", "n": [1, 1, 2], "cost": {"wood": 3}, "lv": 1, "st": 1, "desc": "Char wood into fuel."},
		{"out": "iron_bar", "n": [1, 1, 2], "cost": {"iron_ore": 2, "coal": 1}, "lv": 2, "st": 1, "desc": "Smelt ore into a bar."},
		{"out": "brick", "n": [2, 2, 3], "cost": {"stone": 3, "coal": 1}, "lv": 2, "st": 2, "desc": "Fired stone blocks. Needs a proper furnace."},
		{"out": "glass", "n": [2, 2, 3], "cost": {"crystal": 1, "coal": 1}, "lv": 3, "st": 2, "desc": "Melted crystal, poured flat."},
		{"out": "steel_bar", "cost": {"iron_bar": 2, "coal": 2}, "lv": 5, "st": 3, "desc": "Iron folded with carbon. Only a foundry runs hot enough."},
	],
	"anvil": [
		{"out": "nails", "n": [4, 6, 8], "cost": {"iron_bar": 1}, "lv": 2, "st": 1, "desc": "Every good house is held together by these."},
		{"out": "sword_bone", "cost": {"bone": 3, "twine": 1}, "lv": 2, "st": 1, "desc": "10 damage. Skeletons drop bones."},
		{"out": "axe_iron", "cost": {"iron_bar": 2, "stick": 1, "twine": 1}, "lv": 3, "st": 1, "desc": "Chops 5x faster."},
		{"out": "pickaxe_iron", "cost": {"iron_bar": 3, "stick": 1, "twine": 1}, "lv": 3, "st": 2, "desc": "Mines 5x faster. Can split crystal."},
		{"out": "sword_iron", "cost": {"iron_bar": 3, "plank": 1, "cloth": 1}, "lv": 4, "st": 2, "desc": "14 damage."},
		{"out": "shield_iron", "cost": {"iron_bar": 3, "plank": 2, "nails": 4}, "lv": 5, "st": 2, "desc": "Take 40% less damage."},
		{"out": "sword_steel", "cost": {"steel_bar": 3, "cloth": 1, "gem": 1}, "lv": 6, "st": 3, "desc": "20 damage. A blade worth naming."},
	],
	"cookpot": [
		{"out": "cooked_meat", "cost": {"meat": 1, "wood": 1}, "lv": 1, "st": 1, "desc": "Heals 45."},
		{"out": "skewer", "cost": {"mushroom": 3, "stick": 1}, "lv": 1, "st": 1, "desc": "Heals 28. Mushrooms grow in the woods."},
		{"out": "stew", "cost": {"any_veg": 2, "wood": 1}, "lv": 1, "st": 2, "desc": "Heals 35. Any two vegetables."},
		{"out": "hearty_meal", "cost": {"cooked_meat": 1, "any_veg": 2, "mushroom": 2}, "lv": 3, "st": 3, "desc": "Heals 90 and quickens your step."},
	],
	"kitchen": [
		{"out": "bread", "cost": {"any_veg": 1, "herb": 1, "coal": 1}, "lv": 2, "desc": "Heals 40."},
		{"out": "stew", "n": 2, "cost": {"any_veg": 2, "wood": 1}, "lv": 1, "desc": "Heals 35. The stove makes two bowls."},
		{"out": "hearty_meal", "cost": {"cooked_meat": 1, "any_veg": 2, "mushroom": 2}, "lv": 3, "desc": "Heals 90 and quickens your step."},
	],
	"alchemy": [
		{"out": "tonic_health", "cost": {"herb": 3, "crystal": 1, "glass": 1}, "lv": 4, "desc": "Heals 70."},
		{"out": "tonic_strength", "cost": {"bone": 2, "resin": 1, "glass": 1}, "lv": 5, "desc": "Hit 50% harder for two minutes."},
		{"out": "tonic_swift", "cost": {"mushroom": 2, "herb": 2, "glass": 1}, "lv": 5, "desc": "Move 30% faster for two minutes."},
	],
}
## What it takes to raise each station to tier 2 and tier 3.
const STATION_UPGRADES := {
	"workbench": [{}, {}, {"plank": 8, "nails": 6, "twine": 4}, {"iron_bar": 4, "steel_bar": 2, "plank": 10, "nails": 10}],
	"sawmill": [{}, {}, {"plank": 6, "iron_bar": 2, "nails": 6}, {"steel_bar": 2, "iron_bar": 4, "plank": 12, "twine": 6}],
	"furnace": [{}, {}, {"stone": 24, "coal": 6, "plank": 4}, {"iron_bar": 8, "brick": 16, "nails": 10}],
	"anvil": [{}, {}, {"iron_bar": 5, "plank": 6, "nails": 8}, {"steel_bar": 3, "iron_bar": 6, "brick": 10}],
	"cookpot": [{}, {}, {"iron_bar": 2, "stick": 6, "stone": 8}, {"iron_bar": 4, "brick": 8, "plank": 6}],
}
const STATION_NAMES := {"hands": "Hand Crafting", "workbench": "Workbench", "sawmill": "Sawmill", "furnace": "Furnace", "anvil": "Anvil",
	"cookpot": "Cooking Pot", "kitchen": "Kitchen", "alchemy": "Alchemy Table"}

## Tilda's rebuilds of the cabin. Index = the tier you upgrade to.
const CABIN_TIERS := [
	{},
	{"name": "Log Shack", "style": "log", "desc": "One room, a bed and a draughty door."},
	{"name": "Timber Cabin", "style": "plank", "desc": "Bigger room, a kitchen stove and a fireplace. Unlocks kitchen recipes.",
		"cost": {"plank": 30, "nails": 18, "brick": 10, "glass": 2}},
	{"name": "Farmhouse", "style": "plaster", "desc": "Plaster walls, a green tile roof, a bath and an alchemy table. Unlocks tonics.",
		"cost": {"plank": 50, "nails": 30, "brick": 24, "glass": 8, "steel_bar": 4, "cloth": 6}},
]

var items := {}
var xp := 0
var level := 1


func count(item: String) -> int:
	if item == "any_veg":
		var n := 0
		for v in VEGGIES:
			n += items.get(v, 0)
		return n
	return items.get(item, 0)


func add(item: String, n := 1) -> void:
	items[item] = count(item) + n
	changed.emit()


func take(item: String, n := 1) -> bool:
	if count(item) < n:
		return false
	if item == "any_veg":
		var left := n
		for v in VEGGIES:
			while left > 0 and count(v) > 0:
				items[v] -= 1
				left -= 1
	else:
		items[item] -= n
	for k in items.keys():
		if items[k] <= 0:
			items.erase(k)
	changed.emit()
	return true


func has_all(cost: Dictionary) -> bool:
	for k in cost:
		if count(k) < cost[k]:
			return false
	return true


func take_all(cost: Dictionary) -> void:
	for k in cost:
		take(k, cost[k])


## How many a recipe makes at a station tier.
static func yield_of(recipe: Dictionary, tier: int) -> int:
	var n = recipe.get("n", 1)
	if n is Array:
		return int(n[clampi(tier, 1, n.size()) - 1])
	return int(n)


## "" if the recipe can be made right now, otherwise the reason it can't.
func blocker(recipe: Dictionary, station_tier := 3) -> String:
	if station_tier < int(recipe.get("st", 1)):
		return "Needs a tier %d station" % recipe.st
	if level < int(recipe.get("lv", 1)):
		return "Needs crafting level %d" % recipe.lv
	if recipe.out in GEAR and count(recipe.out) > 0:
		return "You already own one"
	if not has_all(recipe.cost):
		return "Missing materials"
	return ""


func craft(recipe: Dictionary, station_tier := 3) -> int:
	if blocker(recipe, station_tier) != "":
		return 0
	take_all(recipe.cost)
	var made := yield_of(recipe, station_tier)
	add(recipe.out, made)
	var gained := 0
	for k in recipe.cost:
		gained += int(recipe.cost[k])
	gain_xp(3 + gained)
	return made


func gain_xp(n: int) -> void:
	xp += n
	while xp >= xp_for(level + 1):
		level += 1
		leveled.emit(level)
	changed.emit()


## Total XP needed to reach a level.
static func xp_for(lv: int) -> int:
	return 20 * (lv - 1) * (lv - 1) + 10 * (lv - 1)


func weapon() -> String:
	for w in WEAPONS:
		if count(w) > 0:
			return w
	return ""


func damage() -> int:
	var w := weapon()
	return WEAPONS[w] if w != "" else FIST_DAMAGE


func best(tools: Dictionary) -> String:
	for t in tools:
		if count(t) > 0:
			return t
	return ""


func tool_power(tools: Dictionary) -> int:
	var t := best(tools)
	return tools[t] if t != "" else 1


func damage_taken_factor() -> float:
	if has("shield_iron"):
		return 0.6
	if has("shield"):
		return 0.75
	return 1.0


func has(item: String) -> bool:
	return count(item) > 0


func best_food(missing_hp: int) -> String:
	var best_item := ""
	for f in FOOD:
		if count(f) > 0 and (best_item == "" or abs(FOOD[f] - missing_hp) < abs(FOOD[best_item] - missing_hp)):
			best_item = f
	return best_item


func display_name(item: String) -> String:
	return NAMES.get(item, item.capitalize())


func tint(item: String) -> Color:
	return TINTS.get(item, Color.WHITE)


func save_data() -> Dictionary:
	return {"items": items, "xp": xp, "level": level}


func load_data(d: Dictionary) -> void:
	items = {}
	for k in d.get("items", {}):
		items[k] = int(d.items[k])
	xp = int(d.get("xp", 0))
	level = int(d.get("level", 1))
	changed.emit()
