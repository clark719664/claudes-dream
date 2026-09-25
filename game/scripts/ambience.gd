class_name Ambience
extends CanvasLayer
## Life in the air: cloud shadows drifting over the land by day, fireflies at night,
## leaves falling where the trees are thick. Lives on its own canvas layer so the
## day/night tint doesn't wash out the glow.

const WIND := Vector2(7, 2.5)

var clouds: Array[Sprite2D] = []
var fireflies: CPUParticles2D
var leaves: CPUParticles2D
var _check := 0.0


func _ready() -> void:
	layer = 1
	follow_viewport_enabled = true
	var size: Vector2 = Game.world.size
	for i in 7:
		var c := Pack.sprite("shadow_big")
		c.scale = Vector2(randf_range(5.0, 8.0), randf_range(3.5, 5.0))
		c.position = Vector2(randf() * size.x, randf() * size.y)
		c.modulate.a = 0.0
		add_child(c)
		clouds.append(c)
	fireflies = _particles(46, 5.0, Color(0.85, 1.0, 0.45), 2)
	fireflies.gravity = Vector2.ZERO
	fireflies.initial_velocity_min = 3.0
	fireflies.initial_velocity_max = 9.0
	fireflies.spread = 180.0
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0))
	fade.set_color(1, Color(1, 1, 1, 0))
	fade.add_point(0.3, Color(1, 1, 1, 1))
	fade.add_point(0.55, Color(1, 1, 1, 0.2))
	fade.add_point(0.75, Color(1, 1, 1, 1))
	fireflies.color_ramp = fade
	var add := CanvasItemMaterial.new()
	add.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	fireflies.material = add
	leaves = _particles(22, 7.0, Color(0.85, 0.5, 0.2), 1)
	leaves.gravity = Vector2(3, 9)
	leaves.initial_velocity_min = 4.0
	leaves.initial_velocity_max = 10.0
	leaves.direction = Vector2(1, 0.4)
	leaves.angular_velocity_min = -90.0
	leaves.angular_velocity_max = 90.0
	var colours := Gradient.new()
	colours.set_color(0, Color(0.9, 0.55, 0.2))
	colours.set_color(1, Color(0.55, 0.7, 0.25))
	colours.add_point(0.5, Color(0.95, 0.8, 0.3))
	leaves.color_initial_ramp = colours
	var drop := Gradient.new()
	drop.set_color(0, Color(1, 1, 1, 1))
	drop.set_color(1, Color(1, 1, 1, 0))
	drop.add_point(0.8, Color(1, 1, 1, 1))
	leaves.color_ramp = drop


func _particles(amount: int, life: float, colour: Color, px: int) -> CPUParticles2D:
	var p := CPUParticles2D.new()
	p.amount = amount
	p.lifetime = life
	p.local_coords = false
	p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	p.emission_rect_extents = Vector2(270, 160)
	var img := Image.create(px, px, false, Image.FORMAT_RGBA8)
	img.fill(Color.WHITE)
	p.texture = ImageTexture.create_from_image(img)
	p.color = colour
	p.emitting = false
	add_child(p)
	return p


func _process(delta: float) -> void:
	var player := Game.player
	if player == null:
		return
	var outdoors := Game.area == "world"
	var d := Game.darkness()
	var size: Vector2 = Game.world.size
	for c in clouds:
		c.position += WIND * delta
		if c.position.x > size.x + 300:
			c.position.x = -300
			c.position.y = randf() * size.y
		c.modulate.a = move_toward(c.modulate.a, 0.5 * (1.0 - d) if outdoors else 0.0, delta)
	var centre: Vector2 = player.global_position + Vector2(0, -12)
	fireflies.global_position = centre
	leaves.global_position = centre + Vector2(-40, -60)
	fireflies.emitting = outdoors and d > 0.55
	_check -= delta
	if _check <= 0.0:
		_check = 1.0
		var trees := 0
		for n in get_tree().get_nodes_in_group("hittable"):
			if n is Harvestable and n.kind == "wood" and n._tall and n.global_position.distance_squared_to(centre) < 200.0 * 200.0:
				trees += 1
		leaves.emitting = outdoors and trees >= 6
