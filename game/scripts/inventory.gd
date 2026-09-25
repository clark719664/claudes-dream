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
	"hoe": "Hoe", "watering_can": "Watering Can", "scythe": "Scythe", "fence": "Wood Fence",
	"kit_workbench": "Workbench Kit", "kit_sawmill": "Sawmill Kit", "kit_furnace": "Furnace Kit", "kit_anvil": "Anvil Kit",
	"kit_cookpot": "Cooking Pot Kit",
	"sword_copper": "Copper Sword", "sword_mythril": "Mythril Sword", "sword_obsidian": "Obsidian Blade", "sword_sunforged": "Sunforged Sword",
	"axe_mythril": "Mythril Axe", "pickaxe_mythril": "Mythril Pickaxe", "bow_hunter": "Hunter's Bow", "staff_spore": "Spore Staff",
	"shield_sunforged": "Sunforged Shield", "helm_iron": "Iron Helm", "chest_iron": "Iron Breastplate", "chest_mythril": "Mythril Breastplate",
}
const VEGGIES := ["carrot", "beet", "cabbage", "lettuce", "cauliflower", "broccoli", "garlic"]
const FOOD := {"hearty_meal": 90, "tonic_health": 70, "cooked_meat": 45, "bread": 40, "stew": 35, "skewer": 28, "poultice": 25,
	"mushroom": 4, "carrot": 6, "beet": 6, "cabbage": 8, "lettuce": 5, "cauliflower": 8, "broccoli": 8, "garlic": 4}
const BUFFS := {"tonic_strength": ["might", 120.0], "tonic_swift": ["haste", 120.0], "hearty_meal": ["haste", 60.0]}
## best first: the one you swing is the best you carry (or the one selected in the toolbar)
const WEAPONS := {"sword_sunforged": 32, "sword_obsidian": 27, "sword_mythril": 23, "sword_steel": 20, "sword_iron": 14,
	"sword_bone": 10, "sword_copper": 9, "sword_wood": 6}
## ranged: what each fires and how hard it hits
const RANGED := {"bow_hunter": {"dmg": 11, "shot": "arrow", "cost": 0}, "staff_spore": {"dmg": 16, "shot": "spore", "cost": 4}}
const AXES := {"axe_mythril": 8, "axe_iron": 5, "axe": 3}
const PICKAXES := {"pickaxe_mythril": 8, "pickaxe_iron": 5, "pickaxe": 3}
## armour: one piece per slot counts, the best you carry; the factor is what gets through
const ARMOUR := {"shield": {"shield_sunforged": 0.55, "shield_iron": 0.7, "shield": 0.82},
	"helm": {"helm_iron": 0.88}, "body": {"chest_mythril": 0.72, "chest_iron": 0.85}}
## the watering can, as the smith improves it: capacity, the cells one pour covers, its colour
const CANS := [
	{"name": "Watering Can", "size": 40, "reach": 1, "tint": Color(1, 1, 1)},
	{"name": "Copper Watering Can", "size": 55, "reach": 3, "tint": Color(1.0, 0.66, 0.42)},
	{"name": "Iron Watering Can", "size": 70, "reach": 5, "tint": Color(0.78, 0.86, 1.0)},
	{"name": "Gold Watering Can", "size": 100, "reach": 9, "tint": Color(1.0, 0.85, 0.3)},
]
const FIST_DAMAGE := 3
const GEAR := ["sword_wood", "sword_bone", "sword_iron", "sword_steel", "axe", "axe_iron", "pickaxe", "pickaxe_iron", "shield", "shield_iron", "lantern", "backpack",
	"hoe", "watering_can", "scythe", "sword_copper", "sword_mythril", "sword_obsidian", "sword_sunforged", "axe_mythril", "pickaxe_mythril",
	"bow_hunter", "staff_spore", "shield_sunforged", "helm_iron", "chest_iron", "chest_mythril"]
