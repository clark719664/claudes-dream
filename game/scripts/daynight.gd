class_name DayNight
extends CanvasModulate
## Tints the world with the time of day and turns fire light up at night.
## Indoors the light is warm and only dims a little after dark.

const DAY := Color(1, 1, 1)
const DUSK := Color(1.0, 0.78, 0.62)
const NIGHT := Color(0.32, 0.36, 0.58)
const INDOOR := Color(1.0, 0.94, 0.86)
const INDOOR_NIGHT := Color(0.62, 0.52, 0.48)


func _process(_delta: float) -> void:
	var d := Game.darkness()
	var indoors := Game.area == "cabin"
	if indoors:
		color = INDOOR.lerp(INDOOR_NIGHT, d)
	else:
		var sun := sin((Game.time_of_day - 0.25) * TAU)
		var c := DAY.lerp(DUSK, clampf(1.0 - absf(sun) * 2.5, 0.0, 1.0) * (1.0 - d))
		color = c.lerp(NIGHT, d)
	var lit := d > 0.05 or indoors
	for light in get_tree().get_nodes_in_group("night_lights"):
		light.enabled = lit
		light.energy = lerpf(0.35 if indoors else 0.0, 1.2, d)
