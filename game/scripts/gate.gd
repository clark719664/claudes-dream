class_name Gate
extends StaticBody2D
## A two-leaf garden gate hung in a gap in a fence. The leaves swing back (squash towards their
## posts) when someone walks up, and close again behind them. The origin is the bottom-left of
## the gap (the fence's foot line, so it sorts like the fence); the gap is two tiles wide.

const SHEET := "Environment/Props/Static/Furniture.png"
const LEAVES := [Rect2(0, 512, 16, 16), Rect2(16, 512, 16, 16)]

var tint := Color.WHITE
var _leaves: Array[Sprite2D] = []
var _shape: CollisionShape2D
var _open := false


func _init(style := "picket") -> void:
	# the pack only draws a gate for the dark fence; lighten it for the plain picket fence
	tint = Color(1.25, 1.18, 1.1) if style == "picket" else Color.WHITE


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	_shape = CollisionShape2D.new()
	var box := RectangleShape2D.new()
	box.size = Vector2(32, 6)
	_shape.shape = box
	_shape.position = Vector2(16, -3)
	add_child(_shape)
	for i in 2:
		var leaf := Sprite2D.new()
		var t := AtlasTexture.new()
		t.atlas = Pack.texture(SHEET)
		t.region = LEAVES[i]
		leaf.texture = t
		leaf.centered = false
		leaf.modulate = tint
		# pivot on the outer post: the left leaf hinges at x 0, the right one at x 32
		leaf.position = Vector2(0 if i == 0 else 32, -16)
		leaf.offset = Vector2(0 if i == 0 else -16, 0)
		add_child(leaf)
		_leaves.append(leaf)


func _physics_process(_delta: float) -> void:
	var p := Game.player
	if p == null:
		return
	var near := p.global_position.distance_squared_to(global_position + Vector2(16, -6)) < 30.0 * 30.0
	if near != _open:
		_open = near
		_shape.set_deferred("disabled", near)
		for leaf in _leaves:
			var tw := leaf.create_tween()
			tw.tween_property(leaf, "scale:x", 0.2 if near else 1.0, 0.15)
