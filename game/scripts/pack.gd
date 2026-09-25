extends Node
## Cuts sprites, animations and icons out of the Pixel Crawler pack, as described by data/catalog.json.

const PACK_DIR := "res://assets/Pixel Crawler - Free Pack/"

var catalog: Dictionary = {}
var ok := false
var font: FontFile

var _textures := {}
var _frames := {}
var _slash: Array[Texture2D] = []


func _ready() -> void:
	catalog = JSON.parse_string(FileAccess.get_file_as_string("res://data/catalog.json"))
	ok = ResourceLoader.exists(PACK_DIR + "Environment/Tilesets/Floors_Tiles.png")
	font = load("res://ui/Silkscreen-Regular.ttf")
	font.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	font.hinting = TextServer.HINTING_NONE
	font.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	ThemeDB.fallback_font = font
	ThemeDB.fallback_font_size = 8


func texture(sheet: String) -> Texture2D:
	if not _textures.has(sheet):
		var custom_path := "res://assets/" + sheet
		if ResourceLoader.exists(custom_path):
			_textures[sheet] = load(custom_path)
		else:
			_textures[sheet] = load(PACK_DIR + sheet)
	return _textures[sheet]


func has_sprite(name: String) -> bool:
	return catalog.sprites.has(name)


func spec(name: String, variant := 0) -> Dictionary:
	var variants: Array = catalog.sprites[name]
	return variants[clampi(variant, 0, variants.size() - 1)]


func variant_count(name: String) -> int:
	return catalog.sprites[name].size()


func atlas(s: Dictionary) -> AtlasTexture:
	var r: Array = s.region
	var t := AtlasTexture.new()
	t.atlas = texture(s.sheet)
	t.region = Rect2(r[0], r[1], r[2] - r[0], r[3] - r[1])
	return t


## A Sprite2D whose origin sits at the art's feet (or centre for flat things).
func sprite(name: String, variant := 0) -> Sprite2D:
	var s := spec(name, variant)
	var node := Sprite2D.new()
	node.texture = atlas(s)
	node.centered = false
	node.offset = -Vector2(s.anchor[0], s.anchor[1])
	for part in s.get("parts", []):
		var p := Sprite2D.new()
		p.texture = atlas({"sheet": s.sheet, "region": part.region})
		p.centered = false
		p.offset = node.offset + Vector2(part.at[0], part.at[1])
		node.add_child(p)
	return node


func icon(item: String) -> Texture2D:
	return atlas(catalog.items[item])


## SpriteFrames with idle / run / death for one of the characters.
func frames(actor: String) -> SpriteFrames:
	if _frames.has(actor):
		return _frames[actor]
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	var anims: Dictionary = catalog.actors[actor]
	for anim_name in anims:
		_add_anim(sf, anim_name, anims[anim_name])
	_frames[actor] = sf
	return sf


func anim_frames(anim_name: String) -> SpriteFrames:
	var key := "anim:" + anim_name
	if not _frames.has(key):
		var sf := SpriteFrames.new()
		sf.remove_animation("default")
		_add_anim(sf, "default", catalog.anims[anim_name])
		_frames[key] = sf
	return _frames[key]


func station_spec(station: String, tier: int) -> Dictionary:
	var tiers: Array = catalog.stations[station]
	return tiers[clampi(tier, 1, tiers.size()) - 1]


func station_tiers(station: String) -> int:
	return catalog.stations[station].size() if catalog.stations.has(station) else 1


## A node showing a station at a tier: animated if the pack animates it.
func station_visual(station: String, tier: int) -> Node2D:
	var s := station_spec(station, tier)
	if s.has("frames"):
		var key := "station:%s:%d" % [station, tier]
		if not _frames.has(key):
			var sf := SpriteFrames.new()
			sf.remove_animation("default")
			_add_anim(sf, "default", s)
			_frames[key] = sf
		var a := AnimatedSprite2D.new()
		a.sprite_frames = _frames[key]
		a.centered = false
		a.offset = -Vector2(s.anchor[0], s.anchor[1])
		a.play("default")
		a.frame = randi() % int(s.frames)
		return a
	var sp := Sprite2D.new()
	sp.texture = atlas(s)
	sp.centered = false
	sp.offset = -Vector2(s.anchor[0], s.anchor[1])
	return sp


## Any looping animation from catalog.anims as a ready-to-add node.
func anim_node(anim_name: String) -> AnimatedSprite2D:
	var a := AnimatedSprite2D.new()
	a.sprite_frames = anim_frames(anim_name)
	a.centered = false
	a.offset = -anim_anchor(anim_name)
	a.play("default")
	a.frame = randi() % a.sprite_frames.get_frame_count("default")
	return a


func anchor(actor: String, anim_name: String) -> Vector2:
	var a: Array = catalog.actors[actor][anim_name].anchor
	return Vector2(a[0], a[1])


## Sprite offset that keeps the feet on the node origin, also when mirrored.
func actor_offset(actor: String, anim_name: String, flipped: bool) -> Vector2:
	var a: Dictionary = catalog.actors[actor][anim_name]
	var ax: float = a.anchor[0]
	if flipped:
		ax = a.frame[0] - ax
	return Vector2(-ax, -a.anchor[1])


func anim_anchor(anim_name: String) -> Vector2:
	var a: Array = catalog.anims[anim_name].anchor
	return Vector2(a[0], a[1])


func _add_anim(sf: SpriteFrames, anim_name: String, a: Dictionary) -> void:
	sf.add_animation(anim_name)
	sf.set_animation_speed(anim_name, a.fps)
	sf.set_animation_loop(anim_name, a.loop)
	var tex := texture(a.sheet)
	var fw: int = a.frame[0]
	var fh: int = a.frame[1]
	var cols := int(a.get("cols", a.frames))
	for i in int(a.frames):
		var t := AtlasTexture.new()
		t.atlas = tex
		t.region = Rect2((i % cols) * fw, (i / cols) * fh, fw, fh)
		sf.add_frame(anim_name, t)


## The white crescent from the base body's swing animation, cut free of the body.
func slash_frames() -> Array[Texture2D]:
	if not _slash.is_empty():
		return _slash
	var s: Dictionary = catalog.slash
	var img := texture(s.sheet).get_image()
	if img.is_compressed():
		img.decompress()
	var fw: int = s.frame[0]
	var fh: int = s.frame[1]
	for f in s.frames:
		var out := Image.create(fw, fh, false, Image.FORMAT_RGBA8)
		for y in fh:
			for x in fw:
				var c := img.get_pixel(int(f) * fw + x, y)
				if c.a > 0.5 and c.r > 0.8 and c.g > 0.8 and c.b > 0.8:
					out.set_pixel(x, y, Color(1, 1, 1, c.a))
		var used := out.get_used_rect()
		_slash.append(ImageTexture.create_from_image(out.get_region(used)))
	return _slash
