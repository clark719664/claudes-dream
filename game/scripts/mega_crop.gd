class_name MegaCrop
extends StaticBody2D

var kind: String
var hp := 5
var sprite: Sprite2D

func _init(k: String) -> void:
	kind = k
	sprite = Sprite2D.new()
	var tex_path = "res://assets/pixellab_objects/" + kind + ".png"
	sprite.texture = load(tex_path)
	if sprite.texture:
		sprite.hframes = 8
		sprite.frame = 0
		sprite.offset = Vector2(0, -sprite.texture.get_height() / 2)
	add_child(sprite)
	
	# Solid collision
	var col = CollisionShape2D.new()
	var rect = RectangleShape2D.new()
	rect.size = Vector2(40, 40)
	col.shape = rect
	col.position = Vector2(0, -20)
	add_child(col)

func _ready() -> void:
	add_to_group("hittable")
	collision_layer = 1
	collision_mask = 0

func hit_centre() -> Vector2:
	return position + Vector2(0, -20)

func hit_radius() -> float:
	return 20.0

func hit(damage: int, dir: Vector2, _by: Node) -> void:
	if Inventory.tool_power(Inventory.AXES) < 1:
		Game.say("It's too tough for your hands. Try an axe.")
		return
	hp -= 1
	FX.chips(get_parent(), hit_centre(), Color.ORANGE, 3)
	if hp <= 0:
		var base_crop = kind.trim_prefix("mega_")
		for i in range(18):
			var offset = Vector2(randf_range(-20, 20), randf_range(-20, 20))
			Game.world.spawn_drop(base_crop, hit_centre() + offset)
		Game.world.note_removed(position)
		queue_free()
