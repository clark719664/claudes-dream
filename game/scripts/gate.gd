class_name Gate
extends StaticBody2D
## A wooden gate hung between the two posts either side of a gap in a rail fence, made from the
## same rails as the fence: two rails, a stile at each end and a brace across. A one-cell gap gets
## a single leaf hinged on the left post; wider gaps get a pair meeting in the middle. The leaves
## swing back (squash towards their hinges) when someone walks up, and close again behind them.
##
## The origin is the gap's first cell, top-left; the node itself sits on the fence's foot line so
## it sorts with the fence.

const FOOT := 13

var cells := 1
var _leaves: Array[Sprite2D] = []
var _shape: CollisionShape2D
var _open := false
var _centre := Vector2.ZERO


func _init(width := 1) -> void:
	cells = maxi(1, width)


func _ready() -> void:
	position.y += FOOT
	collision_layer = 1
	collision_mask = 0
	var span := cells * 16 + 12                 # from just inside the left post to the right one
	var x0 := -6.0
	_shape = CollisionShape2D.new()
	var box := RectangleShape2D.new()
	box.size = Vector2(span, 5)
	_shape.shape = box
	_shape.position = Vector2(x0 + span / 2.0, -2.5)
	add_child(_shape)
	_centre = Vector2(x0 + span / 2.0, -4)
	var n := 1 if cells == 1 else 2
	var leaf_w := int(span / n)
	var tex := _leaf_texture(leaf_w)
	for i in n:
		var leaf := Sprite2D.new()
		leaf.texture = tex
		leaf.centered = false
		# hinge on the outer post: the left leaf at x0, the right one at the far end, mirrored
		if i == 0:
			leaf.position = Vector2(x0, -FOOT - 5)
		else:
			leaf.position = Vector2(x0 + span, -FOOT - 5)
			leaf.scale.x = -1
		add_child(leaf)
		_leaves.append(leaf)


static var _cache := {}


static func _leaf_texture(w: int) -> Texture2D:
	if _cache.has(w):
		return _cache[w]
	var im := Fences.images()
	var rail: Image = im.rail
	var bar: Image = im.bar
	var h := 18
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	# the brace, corner to corner, drawn first so the rails cross over it
	var brace := Color(0.36, 0.22, 0.12)
	var edge := Color(0.14, 0.08, 0.05)
	for x in range(3, w - 3):
		var y := int(lerpf(h - 4, 3, float(x - 3) / maxf(1, w - 7)))
		img.set_pixel(x, y, brace)
		img.set_pixel(x, y + 1, brace)
		img.set_pixel(x, y + 2, edge)
	for ry in [2, 10]:
		var x := 0
		while x < w:
			var take := mini(16, w - x)
			img.blend_rect(rail, Rect2i(0, 0, take, 6), Vector2i(x, ry))
			x += take
	# stiles at both ends
	img.blend_rect(bar, Rect2i(1, 0, 4, h), Vector2i(0, 0))
	img.blend_rect(bar, Rect2i(1, 0, 4, h), Vector2i(w - 4, 0))
	var tex := ImageTexture.create_from_image(img)
	_cache[w] = tex
	return tex


func _physics_process(_delta: float) -> void:
	var p := Game.player
	if p == null:
		return
	var near := p.global_position.distance_squared_to(global_position + _centre) < 26.0 * 26.0
	if near != _open:
		_open = near
		_shape.set_deferred("disabled", near)
		for leaf in _leaves:
			var tw := leaf.create_tween()
			var sgn := signf(leaf.scale.x)
			tw.tween_property(leaf, "scale:x", sgn * (0.18 if near else 1.0), 0.15)
