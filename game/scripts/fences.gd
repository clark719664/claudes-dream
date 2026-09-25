class_name Fences
extends RefCounted
## Picket fences as autotiled, Y-sorted tiles with collision.
##
## The pack draws each fence as a small enclosure "stamp": a run of pickets between posts on top
## and bottom, and posts running down the sides. We cut that stamp into five pieces (a post with a
## cap, a post running on, a post's foot, a lone post and a run of pickets) and assemble one tile
## per combination of neighbours (N, E, S, W), always with the post on the tile's left edge. A
## fence along the top of a yard is then a row of cells, its sides are columns, and every corner,
## tee and end comes out right. Gaps are gateways; gate.gd hangs a swinging gate in them.

const N := 1
const E := 2
const S := 4
const W := 8
## sheet and the top-left of the stamp's top rail
const STYLES := {
	"picket": {"sheet": "Environment/Structures/Buildings/Props.png", "origin": Vector2i(6, 176)},
	"dark": {"sheet": "Environment/Props/Static/Furniture.png", "origin": Vector2i(6, 432)},
}
const ORDER := ["picket", "dark"]


## One Y-sorted layer holding every fence. `fences` maps a style name to a flat [x, y, x, y, ...]
## list of cells.
static func build(fences: Dictionary) -> TileMapLayer:
	var layer := TileMapLayer.new()
	layer.name = "Fences"
	layer.y_sort_enabled = true
	layer.tile_set = _tileset()
	for style in fences:
		var row := ORDER.find(style)
		if row < 0:
			continue
		var cells := {}
		var flat: Array = fences[style]
		for i in range(0, flat.size(), 2):
			cells[Vector2i(flat[i], flat[i + 1])] = true
		for c in cells:
			var m := 0
			if cells.has(c + Vector2i.UP): m |= N
			if cells.has(c + Vector2i.RIGHT): m |= E
			if cells.has(c + Vector2i.DOWN): m |= S
			if cells.has(c + Vector2i.LEFT): m |= W
			layer.set_cell(c, 0, Vector2i(m, row))
	return layer


static func _tileset() -> TileSet:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(16, 16)
	ts.add_physics_layer()
	ts.set_physics_layer_collision_layer(0, 1)
	ts.set_physics_layer_collision_mask(0, 0)
	var atlas := Image.create(16 * 16, 16 * ORDER.size(), false, Image.FORMAT_RGBA8)
	for row in ORDER.size():
		var st: Dictionary = STYLES[ORDER[row]]
		var src := Pack.texture(st.sheet).get_image()
		if src.is_compressed():
			src.decompress()
		src.convert(Image.FORMAT_RGBA8)
		var o: Vector2i = st.origin
		var cap := Rect2i(o + Vector2i(0, 16), Vector2i(4, 16))
		var line := Rect2i(o + Vector2i(0, 32), Vector2i(4, 16))
		var foot := Rect2i(o + Vector2i(0, 48), Vector2i(4, 16))
		var lone := Rect2i(o + Vector2i(16, 0), Vector2i(4, 16))
		var pickets := Rect2i(o + Vector2i(4, 16), Vector2i(12, 16))
		for m in 16:
			var at := Vector2i(m * 16, row * 16)
			if m & E:
				atlas.blend_rect(src, pickets, at + Vector2i(4, 0))
			var post := lone
			if m & N and m & S:
				post = line
			elif m & S:
				post = cap
			elif m & N:
				post = foot
			atlas.blend_rect(src, post, at)
	var source := TileSetAtlasSource.new()
	source.texture = ImageTexture.create_from_image(atlas)
	source.texture_region_size = Vector2i(16, 16)
	ts.add_source(source, 0)
	for row in ORDER.size():
		for m in 16:
			var t := Vector2i(m, row)
			source.create_tile(t)
			var d := source.get_tile_data(t, 0)
			d.y_sort_origin = 6
			# boxes in tile space (centre = 0,0): the pickets' foot along the bottom, the post up the left
			var boxes := []
			if m & E:
				boxes.append(Rect2(-8, 2, 16, 6))
			if m & N:
				boxes.append(Rect2(-8, -8, 4, 16))
			else:
				boxes.append(Rect2(-8, 2, 4, 6))
			for b in boxes:
				var i := d.get_collision_polygons_count(0)
				d.add_collision_polygon(0)
				d.set_collision_polygon_points(0, i, PackedVector2Array([b.position, Vector2(b.end.x, b.position.y), b.end, Vector2(b.position.x, b.end.y)]))
	return ts
