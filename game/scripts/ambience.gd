class_name Ambience
extends CanvasLayer
## Life in the air: cloud shadows drifting over the land on fair days, fireflies on summer nights,
## leaves falling in the woods (and everywhere in fall), rain, storms with lightning, snow. Lives
## on its own canvas layer so the day/night tint doesn't wash out the glow.

const WIND := Vector2(7, 2.5)

var clouds: Array[Sprite2D] = []
var fireflies: CPUParticles2D
var leaves: CPUParticles2D
var rain: CPUParticles2D
var snow: CPUParticles2D
var flash: ColorRect
var _check := 0.0
var _bolt := 6.0
var _area := ""


func _ready() -> void:
	layer = 1
	follow_viewport_enabled = true
	for i in 7:
		var c := Pack.sprite("shadow_big")
		c.scale = Vector2(randf_range(5.0, 8.0), randf_range(3.5, 5.0))
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
	var drop := Gradient.new()
	drop.set_color(0, Color(1, 1, 1, 1))
	drop.set_color(1, Color(1, 1, 1, 0))
	drop.add_point(0.8, Color(1, 1, 1, 1))
	leaves.color_ramp = drop
	# rain: thin slanted streaks falling fast
	rain = _particles(220, 0.6, Color(0.75, 0.82, 1.0, 0.55), 1)
	rain.texture = _streak()
	rain.direction = Vector2(0.25, 1)
	rain.spread = 3.0
	rain.gravity = Vector2(40, 400)
	rain.initial_velocity_min = 180.0
	rain.initial_velocity_max = 240.0
	rain.emission_rect_extents = Vector2(300, 10)
	rain.position = Vector2(0, -170)
	# snow: slow flakes drifting sideways
	snow = _particles(140, 7.0, Color(1, 1, 1, 0.9), 2)
	snow.direction = Vector2(0.3, 1)
	snow.spread = 25.0
	snow.gravity = Vector2(4, 8)
	snow.initial_velocity_min = 10.0
	snow.initial_velocity_max = 22.0
	snow.emission_rect_extents = Vector2(300, 10)
	flash = ColorRect.new()
	flash.color = Color(1, 1, 1, 0)
	flash.size = Vector2(2000, 2000)
	flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var top := CanvasLayer.new()
	top.layer = 5
	add_child(top)
	top.add_child(flash)


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


func _streak() -> Texture2D:
	var img := Image.create(1, 5, false, Image.FORMAT_RGBA8)
	for y in 5:
		img.set_pixel(0, y, Color(1, 1, 1, 0.4 + y * 0.15))
	return ImageTexture.create_from_image(img)


func _process(delta: float) -> void:
	var player := Game.player
	if player == null or Game.world == null:
		return
	var outdoors := not Game.indoors()
	var d := Game.darkness()
	var size: Vector2 = Game.world.size
	var fair: bool = Game.weather in ["sun", "wind"]
	if Game.area != _area:
		_area = Game.area
		for c in clouds:
			c.position = Vector2(randf() * size.x, randf() * size.y)
	var wind := WIND * (3.0 if Game.weather == "wind" else 1.0)
	for c in clouds:
		c.position += wind * delta
		if c.position.x > size.x + 300:
			c.position.x = -300
			c.position.y = randf() * size.y
		c.modulate.a = move_toward(c.modulate.a, 0.5 * (1.0 - d) if outdoors and fair else 0.0, delta)
	var centre: Vector2 = player.global_position + Vector2(0, -12)
	fireflies.global_position = centre
	leaves.global_position = centre + Vector2(-40, -60)
	rain.global_position = centre + Vector2(-60, -170)
	snow.global_position = centre + Vector2(-40, -160)
	var season := Game.season()
	fireflies.emitting = outdoors and d > 0.55 and season == 1 and fair
	rain.emitting = outdoors and Game.raining()
	snow.emitting = outdoors and Game.weather == "snow"
	# lightning in a storm: a white flash every so often
	if outdoors and Game.weather == "storm":
		_bolt -= delta
		if _bolt <= 0.0:
			_bolt = randf_range(5.0, 14.0)
			var tw := flash.create_tween()
			tw.tween_property(flash, "color:a", 0.55, 0.05)
			tw.tween_property(flash, "color:a", 0.0, 0.25)
			tw.tween_property(flash, "color:a", 0.35, 0.04)
			tw.tween_property(flash, "color:a", 0.0, 0.3)
			Game.shake(1.0)
	_check -= delta
	if _check <= 0.0:
		_check = 1.0
		var trees := 0
		for n in get_tree().get_nodes_in_group("hittable"):
			if n is Harvestable and n.kind == "wood" and n._tall and n.global_position.distance_squared_to(centre) < 200.0 * 200.0:
				trees += 1
		var fall := season == 2
		leaves.color = Color(0.9, 0.55, 0.2) if fall else Color(0.5, 0.72, 0.28)
		var amt := 40 if (fall or Game.weather == "wind") else 22
		if leaves.amount != amt:
			leaves.amount = amt
		leaves.emitting = outdoors and season != 3 and (trees >= 6 or (fall and trees >= 2) or Game.weather == "wind")
