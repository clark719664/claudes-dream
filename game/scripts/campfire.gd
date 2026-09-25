class_name Campfire
extends StaticBody2D
## An animated fire that lights up the night. Styles use the pack's different fire bases:
## "bonfire" (stone hearth), "ring" (a ring of rocks), "logs" (a heap of logs on the ground) and
## "pit" (the orcs' long brick trough), each with the pack's flame animation burning on top.

const STYLES := {
	"bonfire": {"base": "campfire", "flames": [["flames", Vector2(0, -2)]], "solid": 9.0},
	"ring": {"base": "fire_ring", "flames": [["flames", Vector2(0, -4)]], "solid": 10.0},
	"logs": {"base": "fire_logs", "flames": [["flames_small", Vector2(0, -2)]], "solid": 8.0},
	"pit": {"base": "fire_pit", "flames": [["flames_small", Vector2(-22, -8)], ["flames", Vector2(0, -8)], ["flames_small", Vector2(22, -8)]], "solid": 0.0},
}

var style := "bonfire"


func _init(style_name := "bonfire") -> void:
	style = style_name if STYLES.has(style_name) else "bonfire"


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	var s: Dictionary = STYLES[style]
	if style == "pit":
		var shape := CollisionShape2D.new()
		var box := RectangleShape2D.new()
		box.size = Vector2(64, 12)
		shape.shape = box
		shape.position = Vector2(0, -8)
		add_child(shape)
	else:
		add_child(World.foot_shape(s.solid))
	add_child(Pack.anim_node(s.base))
	for f in s.flames:
		var flame := Pack.anim_node(f[0])
		flame.position = f[1]
		add_child(flame)
	var light: PointLight2D = World.make_light(Color(1.0, 0.6, 0.28), 1.3, Vector2(0, -8), 130 if style == "pit" else 110)
	add_child(light)
	var tw := light.create_tween().set_loops()
	tw.tween_property(light, "texture_scale", 1.06, 0.18)
	tw.tween_property(light, "texture_scale", 0.96, 0.22)
