with open('game/scripts/npc.gd', 'r', encoding='utf-8') as f:
    text = f.read()

sched_vars = """
var target_pos := Vector2.INF
var current_schedule := ""
"""

if "var target_pos" not in text:
    text = text.replace('var actor: String', sched_vars + 'var actor: String')

process_old = """func _process(delta: float) -> void:
	var p := Game.player
	var close := p != null and p.global_position.distance_to(global_position) < 40.0
	if span > 0.0 and not close:
		if _wait > 0.0:
			_wait -= delta
			_play("idle")
		else:
			var goal := _home.x + _target
			var dx := goal - position.x
			if absf(dx) < 1.0:
				_wait = randf_range(1.5, 4.0)
				_target = randf_range(-span, span) * 0.5
			else:
				position.x += signf(dx) * minf(absf(dx), 22.0 * delta)
				_face(dx < 0)
				_play("run")
	else:
		_play("idle")
		if p:
			_face(p.global_position.x < global_position.x)"""

process_new = """func _process(delta: float) -> void:
	var p := Game.player
	var close := p != null and p.global_position.distance_to(global_position) < 40.0
	
	if target_pos != Vector2.INF and not close:
		var dist = position.distance_to(target_pos)
		if dist < 2.0:
			target_pos = Vector2.INF
			_play("idle")
			_face(randf() > 0.5)
		else:
			var dir = (target_pos - position).normalized()
			position += dir * 22.0 * delta
			_face(dir.x < 0)
			_play("run")
	elif span > 0.0 and not close:
		if _wait > 0.0:
			_wait -= delta
			_play("idle")
		else:
			var goal := _home.x + _target
			var dx := goal - position.x
			if absf(dx) < 1.0:
				_wait = randf_range(1.5, 4.0)
				_target = randf_range(-span, span) * 0.5
			else:
				position.x += signf(dx) * minf(absf(dx), 22.0 * delta)
				_face(dx < 0)
				_play("run")
	else:
		_play("idle")
		if p:
			_face(p.global_position.x < global_position.x)"""

text = text.replace(process_old, process_new)

with open('game/scripts/npc.gd', 'w', encoding='utf-8') as f:
    f.write(text)
print('Schedules added to npc.gd!')
