class_name Npc
extends Node2D
## Friendly characters. They face you when you're near, some stroll back and forth,
## and E starts a conversation that cycles through their lines.

const LINES := {
	"merlo": [
		"Ah, you're the one who took on the old farm west of town. It'll take a season to clear, but the soil there is good.",
		"Pell at the general store sells seeds for whatever season it is. Crops out of season wither overnight, so mind the calendar.",
		"Tilda sells kits for a workbench, a sawmill, a furnace. Set them up on your farm and you'll be making your own tools.",
		"There are springs hidden deep in the woods. A drink from one and you'll feel you could work another whole day.",
		"The Old Mine is up the mountain road north of here. Iron, coal, crystal - and things that don't like visitors.",
		"Orcs hold the badlands to the east. Stonegate beyond them keeps its gate shut at the first sign of trouble.",
	],
	"guard": [
		"Brindle watch. Orcs have been raiding the east road - if you're heading that way, bring iron.",
		"Watch their shoulders. An orc flashes right before it lunges. Step aside, then strike.",
		"Iron ore pokes out of the mountain and the quarry up there. The Old Mine has more, deeper down.",
	],
	"hunter": [
		"Rook. I cut wood in the Pinewood. Skeletons walk around the old ruin up north - I keep clear.",
		"Pine trees drip resin when you chop them. Good for torches and glue.",
		"Fiber from bushes twists into rope. Rope ties a stone to a stick, and you've got an axe.",
	],
	"fisher": [
		"Old Fenn. I've fished Mirror Lake for forty years. The river feeding it comes all the way down from Brindle.",
		"There's a spring in the woods east of the lake. Drink from it and you'll walk home lighter.",
	],
	"carpenter": [
		"Tilda, carpenter. Show me materials and I'll show you a house.",
	],
	"villager": [
		"Lovely day for it.",
		"Have you tried the stew? Two vegetables and a good fire.",
		"My gran says the stone circle in the south hums at night.",
		"They say the quarry skeletons are still digging. For what, nobody knows.",
	],
}

var actor: String
var display_name: String
var lines_key: String
var custom: Array = []      # lines of its own, instead of a shared set
var shop := ""              # a shopkeeper: talking opens their shop
var span := 0.0
var body: AnimatedSprite2D
var _line := 0
var _home := Vector2.ZERO
var _target := 0.0
var _wait := 0.0
var _anim := ""


func _init(actor_name := "wizard", name_ := "Stranger", lines := "villager", walk_span := 0.0) -> void:
	actor = actor_name
	display_name = name_
	lines_key = lines
	span = walk_span


func _ready() -> void:
	_home = position
	add_to_group("interactable")
	var sh := Pack.sprite("shadow_actor")
	sh.z_index = -1
	add_child(sh)
	body = AnimatedSprite2D.new()
	body.sprite_frames = Pack.frames(actor)
	body.centered = false
	add_child(body)
	_play("idle")
	if span <= 0.0:
		var blocker := StaticBody2D.new()
		blocker.collision_layer = 1
		blocker.add_child(World.foot_shape(5))
		add_child(blocker)
	_wait = randf_range(0.5, 3.0)


func _process(delta: float) -> void:
	var p := Game.player
	var close := p != null and p.global_position.distance_to(global_position) < 40.0
	if span > 0.0 and not close:
		if _wait > 0.0:
			_wait -= delta
			_play("idle")
		else:
			var goal := _home.x + _target
			var dx := goal - position.x
			if absf(dx) < 1.0:
				_wait = randf_range(1.5, 4.0)
				_target = randf_range(-span, span) * 0.5
			else:
				position.x += signf(dx) * minf(absf(dx), 22.0 * delta)
				_face(dx < 0)
				_play("run")
	else:
		_play("idle")
		if p:
			_face(p.global_position.x < global_position.x)


func _face(left: bool) -> void:
	if left != body.flip_h:
		body.flip_h = left
		body.offset = Pack.actor_offset(actor, _anim, left)


func _play(anim: String) -> void:
	if anim == _anim:
		return
	_anim = anim
	body.play(anim)
	body.offset = Pack.actor_offset(actor, anim, body.flip_h)


func interact(_player: Node) -> void:
	if shop != "":
		Game.hud.open_shop(shop, display_name)
		return
	var lines: Array = custom if not custom.is_empty() else LINES.get(lines_key, LINES.villager)
	Game.hud.show_dialog(display_name, lines[_line % lines.size()])
	_line += 1