## Things you hold and use: everything else in the toolbar is material, food or something to place.
const TOOLS := ["sword_wood", "sword_bone", "sword_iron", "sword_steel", "axe", "axe_iron", "pickaxe", "pickaxe_iron", "hoe", "watering_can", "scythe",
	"sword_copper", "sword_mythril", "sword_obsidian", "sword_sunforged", "axe_mythril", "pickaxe_mythril", "bow_hunter", "staff_spore"]
const STARTER := {"axe": 1, "pickaxe": 1, "hoe": 1, "watering_can": 1, "scythe": 1, "sword_wood": 1, "carrot_seeds": 15}
const START_GOLD := 500
const CAN_SIZE := 40

## Crops: the seasons they grow in (0 spring, 1 summer, 2 fall, 3 winter), days to ripen, what
## the seeds cost and what the crop sells for.
const CROPS := {
	"carrot": {"seasons": [0], "days": 4, "seed": 20, "sell": 35},
	"lettuce": {"seasons": [0], "days": 5, "seed": 30, "sell": 55},
	"garlic": {"seasons": [0, 2], "days": 5, "seed": 35, "sell": 65},
	"cauliflower": {"seasons": [0], "days": 9, "seed": 80, "sell": 180},
	"beet": {"seasons": [1, 2], "days": 6, "seed": 40, "sell": 90},
	"broccoli": {"seasons": [1], "days": 7, "seed": 60, "sell": 135},
	"cabbage": {"seasons": [2], "days": 8, "seed": 70, "sell": 165},
}
## What the shipping crate pays. Anything missing can't be shipped.
const PRICES := {
	"wood": 2, "stone": 2, "fiber": 1, "iron_ore": 10, "coal": 15, "crystal": 50, "resin": 8, "herb": 14,
	"mushroom": 20, "bone": 6, "meat": 18, "gem": 140, "ring": 220, "stick": 1, "twine": 4, "cloth": 22,
	"plank": 6, "iron_bar": 60, "steel_bar": 190, "nails": 8, "brick": 12, "glass": 40,
	"cooked_meat": 55, "stew": 75, "skewer": 60, "bread": 70, "hearty_meal": 200, "poultice": 30,
	"tonic_health": 150, "tonic_strength": 160, "tonic_swift": 160,
}
## Shops. goods: item, gold, optional material cost and how many you get.
const SHOPS := {
	"general": {"title": "GENERAL STORE", "greet": "Seeds for the season, bread for the road.", "goods": [
		{"item": "bread", "gold": 110}, {"item": "poultice", "gold": 70}, {"item": "cloth", "gold": 60},
	]},
	"carpenter": {"title": "TILDA'S CARPENTRY", "greet": "Kits for the farm, fences, and your house when you're ready.", "goods": [
		{"item": "kit_workbench", "gold": 350, "cost": {"wood": 20}},
		{"item": "kit_cookpot", "gold": 700, "cost": {"stone": 20}},
		{"item": "kit_sawmill", "gold": 1200, "cost": {"wood": 40, "stone": 10}},
		{"item": "kit_furnace", "gold": 1500, "cost": {"stone": 40}},
		{"item": "kit_anvil", "gold": 2500, "cost": {"iron_bar": 4}},
		{"item": "fence", "gold": 8, "n": 1},
		{"item": "fence", "gold": 70, "n": 10},
		{"house": true},
	]},
	"smith": {"title": "BROM'S SMITHY", "greet": "Coal, ore, better tools and a stronger can, if you bring me bars.", "goods": [
		{"item": "coal", "gold": 30}, {"item": "iron_ore", "gold": 55},
		{"can": 1, "gold": 600, "cost": {"stone": 20, "coal": 5}},
		{"can": 2, "gold": 1500, "cost": {"iron_bar": 5}},
		{"can": 3, "gold": 4000, "cost": {"steel_bar": 3, "gem": 1}},
		{"item": "sword_copper", "gold": 350},
		{"item": "helm_iron", "gold": 900, "cost": {"iron_bar": 3}},
		{"item": "chest_iron", "gold": 1400, "cost": {"iron_bar": 5}},
		{"item": "axe_iron", "gold": 1500, "cost": {"iron_bar": 5}},
		{"item": "pickaxe_iron", "gold": 1500, "cost": {"iron_bar": 5}},
		{"item": "sword_iron", "gold": 1200, "cost": {"iron_bar": 3}},
	]},
}
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
		{"out": "bow_hunter", "cost": {"plank": 3, "twine": 4}, "lv": 2, "st": 1, "desc": "Shoots arrows: 11 damage from a distance."},
		{"out": "staff_spore", "cost": {"stick": 2, "mushroom": 8, "crystal": 2}, "lv": 4, "st": 2, "desc": "Throws spore bolts: 16 damage, costs a little energy."},
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
		{"out": "sword_mythril", "cost": {"steel_bar": 2, "crystal": 3}, "lv": 6, "st": 3, "desc": "23 damage. Steel folded with crystal, light as a feather."},
		{"out": "axe_mythril", "cost": {"steel_bar": 2, "crystal": 2, "plank": 1}, "lv": 6, "st": 3, "desc": "Chops 8x faster."},
		{"out": "pickaxe_mythril", "cost": {"steel_bar": 2, "crystal": 2, "plank": 1}, "lv": 6, "st": 3, "desc": "Mines 8x faster."},
		{"out": "chest_mythril", "cost": {"steel_bar": 5, "crystal": 4, "cloth": 2}, "lv": 7, "st": 3, "desc": "Take 28% less damage."},
		{"out": "sword_obsidian", "cost": {"steel_bar": 3, "gem": 2, "coal": 10}, "lv": 7, "st": 3, "desc": "27 damage. Forged hot enough to glass the coal."},
		{"out": "shield_sunforged", "cost": {"steel_bar": 3, "gem": 2, "glass": 1}, "lv": 8, "st": 3, "desc": "Take 45% less damage."},
		{"out": "sword_sunforged", "cost": {"steel_bar": 4, "gem": 3, "glass": 2}, "lv": 8, "st": 3, "desc": "32 damage. It hums in the dark."},
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
	"workbench": [
		{"out": "bow_hunter", "cost": {"plank": 3, "twine": 4}, "lv": 2, "st": 1, "desc": "Shoots arrows: 11 damage from a distance."},
		{"out": "staff_spore", "cost": {"stick": 2, "mushroom": 8, "crystal": 2}, "lv": 4, "st": 2, "desc": "Throws spore bolts: 16 damage, costs a little energy."},{}, {}, {"plank": 8, "nails": 6, "twine": 4}, {"iron_bar": 4, "steel_bar": 2, "plank": 10, "nails": 10}],
	"sawmill": [{}, {}, {"plank": 6, "iron_bar": 2, "nails": 6}, {"steel_bar": 2, "iron_bar": 4, "plank": 12, "twine": 6}],
	"furnace": [{}, {}, {"stone": 24, "coal": 6, "plank": 4}, {"iron_bar": 8, "brick": 16, "nails": 10}],
	"anvil": [{}, {}, {"iron_bar": 5, "plank": 6, "nails": 8}, {"steel_bar": 3, "iron_bar": 6, "brick": 10}],
	"cookpot": [{}, {}, {"iron_bar": 2, "stick": 6, "stone": 8}, {"iron_bar": 4, "brick": 8, "plank": 6}],
}
const STATION_NAMES := {"hands": "Hand Crafting", "workbench": "Workbench", "sawmill": "Sawmill", "furnace": "Furnace", "anvil": "Anvil",
	"cookpot": "Cooking Pot", "kitchen": "Kitchen", "alchemy": "Alchemy Table"}

