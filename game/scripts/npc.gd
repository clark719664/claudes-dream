class_name Npc
extends Node2D
## Friendly characters. They face you when you're near, some stroll back and forth,
## and E starts a conversation that cycles through their lines.

const LINES := {
	"merlo": [
		"Welcome to Brindle, traveller. That cabin south-west of the square is yours now - the old owner left it to whoever would mend it.",
		"Everything worth having is made from something smaller. Planks from logs, nails from iron, rope from fiber. Check each station to see what it can make.",
		"Smelt ore at the furnace with coal. Bars become nails and blades at the anvil.",
		"Tilda the carpenter can rebuild your cabin, if you bring her the materials. Bigger home, better workshop.",
		"Sleep in your bed to end the day. The world saves while you dream.",
		"Skeletons guard the graveyard in the north-west, and worse things haunt Frostvale. Orcs hold the east.",
	],
	"guard": [
		"Captain Brann, Brindle watch. Orcs have been raiding the east road - if you're heading that way, bring iron.",
		"Watch their shoulders. An orc flashes right before it lunges. Step aside, then strike.",
		"The mine's been shut since the collapse. Iron ore still pokes out of the hills and the quarry.",
	],
	"hunter": [
		"Shh. The forest is full of game... and worse. Skeletons wander from the graveyard at night.",
		"Pine trees drip resin when you chop them. Good for torches and glue.",
		"Fiber from bushes twists into rope. Rope ties a stone to a stick, and you've got an axe.",
	],
	"fisher": [
		"Old Fenn. I've fished this lake for forty years. There's a chest on the island nobody's dared swim for.",
		"The river comes down from Frostvale. Cold enough to stop your heart.",
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
	if lines_key == "carpenter":
		Game.hud.open_upgrades()
		return
	var lines: Array = LINES.get(lines_key, LINES.villager)
	Game.hud.show_dialog(display_name, lines[_line % lines.size()])
	_line += 1
