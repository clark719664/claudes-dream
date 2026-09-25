class_name DecorBatch
extends Node2D
## Every flat bit of ground dressing in one map chunk (flowers, tufts, pebbles, tilled soil),
## drawn by one node instead of hundreds of sprites.

var _items: Array = []   # [texture, destination rect, source region]


func add(t: String, v: int, at: Vector2) -> void:
	var s := Pack.spec(t, v)
	var r: Array = s.region
	var size := Vector2(r[2] - r[0], r[3] - r[1])
	var dst := Rect2(at - Vector2(s.anchor[0], s.anchor[1]), size)
	var item := [Pack.texture(s.sheet), dst, Rect2(r[0], r[1], size.x, size.y)]
	# tilled soil goes underneath everything else
	if t == "soil":
		_items.push_front(item)
	else:
		_items.append(item)


func _draw() -> void:
	for it in _items:
		draw_texture_rect_region(it[0], it[1], it[2])
