class_name FX
extends RefCounted
## Small shared effects: hit flash material, slash arcs, dust puffs.

static var _flash_shader: Shader


## A material that can flash a sprite white: set_shader_parameter("flash", 1.0).
static func flash_material() -> ShaderMaterial:
	if _flash_shader == null:
		_flash_shader = Shader.new()
		_flash_shader.code = """
shader_type canvas_item;
uniform float flash : hint_range(0.0, 1.0) = 0.0;
uniform vec4 tint : source_color = vec4(1.0);
void fragment() {
	vec4 c = COLOR;
	c.rgb = mix(c.rgb * tint.rgb, vec3(1.0), flash);
	COLOR = c;
}
"""
	var m := ShaderMaterial.new()
	m.shader = _flash_shader
	return m


static func flash(item: CanvasItem, time := 0.12) -> void:
	var m := item.material as ShaderMaterial
	if m == null:
		return
	m.set_shader_parameter("flash", 1.0)
	var tw := item.create_tween()
	tw.tween_method(func(v: float): m.set_shader_parameter("flash", v), 1.0, 0.0, time)


## The pack's white crescent, swept in the attack direction.
static func slash(parent: Node2D, at: Vector2, dir: Vector2, colour := Color(1, 1, 1, 0.9)) -> void:
	var frames := Pack.slash_frames()
	var s := Sprite2D.new()
	s.texture = frames[0]
	s.position = at
	s.rotation = dir.angle()
	s.modulate = colour
	s.z_index = 5
	s.flip_v = dir.x < 0
	parent.add_child(s)
	var tw := s.create_tween()
	tw.tween_interval(0.05)
	tw.tween_callback(func(): s.texture = frames[1])
	tw.tween_property(s, "modulate:a", 0.0, 0.1)
	tw.tween_callback(s.queue_free)


## Little squares that fly out when something is hit.
static func chips(parent: Node2D, at: Vector2, colour: Color, n := 6) -> void:
	for i in n:
		var c := ColorRect.new()
		c.size = Vector2(2, 2)
		c.color = colour.darkened(randf() * 0.3)
		c.position = at
		c.z_index = 6
		parent.add_child(c)
		var v := Vector2.from_angle(randf_range(-PI, 0)) * randf_range(8, 20)
		var tw := c.create_tween()
		tw.tween_property(c, "position", at + v + Vector2(0, 10), 0.35).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.parallel().tween_property(c, "modulate:a", 0.0, 0.35).set_delay(0.15)
		tw.tween_callback(c.queue_free)
