class_name Crop
extends Node2D
## A crop growing in tilled soil. It grows a day each morning after a day it was watered, through
## four looks (seed, sprout, growing, ripe), and is picked with E once ripe. Crops out of season
## wither overnight (see World.new_day).

var info: Dictionary     # {kind, age} - shared with the area's saved state
var cell := Vector2i.ZERO
var kind := "carrot"
var sprite: Sprite2D


func _init(info_: Dictionary, cell_: Vector2i) -> void:
	info = info_
	cell = cell_
	kind = info.kind


func _ready() -> void:
	add_to_group("interactable")
	refresh()


static func stage_of(c: Dictionary) -> int:
	var days := int(Inventory.CROPS.get(c.kind, {"days": 4}).days)
	var age := int(c.age)
	if age >= days:
		return 3
	return mini(2, int(age * 3.0 / days))


func refresh() -> void:
	if sprite:
		sprite.queue_free()
	sprite = Pack.sprite("crop_" + kind, stage_of(info))
	add_child(sprite)


func interact(_player: Node) -> void:
	if stage_of(info) < 3:
		var days := int(Inventory.CROPS[kind].days) - int(info.age)
		Game.say("The %s needs %d more day%s%s." % [Inventory.display_name(kind).to_lower(), days, "s" if days != 1 else "",
			"" if Game.world.soil.state.soil.get(Soil.key_of(cell), 0) == 1 else " (and water)"])
		return
	var n: int = Game.world.soil.harvest(cell)
	if n <= 0:
		return
	Inventory.add(kind, n)
	Game.note_gather(kind, n)
	Game.world.float_text("+%d %s" % [n, Inventory.display_name(kind)], global_position, Color(0.8, 1.0, 0.6))