## Tilda's rebuilds of your house. Index = the tier you upgrade to.
const CABIN_TIERS := [
	{},
	{"name": "Log Cabin", "style": "log", "desc": "One room, a bed, a table and a draughty door."},
	{"name": "Timber Cabin", "style": "plank", "desc": "A bigger room with a kitchen stove and a fireplace. Unlocks kitchen recipes.",
		"gold": 3000, "cost": {"wood": 150, "stone": 50}},
	{"name": "Farmhouse", "style": "plaster", "desc": "Plaster walls, a green tile roof, a bath and an alchemy table. Unlocks tonics.",
		"gold": 10000, "cost": {"plank": 60, "brick": 30, "iron_bar": 10}},
]

var items := {}
var slots: Array = []     # item names in the order they were picked up: the first ten are the toolbar
var xp := 0
var level := 1
var water := CAN_SIZE     # left in the watering can (up to can().size)


func count(item: String) -> int:
	if item == "any_veg":
		var n := 0
		for v in VEGGIES:
			n += items.get(v, 0)
		return n
	return items.get(item, 0)


func add(item: String, n := 1) -> void:
	items[item] = count(item) + n
	if not item in slots:
		var gap := slots.find("")
		if gap >= 0:
			slots[gap] = item
		else:
			slots.append(item)
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
			var i := slots.find(k)
			if i >= 0:
				# keep the toolbar steady: leave a hole instead of shifting everything left
				if i < 10:
					slots[i] = ""
				else:
					slots.remove_at(i)
	_trim_slots()
	changed.emit()
	return true


