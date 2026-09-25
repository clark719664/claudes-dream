class_name Spring
extends Node2D
## A clear spring deep in the wild. Drink from it (E) and your energy comes back, once a day.
## A few motes of light hang over the water so you can find it at dusk.

var label := "A spring"


func _init(name_: String) -> void:
	label = name_


func _ready() -> void:
	add_to_group("interactable")
	var motes := CPUParticles2D.new()
	motes.amount = 10
	motes.lifetime = 3.0
	motes.position = Vector2(0, -26)
	motes.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	motes.emission_rect_extents = Vector2(22, 10)
	motes.gravity = Vector2(0, -3)
	motes.initial_velocity_min = 1.0
	motes.initial_velocity_max = 4.0
	motes.spread = 180.0
	var img := Image.create(1, 1, false, Image.FORMAT_RGBA8)
	img.fill(Color.WHITE)
	motes.texture = ImageTexture.create_from_image(img)
	motes.color = Color(0.75, 0.95, 1.0, 0.9)
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0))
	fade.set_color(1, Color(1, 1, 1, 0))
	fade.add_point(0.5, Color(1, 1, 1, 1))
	motes.color_ramp = fade
	var add := CanvasItemMaterial.new()
	add.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	motes.material = add
	add_child(motes)
	add_child(World.make_light(Color(0.6, 0.85, 1.0), 0.6, Vector2(0, -24), 72))


func interact(_player: Node) -> void:
	if int(Game.springs.get(label, 0)) == Game.day:
		Game.say("The water is cold and clear. You've already drunk your fill today.")
		return
	Game.springs[label] = Game.day
	Game.energy = Game.MAX_ENERGY
	Game.player.hp = Game.player.max_hp
	Game.world.float_text("Energy restored", global_position + Vector2(0, -16), Color(0.6, 0.9, 1.0))
	Game.say("%s. You drink, and feel new." % label)
	Game._check_goal()
