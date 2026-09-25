class_name Campfire
extends StaticBody2D
## The animated fire pit at the camp; lights up the night.

func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	add_child(World.foot_shape(9))
	var fire := AnimatedSprite2D.new()
	fire.sprite_frames = Pack.anim_frames("campfire")
	fire.centered = false
	fire.offset = -Pack.anim_anchor("campfire")
	fire.play("default")
	add_child(fire)
	var flames := AnimatedSprite2D.new()
	flames.sprite_frames = Pack.anim_frames("flames")
	flames.centered = false
	flames.offset = -Pack.anim_anchor("flames") + Vector2(0, -2)
	flames.play("default")
	add_child(flames)
	var light: PointLight2D = World.make_light(Color(1.0, 0.6, 0.28), 1.3, Vector2(0, -6), 110)
	add_child(light)
	var tw := light.create_tween().set_loops()
	tw.tween_property(light, "texture_scale", 1.06, 0.18)
	tw.tween_property(light, "texture_scale", 0.96, 0.22)
