class_name Npc
extends Node2D
## A friendly character who stands by the camp and gives advice.

const LINES := [
	"Welcome, traveller. Chop trees and break rocks for materials - press J or click to swing.",
	"The workbench makes tools. An axe fells trees three times faster; a pickaxe can mine iron ore.",
	"Smelt iron ore in the furnace, then forge a real sword at the anvil. Planks come from the sawmill.",
	"Skeletons guard the old graveyard to the north. Their bones make a fine blade.",
	"Orcs camp past the fields to the east. They hit hard - watch for the flash before they lunge.",
	"Ripe crops can be picked with E. Cook them into stew at the pot, then press Q to eat when hurt.",
	"Nights are dangerous: monsters roam faster and see further. Stay near the fire.",
]

var actor: String
var display_name: String
var body: AnimatedSprite2D
var _line := 0


func _init(actor_name := "wizard", name_ := "Stranger") -> void:
	actor = actor_name
	display_name = name_


func _ready() -> void:
	add_to_group("interactable")
	var sh := Pack.sprite("shadow_actor")
	sh.z_index = -1
	add_child(sh)
	body = AnimatedSprite2D.new()
	body.sprite_frames = Pack.frames(actor)
	body.centered = false
	body.play("idle")
	body.offset = Pack.actor_offset(actor, "idle", false)
	add_child(body)
	var blocker := StaticBody2D.new()
	blocker.collision_layer = 1
	blocker.add_child(World.foot_shape(5))
	add_child(blocker)


func _process(_delta: float) -> void:
	if Game.player:
		var left: bool = Game.player.global_position.x < global_position.x
		if left != body.flip_h:
			body.flip_h = left
			body.offset = Pack.actor_offset(actor, "idle", left)


func interact(_player: Node) -> void:
	Game.hud.show_dialog(display_name, LINES[_line])
	_line = (_line + 1) % LINES.size()
