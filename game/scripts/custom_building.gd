class_name CustomBuilding
extends StaticBody2D
## Renders a large custom building directly from a catalog sprite.
## Sets up a solid collision box and an interaction area at the door.

signal entered

var building_id := ""
var sprite: Sprite2D
var door_area: Area2D

func _init(id: String) -> void:
	building_id = id
	
	sprite = Sprite2D.new()
	var tex_path := "res://assets/pixellab_objects/" + id + ".png"
	sprite.texture = load(tex_path)
	
	if sprite.texture:
		sprite.hframes = 8
		sprite.frame = 0
		sprite.offset = Vector2(0, -sprite.texture.get_height() / 2)
	
	add_child(sprite)
	
	var col = CollisionShape2D.new()
	var rect = RectangleShape2D.new()
	rect.size = Vector2(160, 60)
	col.shape = rect
	col.position = Vector2(0, -30)
	add_child(col)
	
	door_area = Area2D.new()
	door_area.collision_layer = 0
	door_area.collision_mask = 2 # Player
	var door_col = CollisionShape2D.new()
	var door_rect = RectangleShape2D.new()
	door_rect.size = Vector2(32, 32)
	door_col.shape = door_rect
	door_col.position = Vector2(0, -16) # Door is usually at bottom center
	door_area.add_child(door_col)
	add_child(door_area)
	
	door_area.body_entered.connect(_on_door_entered)

func _on_door_entered(body: Node2D) -> void:
	if body is Player:
		entered.emit()

func display_name() -> String:
	return building_id.capitalize().replace("_", " ")

func interact(_player: Node) -> void:
	pass
