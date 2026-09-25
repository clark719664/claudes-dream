class_name Soil
extends Node2D
## Tilled earth in an area you can farm (your farm), darker where it's been watered today, and
## the crops growing in it. The state lives in Game.area_state (so it's saved and carries over
## between visits): soil {"x,y": 1 if watered today else 0} and crops {"x,y": {kind, age}}.

var state: Dictionary
var crops := {}          # "x,y" -> Crop node
var _tex: Texture2D
var _src: Rect2


func _init(area_state: Dictionary) -> void:
	state = area_state


func _ready() -> void:
	z_index = -5
	var s := Pack.spec("soil")
	var r: Array = s.region
	_tex = Pack.texture(s.sheet)
	_src = Rect2(r[0], r[1], r[2] - r[0], r[3] - r[1])
	for key in state.crops:
		_add_crop(key)
	queue_redraw()


static func key_of(c: Vector2i) -> String:
	return "%d,%d" % [c.x, c.y]


static func cell_of(key: String) -> Vector2i:
	var p := key.split(",")
	return Vector2i(int(p[0]), int(p[1]))


func has_soil(c: Vector2i) -> bool:
	return state.soil.has(key_of(c))


func has_crop(c: Vector2i) -> bool:
	return state.crops.has(key_of(c))


func till(c: Vector2i) -> void:
	state.soil[key_of(c)] = 1 if Game.raining() and Game.area != "house" else 0
	queue_redraw()


func water(c: Vector2i) -> bool:
	var k := key_of(c)
	if not state.soil.has(k) or state.soil[k] == 1:
		return false
	state.soil[k] = 1
	queue_redraw()
	if has_crop(c):
		crops[k].refresh()
	return true


func plant(c: Vector2i, kind: String) -> bool:
	var k := key_of(c)
	if not state.soil.has(k) or state.crops.has(k):
		return false
	state.crops[k] = {"kind": kind, "age": 0}
	_add_crop(k)
	return true


## Pick a ripe crop. Returns how many you got (0 if it isn't ready).
func harvest(c: Vector2i) -> int:
	var k := key_of(c)
	if not state.crops.has(k):
		return 0
	var crop: Dictionary = state.crops[k]
	if Crop.stage_of(crop) < 3:
		return 0
	state.crops.erase(k)
	if crops.has(k):
		crops[k].queue_free()
		crops.erase(k)
	return 1 + int(randf() < 0.25)


## Dig up an empty patch again (hitting it with the hoe once more does nothing; the pickaxe does).
func clear(c: Vector2i) -> bool:
	var k := key_of(c)
	if not state.soil.has(k) or state.crops.has(k):
		return false
	state.soil.erase(k)
	queue_redraw()
	return true


func _add_crop(k: String) -> void:
	var c := cell_of(k)
	var node := Crop.new(state.crops[k], c)
	node.position = Vector2(c) * 16 + Vector2(8, 13)
	Game.world.entities.add_child(node)
	crops[k] = node


func _draw() -> void:
	for k in state.soil:
		var c := cell_of(k)
		var wet: bool = state.soil[k] == 1
		draw_texture_rect_region(_tex, Rect2(Vector2(c) * 16, Vector2(16, 16)), _src, Color(0.62, 0.55, 0.6) if wet else Color.WHITE)
