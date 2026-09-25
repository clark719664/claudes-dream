class_name Fences
extends RefCounted
## Plain wooden post-and-rail fences, autotiled.
##
## Cut at load time from the pack's farm fence (Farm.png): a post with its dark foot and two of
## its rails. Every cell of a fence gets a post in its middle; rails run to the neighbouring
## posts it connects to. East-west rails are the pack's rails; north-south runs show the rails
## end-on as a narrow bar between the posts, as a fence seen from the front does. Each tile is
## 16 wide and 24 tall, standing 8 px above its cell, and is Y-sorted by its foot.
##
## Gaps in a fence are gateways; gate.gd hangs a gate between the posts on either side.

const N := 1
const E := 2
const S := 4
const W := 8
const SHEET := "Environment/Props/Static/Farm.png"
const POST := Rect2i(284, 32, 4, 48)       # the full post; we use its top and its foot
const RAIL := Rect2i(288, 36, 16, 6)       # one rail, 16 px of it
const H := 24                              # tile height; the cell is the bottom 16 px
const POST_H := 20


## One Y-sorted layer holding every fence. `fences` maps a style to a flat [x, y, x, y, ...]
## list of cells (only "rail" now; older styles are drawn as rail too).
static func build(fences: Dictionary, extra: Array = []) -> TileMapLayer:
	var layer := TileMapLayer.new()
	layer.name = "Fences"
	layer.y_sort_enabled = true
	layer.tile_set = _tileset()
	var cells := {}
	for style in fences:
		var flat: Array = fences[style]
		for i in range(0, flat.size(), 2):
			cells[Vector2i(flat[i], flat[i + 1])] = true
	for c in extra:
		cells[c] = true
	for c in cells:
		var m := 0
		if cells.has(c + Vector2i.UP): m |= N
		if cells.has(c + Vector2i.RIGHT): m |= E
		if cells.has(c + Vector2i.DOWN): m |= S
		if cells.has(c + Vector2i.LEFT): m |= W
		layer.set_cell(c, 0, Vector2i(m, 0))
	return layer


static var _ts: TileSet


static func images() -> Dictionary:
	var src := Pack.texture(SHEET).get_image()
	if src.is_compressed():
		src.decompress()
	src.convert(Image.FORMAT_RGBA8)
	# a short post: the top of the pack's post, then its dark foot
	var post := Image.create(4, POST_H, false, Image.FORMAT_RGBA8)
	post.blit_rect(src, Rect2i(POST.position, Vector2i(4, POST_H - 4)), Vector2i.ZERO)
	post.blit_rect(src, Rect2i(POST.position + Vector2i(0, POST.size.y - 4), Vector2i(4, 4)), Vector2i(0, POST_H - 4))
	var rail := src.get_region(RAIL)
	var bar := rail.duplicate()
	bar.rotate_90(CLOCKWISE)          # 6 x 16: a run of rails seen end-on
	return {"post": post, "rail": rail, "bar": bar}


static func _tileset() -> TileSet:
	if _ts:
		return _ts
	var im := images()
	var post: Image = im.post
	var rail: Image = im.rail
	var bar: Image = im.bar
	var atlas := Image.create(16 * 16, H, false, Image.FORMAT_RGBA8)
	var top := H - 2 - POST_H         # the post's top in the tile
	for m in 16:
		var o := Vector2i(m * 16, 0)
		# rails north and south first, so the post covers their ends
		if m & N:
			atlas.blend_rect(bar, Rect2i(0, 0, 6, top + 8), o + Vector2i(5, 0))
		if m & S:
			atlas.blend_rect(bar, Rect2i(0, 0, 6, H - top - 6), o + Vector2i(5, top + 6))
		for ry in [top + 3, top + 11]:
			if m & W:
				atlas.blend_rect(rail, Rect2i(8, 0, 8, 6), o + Vector2i(0, ry))
			if m & E:
				atlas.blend_rect(rail, Rect2i(0, 0, 8, 6), o + Vector2i(8, ry))
		atlas.blend_rect(post, Rect2i(0, 0, 4, POST_H), o + Vector2i(6, top))
	_ts = TileSet.new()
	_ts.tile_size = Vector2i(16, 16)
	_ts.add_physics_layer()
	_ts.set_physics_layer_collision_layer(0, 1)
	_ts.set_physics_layer_collision_mask(0, 0)
	var source := TileSetAtlasSource.new()
	source.texture = ImageTexture.create_from_image(atlas)
	source.texture_region_size = Vector2i(16, H)
	_ts.add_source(source, 0)
	for m in 16:
		var t := Vector2i(m, 0)
		source.create_tile(t)
		var d := source.get_tile_data(t, 0)
		d.texture_origin = Vector2i(0, (H - 16) / 2)
		d.y_sort_origin = 5
		# boxes in cell space (centre = 0,0): the post, and a strip along each rail
		var boxes := [Rect2(-3, 1, 6, 5)]
		if m & E: boxes.append(Rect2(0, 2, 8, 4))
		if m & W: boxes.append(Rect2(-8, 2, 8, 4))
		if m & N: boxes.append(Rect2(-2, -8, 4, 10))
		if m & S: boxes.append(Rect2(-2, 2, 4, 6))
		for b in boxes:
			var i := d.get_collision_polygons_count(0)
			d.add_collision_polygon(0)
			d.set_collision_polygon_points(0, i, PackedVector2Array([b.position, Vector2(b.end.x, b.position.y), b.end, Vector2(b.position.x, b.end.y)]))
	return _ts
