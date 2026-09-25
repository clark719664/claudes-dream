extends Node
## What the player carries, what they can make, and what their gear does.

signal changed

const NAMES := {
	"wood": "Wood", "stone": "Stone", "fiber": "Fiber", "iron_ore": "Iron Ore", "iron_bar": "Iron Bar",
	"crystal": "Crystal", "plank": "Plank", "meat": "Raw Meat", "bone": "Bone", "coal": "Coal",
	"carrot": "Carrot", "beet": "Beet", "cabbage": "Cabbage", "lettuce": "Lettuce",
	"cauliflower": "Cauliflower", "broccoli": "Broccoli", "garlic": "Garlic",
	"sword_wood": "Wooden Sword", "sword_bone": "Bone Blade", "sword_iron": "Iron Sword",
	"axe": "Stone Axe", "pickaxe": "Pickaxe", "shield": "Buckler",
	"poultice": "Herb Poultice", "cooked_meat": "Roast Meat", "stew": "Veggie Stew",
}
const VEGGIES := ["carrot", "beet", "cabbage", "lettuce", "cauliflower", "broccoli", "garlic"]
const FOOD := {"cooked_meat": 45, "stew": 35, "poultice": 25, "carrot": 6, "beet": 6, "cabbage": 8, "lettuce": 5, "cauliflower": 8, "broccoli": 8, "garlic": 4}
const WEAPONS := {"sword_iron": 14, "sword_bone": 10, "sword_wood": 6}
const FIST_DAMAGE := 3
const GEAR := ["sword_wood", "sword_bone", "sword_iron", "axe", "pickaxe", "shield"]

## station -> recipes. "any_veg" in a cost means any two vegetables.
const RECIPES := {
	"workbench": [
		{"out": "sword_wood", "cost": {"wood": 4}, "desc": "6 damage. Better than fists."},
		{"out": "axe", "cost": {"wood": 3, "stone": 2}, "desc": "Chops trees three times faster."},
		{"out": "pickaxe", "cost": {"wood": 3, "stone": 3}, "desc": "Breaks rock fast and can mine iron ore."},
		{"out": "poultice", "cost": {"fiber": 3}, "desc": "Heals 25. Press Q to use food."},
	],
	"sawmill": [
		{"out": "plank", "n": 2, "cost": {"wood": 1}, "desc": "Sawn boards for sturdier gear."},
	],
	"furnace": [
		{"out": "iron_bar", "cost": {"iron_ore": 2, "wood": 1}, "desc": "Smelt ore into a bar."},
	],
	"anvil": [
		{"out": "sword_bone", "cost": {"bone": 3, "wood": 1}, "desc": "10 damage. Skeletons drop bones."},
		{"out": "sword_iron", "cost": {"iron_bar": 2, "plank": 1}, "desc": "14 damage."},
		{"out": "shield", "cost": {"plank": 3, "iron_bar": 1}, "desc": "Take a third less damage."},
	],
	"cookpot": [
		{"out": "cooked_meat", "cost": {"meat": 1, "wood": 1}, "desc": "Heals 45."},
		{"out": "stew", "cost": {"any_veg": 2}, "desc": "Heals 35. Uses any two vegetables."},
	],
}
const STATION_NAMES := {"workbench": "Workbench", "sawmill": "Sawmill", "furnace": "Furnace", "anvil": "Anvil", "cookpot": "Cooking Pot"}

var items := {}


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


func can_craft(recipe: Dictionary) -> bool:
	if recipe.out in GEAR and count(recipe.out) > 0:
		return false
	for k in recipe.cost:
		if count(k) < recipe.cost[k]:
			return false
	return true


func craft(recipe: Dictionary) -> bool:
	if not can_craft(recipe):
		return false
	for k in recipe.cost:
		take(k, recipe.cost[k])
	add(recipe.out, recipe.get("n", 1))
	return true


func weapon() -> String:
	for w in WEAPONS:
		if count(w) > 0:
			return w
	return ""


func damage() -> int:
	var w := weapon()
	return WEAPONS[w] if w != "" else FIST_DAMAGE


func has(item: String) -> bool:
	return count(item) > 0


## Best food to eat when hurt, or "".
func best_food(missing_hp: int) -> String:
	var best := ""
	for f in FOOD:
		if count(f) > 0 and (best == "" or abs(FOOD[f] - missing_hp) < abs(FOOD[best] - missing_hp)):
			best = f
	return best


func display_name(item: String) -> String:
	return NAMES.get(item, item.capitalize())