func _trim_slots() -> void:
	for i in range(slots.size() - 1, 9, -1):
		if slots[i] == "":
			slots.remove_at(i)


## The item in toolbar slot i ("" if empty).
func slot(i: int) -> String:
	return slots[i] if i < slots.size() else ""


func is_seed(item: String) -> bool:
	return item.ends_with("_seeds")


func sell_price(item: String) -> int:
	if CROPS.has(item):
		return int(CROPS[item].sell)
	return int(PRICES.get(item, 0))


## Everything a shop has today (the general store's seeds change with the season).
func shop_goods(shop: String, season: int) -> Array:
	var goods: Array = []
	if shop == "general":
		for c in CROPS:
			if season in CROPS[c].seasons:
				goods.append({"item": c + "_seeds", "gold": int(CROPS[c].seed)})
	goods.append_array(SHOPS[shop].goods)
	return goods


func energy_of(food: String) -> int:
	return int(FOOD.get(food, 0) * 2)


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
	var f := 1.0
	for slot in ARMOUR:
		var best := 1.0
		for item in ARMOUR[slot]:
			if has(item):
				best = minf(best, float(ARMOUR[slot][item]))
		f *= best
	return f


## Watering can: how much it holds and how far one pour reaches, at the tier the smith made it.
func can() -> Dictionary:
	return CANS[clampi(Game.can_tier, 0, CANS.size() - 1)]


func has(item: String) -> bool:
	return count(item) > 0


func best_food(missing_hp: int) -> String:
	var best_item := ""
	for f in FOOD:
		if count(f) > 0 and (best_item == "" or abs(FOOD[f] - missing_hp) < abs(FOOD[best_item] - missing_hp)):
			best_item = f
	return best_item


func display_name(item: String) -> String:
	if item == "watering_can":
		return can().name
	return NAMES.get(item, item.capitalize())


func tint(item: String) -> Color:
	if item == "watering_can":
		return can().tint
	return TINTS.get(item, Color.WHITE)


func save_data() -> Dictionary:
	return {"items": items, "slots": slots, "xp": xp, "level": level, "water": water}


func load_data(d: Dictionary) -> void:
	items = {}
	for k in d.get("items", {}):
		items[k] = int(d.items[k])
	slots = d.get("slots", items.keys())
	for k in items:
		if not k in slots:
			slots.append(k)
	xp = int(d.get("xp", 0))
	level = int(d.get("level", 1))
	water = int(d.get("water", CAN_SIZE))
	changed.emit()


func start_new() -> void:
	items = {}
	slots = []
	xp = 0
	level = 1
	water = CAN_SIZE
	for k in STARTER:
		add(k, STARTER[k])
