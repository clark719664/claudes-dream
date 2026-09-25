class_name Minecart
extends StaticBody2D
## A cart stop on the Deepways, the old mine railway under the valley. Every stop starts out of
## order, each for its own reason, and fixing it is a small quest: bring what it needs, or clear
## out what's in the way. A working stop lets you ride to any other working stop.

const QUESTS := {
	"dw_town": {"title": "Get the Brindle cart running",
		"text": "The winch has seized and a length of track is missing. It needs iron and planks.",
		"needs": {"iron_bar": 3, "plank": 20}},
	"dw_mountain": {"title": "Clear the rockfall at the Mountain station",
		"text": "A rockfall buried the cart. Shore the roof up with timber and fill the gap with stone.",
		"needs": {"wood": 40, "stone": 40}},
	"dw_riverlands": {"title": "Drive the slimes out of the Reedwater tunnel",
		"text": "Slimes got into the gears and gummed them up. Clear them out of the tunnel, then bring resin to grease the axles.",
		"kills": {"emerald_slime": 3}, "needs": {"resin": 5}},
	"dw_stonegate": {"title": "Break the Deep Company's hold on the east line",
		"text": "The Deep Company jammed the points on the east line. Their leader, Venn, keeps the lever key. They camp north of the tunnel.",
		"kills": {"venn": 1}, "needs": {"iron_bar": 2}},
}

var id := ""
var label := ""
var _cart: Sprite2D


func _init(id_: String, label_: String) -> void:
	id = id_
	label = label_


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	add_to_group("interactable")
	add_to_group("minecarts")
	add_child(World.foot_shape(9))
	# a short run of track with the cart on it (tipped off the rails until it's fixed)
	for i in range(-3, 3):
		var rail := Pack.sprite("rail_h")
		rail.position = Vector2(i * 16 + 8, 4)
		rail.z_index = -3
		add_child(rail)
	World.add_shadow(self, Pack.spec("minecart"))
	_refresh()


func working() -> bool:
	return Game.stations_found.has(id) or not QUESTS.has(id)


func _refresh() -> void:
	if _cart:
		_cart.queue_free()
	_cart = Pack.sprite("minecart" if working() else "cart_tipped")
	if not working():
		_cart.rotation_degrees = -8.0
		_cart.position = Vector2(-6, 2)
	add_child(_cart)


## What's still missing, as text ("" when the quest is done).
func missing() -> String:
	var q: Dictionary = QUESTS[id]
	var parts: Array[String] = []
	for actor in q.get("kills", {}):
		var have := int(Game.stats.kills.get(actor, 0))
		var need := int(q.kills[actor])
		if have < need:
			parts.append("defeat %s (%d/%d)" % [Hud.actor_label(actor), have, need])
	for item in q.get("needs", {}):
		var have := Inventory.count(item)
		var need := int(q.needs[item])
		if have < need:
			parts.append("%d %s (%d/%d)" % [need, Inventory.display_name(item), have, need])
	return ", ".join(parts)


func interact(_player: Node) -> void:
	if working():
		Game.hud.open_travel(id)
		return
	var q: Dictionary = QUESTS[id]
	var gap := missing()
	if gap != "":
		Game.hud.show_dialog(q.title, q.text + "\nStill needed: " + gap + ".")
		return
	var cost: Dictionary = q.get("needs", {})
	Game.hud.confirm("%s\nEverything's here. Fix the cart?" % q.title, func():
		Inventory.take_all(cost)
		Game.stations_found[id] = label
		Game.note("carts_fixed")
		_refresh()
		FX.chips(get_parent(), global_position + Vector2(0, -8), Color(0.8, 0.7, 0.5), 16)
		Game.say("The %s cart is running again! Ride it to any working station." % label))
