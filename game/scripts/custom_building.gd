class_name CustomBuilding
extends StaticBody2D
## A large building drawn from its catalog sprite, standing with its feet on the origin.
## Curated entries (tools/curate_pixellab_assets.py) carry their own anchor, collision footprint
## and door; older entries that only name a sheet region still work, anchored at the bottom of
## the art they actually contain. The door is a small area in front of the entrance: stand in it
## and press interact to go inside (or hear that it's locked).

signal entered

const LOCKED := "The door is locked."

var building_id := ""
var label := ""
var sprite: Sprite2D
var door_area: Area2D
var _at_door := false
var _sign: Label


func _init(id: String) -> void:
	building_id = id
	collision_layer = 1
	collision_mask = 0
	var spec := _spec(id)
	sprite = Sprite2D.new()
	sprite.centered = false
	var size := Vector2(64, 64)
	var anchor := Vector2(32, 64)
	var scale_by := float(spec.get("scale", 1.0))
	if spec.has("sheet"):
		var tex: Texture2D = Pack.atlas(spec)
		sprite.texture = tex
		size = tex.get_size()
		anchor = Vector2(spec.anchor[0], spec.anchor[1]) if spec.has("anchor") else _contents_anchor(tex)
	sprite.offset = -anchor
	sprite.scale = Vector2.ONE * scale_by
	add_child(sprite)

	var fp: Dictionary = spec.get("footprint", {})
	var fw := float(fp.get("w", size.x * 0.82)) * scale_by
	var fh := float(fp.get("h", minf(size.y * 0.4, 56.0))) * scale_by
	var col := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(fw, fh)
	col.shape = rect
	col.position = Vector2(float(fp.get("x", size.x / 2.0 - anchor.x)) * scale_by, -fh / 2.0)
	add_child(col)

	var shadow := Pack.sprite("shadow_big")
	shadow.scale = Vector2(fw * 1.15 / 112.0, 0.7)
	shadow.position = Vector2(col.position.x, -2)
	shadow.z_index = -1
	shadow.modulate.a = 0.7
	add_child(shadow)

	var door: Dictionary = spec.get("door", {})
	if not door.is_empty() or not spec.get("curated", false):
		var dx := float(door.get("x", 0)) * scale_by
		door_area = DoorSpot.new(self)
		door_area.position = Vector2(dx, 6)
		var shape := CollisionShape2D.new()
		var dr := RectangleShape2D.new()
		dr.size = Vector2(float(door.get("w", 24)), 18)
		shape.shape = dr
		door_area.add_child(shape)
		add_child(door_area)
		door_area.body_entered.connect(_on_door_body.bind(true))
		door_area.body_exited.connect(_on_door_body.bind(false))
		add_child(World.make_light(Color(1.0, 0.78, 0.45), 0.8, Vector2(dx, -20), 80))


func _ready() -> void:
	_sign = Label.new()
	_sign.text = display_name()
	_sign.add_theme_color_override("font_color", Color(1.0, 0.9, 0.7))
	_sign.add_theme_color_override("font_outline_color", Color(0.12, 0.08, 0.05))
	_sign.add_theme_constant_override("outline_size", 2)
	_sign.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sign.size = Vector2(160, 10)
	_sign.position = Vector2((door_area.position.x if door_area else 0.0) - 80, -34)
	_sign.z_index = 30
	_sign.visible = false
	add_child(_sign)


func _spec(id: String) -> Dictionary:
	if Pack.has_sprite(id):
		return Pack.spec(id)
	var path := "pixellab_objects/%s.png" % id
	if ResourceLoader.exists("res://assets/" + path):
		var h := Pack.texture(path).get_height()
		return {"sheet": path, "region": [0, 0, h, h]}
	push_warning("CustomBuilding: no art for " + id)
	return {}


## Bottom-centre of the opaque pixels, for regions that were never curated.
func _contents_anchor(tex: Texture2D) -> Vector2:
	var img := tex.get_image()
	if img == null:
		return Vector2(tex.get_width() / 2.0, tex.get_height())
	var used := img.get_used_rect()
	return Vector2(used.position.x + used.size.x / 2.0, used.end.y - 2)


func _on_door_body(body: Node2D, inside: bool) -> void:
	if body is Player:
		_at_door = inside
		if _sign:
			_sign.visible = inside


func enterable() -> bool:
	return door_area != null and World.INTERIORS.has(building_id)


func display_name() -> String:
	return label if label != "" else building_id.capitalize()


func interact(_player: Node) -> void:
	if door_area == null or not (_at_door or (_player is Node2D and door_area.overlaps_body(_player))):
		return
	if enterable():
		entered.emit()
	else:
		Game.hud.show_dialog(display_name(), LOCKED)


## The spot in front of the door that the player's interact reach picks up.
class DoorSpot extends Area2D:
	var building: Node

	func _init(owner_building: Node) -> void:
		building = owner_building
		collision_layer = 0
		collision_mask = 2
		monitorable = false
		add_to_group("interactable")

	func interact(player: Node) -> void:
		building.interact(player)
