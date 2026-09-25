class_name House
extends StaticBody2D
## A house front assembled from the pack's roof, wall, door, window and chimney pieces.
## The origin is the middle of the bottom edge (the doorstep), 128 x 144 px overall.

const ROOFS := "Environment/Structures/Buildings/Roofs.png"
const WALLS := "Environment/Structures/Buildings/Walls.png"
const FURN := "Environment/Props/Static/Furniture.png"

## wall strip (6 tiles x 3), roof, door, window, chimney?
const STYLES := {
	"log": {"wall": Rect2(0, 192, 96, 48), "roof": Rect2(0, 0, 128, 96), "door": Rect2(128, 272, 32, 32), "window": Rect2(32, 352, 32, 32), "chimney": false},
	"plank": {"wall": Rect2(96, 192, 96, 48), "roof": Rect2(0, 0, 128, 96), "door": Rect2(160, 272, 32, 32), "window": Rect2(64, 320, 32, 32), "chimney": true},
	"dark": {"wall": Rect2(192, 192, 96, 48), "roof": Rect2(0, 0, 128, 96), "door": Rect2(192, 272, 32, 32), "window": Rect2(128, 352, 32, 32), "chimney": true},
	"plaster": {"wall": Rect2(288, 192, 96, 48), "roof": Rect2(128, 0, 128, 96), "door": Rect2(224, 272, 32, 32), "window": Rect2(128, 352, 32, 32), "chimney": true},
}

signal entered

var style := "log"
var label := ""
var is_cabin := false
var _parts: Node2D


func _init(style_name := "log", label_text := "", cabin := false) -> void:
	style = style_name
	label = label_text
	is_cabin = cabin


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(112, 92)
	shape.shape = rect
	shape.position = Vector2(0, -56)
	add_child(shape)
	add_to_group("interactable")
	rebuild(style)


func rebuild(style_name: String) -> void:
	style = style_name
	if _parts:
		_parts.queue_free()
	_parts = Node2D.new()
	add_child(_parts)
	var s: Dictionary = STYLES[style]
	var o := Vector2(-64, -144)  # top-left of the house
	var shadow := Pack.sprite("shadow_big")
	shadow.position = Vector2(0, -4)
	shadow.scale = Vector2(1.25, 0.8)
	shadow.z_index = -1
	_parts.add_child(shadow)
	var wall: Rect2 = s.wall
	# the gable wall shows through the notch under the roof's peak
	for gy in 2:
		_piece(WALLS, Rect2(wall.position.x, wall.position.y + 8, 64, 16), o + Vector2(32, 64 + gy * 16))
	if s.chimney:
		_piece(FURN, Rect2(0, 320, 32, 64), o + Vector2(84, -20))
	_piece(ROOFS, s.roof, o)
	_piece(WALLS, wall, o + Vector2(16, 96))
	var door: Rect2 = s.door
	_piece(FURN, door, o + Vector2(64 - door.size.x / 2.0, 144 - door.size.y))
	var win: Rect2 = s.window
	_piece(FURN, win, o + Vector2(20, 104))
	_piece(FURN, win, o + Vector2(108 - win.size.x, 104))
	if s.chimney:
		var smoke := Pack.anim_node("smoke")
		smoke.position = o + Vector2(100, -14)
		smoke.modulate.a = 0.75
		_parts.add_child(smoke)


func _piece(sheet: String, region: Rect2, at: Vector2) -> void:
	var sp := Sprite2D.new()
	var t := AtlasTexture.new()
	t.atlas = Pack.texture(sheet)
	t.region = region
	sp.texture = t
	sp.centered = false
	sp.position = at
	_parts.add_child(sp)


func interact(_player: Node) -> void:
	if is_cabin:
		entered.emit()
	else:
		Game.hud.show_dialog(label if label != "" else "House", "The door is locked. Someone's home - you can hear a kettle.")
