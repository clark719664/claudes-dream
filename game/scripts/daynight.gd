class_name DayNight
extends CanvasModulate
## Tints the world with the time of day and turns fire light up at night.

const DAY := Color(1, 1, 1)
const DUSK := Color(1.0, 0.78, 0.62)
const NIGHT := Color(0.32, 0.36, 0.58)


func _process(_delta: float) -> void:
	var d := Game.darkness()
	var sun := sin((Game.time_of_day - 0.25) * TAU)
	var c := DAY.lerp(DUSK, clampf(1.0 - absf(sun) * 2.5, 0.0, 1.0) * (1.0 - d))
	color = c.lerp(NIGHT, d)
	for light in get_tree().get_nodes_in_group("night_lights"):
		light.enabled = d > 0.05
		light.energy = lerpf(0.0, 1.2, d)
