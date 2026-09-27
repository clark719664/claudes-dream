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
	var stage := stage_of(info)
	if sprite:
		sprite.queue_free()
	sprite = Pack.sprite("crop_" + kind, stage)
	sprite.show_behind_parent = true
	add_child(sprite)
	if kind in ["sativa", "hybrid", "indica"] and stage >= 2:
		_add_buds(stage)
	if Game.world and Game.world.soil and Game.world.soil.state.soil.get(Soil.key_of(cell) + "_f", 0) == 1 and stage == 3:
		sprite.scale = Vector2(1.35, 1.35)
	queue_redraw()


func _add_buds(stage: int) -> void:
	var heights := {"sativa": [28.0, 40.0], "hybrid": [24.0, 33.0], "indica": [21.0, 28.0]}
	var height: float = heights[kind][stage - 2]
	var places := [Vector2(0, -height * 0.80)]
	if stage == 3:
		places.append(Vector2(-5, -height * 0.52))
		places.append(Vector2(5, -height * 0.40))
	for at in places:
		var bud := Sprite2D.new()
		bud.texture = Pack.icon(kind)
		bud.position = at.round()
		bud.scale = Vector2.ONE * (0.5 if stage == 3 else 0.25)
		bud.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.add_child(bud)


func get_seed_color() -> Color:
	match kind:
		"carrot": return Color.ORANGE
		"beet": return Color.CRIMSON
		"cabbage": return Color.PALE_GREEN
		"lettuce": return Color.LIGHT_GREEN
		"cauliflower": return Color.WHITE
		"broccoli": return Color.DARK_GREEN
		"garlic": return Color.LIGHT_YELLOW
		"tomato": return Color.RED
		"pumpkin": return Color.DARK_ORANGE
		"corn": return Color.YELLOW
		"strawberry": return Color.HOT_PINK
		"eggplant": return Color.PURPLE
		"onion": return Color.LIGHT_CYAN
		_: return Color.SADDLE_BROWN

func _draw() -> void:
	if stage_of(info) == 0 and not kind in ["sativa", "hybrid", "indica"]:
		var c = get_seed_color()
		# Draw above sprite
		draw_rect(Rect2(-4, -6, 2, 2), c)
		draw_rect(Rect2(2, -4, 2, 2), c)
		draw_rect(Rect2(-1, -1, 2, 2), c)
		draw_rect(Rect2(4, -8, 2, 2), c)
		draw_rect(Rect2(-5, -2, 2, 2), c)

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
