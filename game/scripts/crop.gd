class_name Crop
extends Node2D
## A crop in tilled soil. Grows through four stages; harvest the last one with E.

const GROW_TIME := 45.0  # seconds per stage

var kind: String
var stage := 0
var sprite: Sprite2D
var _t := 0.0


func _init(kind_name := "carrot", start_stage := 0) -> void:
	kind = kind_name
	stage = start_stage


func _ready() -> void:
	add_to_group("interactable")
	_t = randf() * GROW_TIME
	_refresh()


func _process(delta: float) -> void:
	if stage >= 3:
		return
	_t += delta
	if _t >= GROW_TIME:
		_t = 0.0
		stage += 1
		_refresh()


func interact(_player: Node) -> void:
	if stage < 3:
		Game.say("The %s isn't ready yet." % Inventory.display_name(kind).to_lower())
		return
	var n := 1 + int(randf() < 0.4)
	for i in n:
		Inventory.add(kind)
	Game.world.float_text("+%d %s" % [n, Inventory.display_name(kind)], global_position, Color(0.8, 1.0, 0.6))
	stage = 0
	_t = 0.0
	_refresh()


func _refresh() -> void:
	if sprite:
		sprite.queue_free()
	sprite = Pack.sprite("crop_" + kind, stage)
	add_child(sprite)
