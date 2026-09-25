class_name Interactable
extends StaticBody2D
## Props you can use with E: signposts (read), chests (loot once), mine entrances.

const CHEST_LOOT := [
	{"iron_bar": 2, "crystal": 1},
	{"plank": 4, "iron_ore": 3},
	{"cooked_meat": 2, "poultice": 2},
	{"bone": 3, "crystal": 2},
]

var mode: String
var data: Dictionary
var sprite: Sprite2D
var opened := false


func _init(mode_: String, o: Dictionary) -> void:
	mode = mode_
	data = o


func _ready() -> void:
	add_to_group("interactable")
	collision_layer = 1
	collision_mask = 0
	if mode == "mine":
		return
	var t: String = data.t
	var s := Pack.spec(t, int(data.get("v", 0)))
	World.add_shadow(self, s)
	add_child(World.foot_shape(float(s.get("solid", 4))))
	sprite = Pack.sprite(t, int(data.get("v", 0)))
	add_child(sprite)


func interact(_player: Node) -> void:
	match mode:
		"sign":
			Game.hud.show_dialog("Signpost", data.get("text", "The paint has worn away."))
		"chest":
			if opened:
				Game.say("It's empty.")
				return
			opened = true
			if data.has("cid"):
				Game.opened[str(data.cid)] = true
				Game._check_goal()
			sprite.queue_free()
			sprite = Pack.sprite("chest_open")
			add_child(sprite)
			var loot: Dictionary = CHEST_LOOT[int(data.get("loot", randi() % CHEST_LOOT.size())) % CHEST_LOOT.size()]
			for item in loot:
				Game.world.drop(item, loot[item], global_position + Vector2(0, 4))
			Game.say("The chest creaks open.")
		"mine":
			if ResourceLoader.exists("res://scripts/mine.gd"):
				Game.world.go_to("mine_1", "top")
			else:
				Game.hud.show_dialog("Old Mine", "Cold air breathes out of the dark. The tunnels are blocked by rubble, for now.")
