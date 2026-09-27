extends Node2D

func _ready() -> void:
	call_deferred("capture")

func caption(text: String, at: Vector2, size_px := 12) -> void:
	var label := Label.new()
	label.text = text
	label.position = at
	label.add_theme_font_size_override("font_size", size_px)
	label.modulate = Color("ead5a4")
	add_child(label)

func capture() -> void:
	Game.world = null

	caption("HEARTHWILD  /  STRAIN GROWTH", Vector2(22, 12), 16)
	var kinds := ["sativa", "hybrid", "indica"]
	for column in range(4):
		caption(["Sprout", "Leafing", "Budding", "Harvest"][column], Vector2(141 + 76 * column, 43), 10)
	for row in range(3):
		var kind: String = kinds[row]
		caption(kind.capitalize(), Vector2(24, 97 + row * 62))
		var days: int = Inventory.CROPS[kind].days
		var ages := [0, ceili(days / 3.0), ceili(days * 2.0 / 3.0), days]
		for column in range(4):
			var crop := Crop.new({"kind": kind, "age": ages[column]}, Vector2i.ZERO)
			crop.position = Vector2(159 + column * 76, 116 + row * 62)
			add_child(crop)
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var path := "C:/Users/lil_c/pixellab-recovery/crop-growth-game-refined.png"
	get_viewport().get_texture().get_image().save_png(path)
	print("CROP VISUAL: saved ", path)
	get_tree().quit()
