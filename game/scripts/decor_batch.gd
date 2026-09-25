class_name DecorBatch
extends Node2D
## Every flat bit of ground dressing in one map chunk (flowers, tufts, pebbles, tilled soil),
## drawn by one node instead of hundreds of sprites.

var _items: Array = []   # [texture, destination rect, source region, id]


func add(t: String, v: int, at: Vector2, id := "") -> void:
	var s := Pack.spec(t, v)
	var r: Array = s.region
	var size := Vector2(r[2] - r[0], r[3] - r[1])
	var dst := Rect2(at - Vector2(s.anchor[0], s.anchor[1]), size)
	var item := [Pack.texture(s.sheet), dst, Rect2(r[0], r[1], size.x, size.y), id]
	# tilled soil goes underneath everything else
	if t == "soil":
		_items.push_front(item)
	else:
		_items.append(item)


## Take away everything whose feet stand in `area`; returns their ids.
func remove_in(area: Rect2) -> Array:
	var gone := []
	for i in range(_items.size() - 1, -1, -1):
		var dst: Rect2 = _items[i][1]
		var feet := Vector2(dst.get_center().x, dst.end.y - 2)
		if area.has_point(feet):
			gone.append(_items[i][3])
			_items.remove_at(i)
	if not gone.is_empty():
		queue_redraw()
	return gone


func _draw() -> void:
	for it in _items:
		draw_texture_rect_region(it[0], it[1], it[2])
