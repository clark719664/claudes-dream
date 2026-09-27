extends Node2D

func _draw() -> void:
	draw_rect(Rect2(0,0,480,270), Color("b7cbb2"))
	draw_rect(Rect2(0,0,480,48), Color("a4c0b5"))
	draw_rect(Rect2(351,32,18,18), Color("f0df9e"))
	draw_rect(Rect2(347,36,26,10), Color("f0df9e"))
	var distant := PackedVector2Array([Vector2(0,122),Vector2(52,82),Vector2(97,111),Vector2(161,73),Vector2(211,106),Vector2(270,88),Vector2(328,120),Vector2(399,77),Vector2(480,112),Vector2(480,200),Vector2(0,200)])
	draw_colored_polygon(distant, Color("7d9e86"))
	var hills := PackedVector2Array([Vector2(0,157),Vector2(75,130),Vector2(125,149),Vector2(214,123),Vector2(297,153),Vector2(384,126),Vector2(480,151),Vector2(480,270),Vector2(0,270)])
	draw_colored_polygon(hills, Color("526f50"))
	draw_rect(Rect2(0,202,480,68), Color("526b39"))
	draw_colored_polygon(PackedVector2Array([Vector2(221,203),Vector2(240,203),Vector2(295,270),Vector2(211,270)]), Color("b59b65"))
	for i in 100:
		var x := (i * 83 + 17) % 480
		var y := 205 + (i * 31) % 65
		if x < 207 or x > 302:
			draw_line(Vector2(x,y), Vector2(x+1,y-3), Color("6f8649"), 1)
