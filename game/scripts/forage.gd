class_name Forage
extends Node2D
## Something to pick up with E: mushrooms in the woods, herbs by the bushes. Grows back each morning.

var item: String
var sprite_name: String
var variant := 0
var sprite: Sprite2D
var taken := false


func _init(item_: String, sprite_: String, v := 0) -> void:
	item = item_
	sprite_name = sprite_
	variant = v


func _ready() -> void:
	add_to_group("interactable")
	add_to_group("forage")
	sprite = Pack.sprite(sprite_name, variant)
	add_child(sprite)
	# a faint glint so they stand out from the decoration
	var tw := sprite.create_tween().set_loops()
	tw.tween_property(sprite, "modulate", Color(1.35, 1.35, 1.2), 0.9).set_delay(randf() * 2.0)
	tw.tween_property(sprite, "modulate", Color.WHITE, 0.9)


func interact(_player: Node) -> void:
	if taken:
		return
	taken = true
	visible = false
	remove_from_group("interactable")
	Inventory.add(item)
	Game.note_gather(item)
	Game.world.note_removed(self)
	Game.world.float_text("+1 " + Inventory.display_name(item), global_position, Color(0.8, 1.0, 0.6))


func regrow() -> void:
	taken = false
	visible = true
	add_to_group("interactable")
