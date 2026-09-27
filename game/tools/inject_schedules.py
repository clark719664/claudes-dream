import re

def main():
    with open('game/scripts/npc.gd', 'r', encoding='utf-8') as f:
        content = f.read()

    schedules_dict = """const SCHEDULES = {
	"wren": [
		{"time": 0.25, "offset": Vector2(0, 0), "anim": "idle"},
		{"time": 0.40, "offset": Vector2(-150, 50), "anim": "idle"},
		{"time": 0.75, "offset": Vector2(0, 0), "anim": "idle"}
	],
	"farmer_dell": [
		{"time": 0.25, "offset": Vector2(0, 0), "anim": "idle"},
		{"time": 0.45, "offset": Vector2(200, 0), "anim": "idle"},
		{"time": 0.65, "offset": Vector2(-100, 100), "anim": "idle"}
	],
	"mayor_holt": [
		{"time": 0.25, "offset": Vector2(0, 0), "anim": "idle"},
		{"time": 0.50, "offset": Vector2(100, 150), "anim": "idle"},
		{"time": 0.80, "offset": Vector2(0, 0), "anim": "idle"}
	],
	"barkeep_cass": [
		{"time": 0.25, "offset": Vector2(0, 0), "anim": "idle"},
		{"time": 0.60, "offset": Vector2(50, -50), "anim": "idle"},
		{"time": 0.85, "offset": Vector2(0, 0), "anim": "idle"}
	],
	"tilda": [
		{"time": 0.25, "offset": Vector2(0, 0), "anim": "idle"},
		{"time": 0.45, "offset": Vector2(-50, -50), "anim": "idle"},
		{"time": 0.70, "offset": Vector2(150, 0), "anim": "idle"}
	],
	"elena": [
		{"time": 0.25, "offset": Vector2(0, 0), "anim": "idle"},
		{"time": 0.40, "offset": Vector2(80, 80), "anim": "idle"},
		{"time": 0.70, "offset": Vector2(0, 0), "anim": "idle"}
	],
	"pell": [
		{"time": 0.25, "offset": Vector2(0, 0), "anim": "idle"},
		{"time": 0.50, "offset": Vector2(-120, 0), "anim": "idle"},
		{"time": 0.80, "offset": Vector2(0, 0), "anim": "idle"}
	]
}
"""
    if "const SCHEDULES" not in content:
        content = content.replace("const HATES = {", schedules_dict + "\nconst HATES = {")

    process_new = """func _process(delta: float) -> void:
	var p := Game.player
	var close := p != null and p.global_position.distance_to(global_position) < 40.0
	
	if Game.has_method("get_time_of_day"):
		pass # Just to make sure we don't crash if we need to access game time
	
	var t = Game.time_of_day
	if SCHEDULES.has(actor):
		var sched = SCHEDULES[actor]
		var best_idx = 0
		for i in range(sched.size()):
			if t >= sched[i].time:
				best_idx = i
		
		if current_schedule != str(best_idx):
			current_schedule = str(best_idx)
			target_pos = _home + sched[best_idx].offset
	
	if target_pos != Vector2.INF and not close:
		var dist = position.distance_to(target_pos)
		if dist < 2.0:
			# Reached target schedule spot
			_play("idle")
			_face(randf() > 0.5)
		else:
			var dir = (target_pos - position).normalized()
			position += dir * 22.0 * delta
			_face(dir.x < 0)
			_play("run")
	elif span > 0.0 and not close and target_pos == Vector2.INF:
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
			_face(p.global_position.x < global_position.x)
"""
    
    # Replace the existing _process function using regex
    content = re.sub(r'func _process\(delta: float\) -> void:.*?(?=\nfunc _face)', process_new, content, flags=re.DOTALL)

    with open('game/scripts/npc.gd', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Injected SCHEDULES into npc.gd!")

if __name__ == '__main__':
    main()
