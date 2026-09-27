class_name Npc
extends Node2D
## Friendly characters. They face you when you're near, some stroll back and forth,
## and E starts a conversation that cycles through their lines.

const LINES := {
	"merlo": [
		"Ah, you're the one who took on the old farm west of town. It'll take a season to clear, but the soil there is good.",
		"Pell at the general store sells seeds for whatever season it is. Crops out of season wither overnight, so mind the calendar.",
		"Tilda sells kits for a workbench, a sawmill, a furnace. Set them up on your farm and you'll be making your own tools.",
		"There are springs hidden deep in the woods. A drink from one and you'll feel you could work another whole day.",
		"The Old Mine is up the mountain road north of here. Iron, coal, crystal - and things that don't like visitors.",
		"Orcs hold the badlands to the east. Stonegate beyond them keeps its gate shut at the first sign of trouble.",
	],
	"guard": [
		"Brindle watch. Orcs have been raiding the east road - if you're heading that way, bring iron.",
		"Watch their shoulders. An orc flashes right before it lunges. Step aside, then strike.",
		"Iron ore pokes out of the mountain and the quarry up there. The Old Mine has more, deeper down.",
	],
	"hunter": [
		"Rook. I cut wood in the Pinewood. Skeletons walk around the old ruin up north - I keep clear.",
		"Pine trees drip resin when you chop them. Good for torches and glue.",
		"Fiber from bushes twists into rope. Rope ties a stone to a stick, and you've got an axe.",
	],
	"fisher": [
		"Old Fenn. I've fished Mirror Lake for forty years. The river feeding it comes all the way down from Brindle.",
		"There's a spring in the woods east of the lake. Drink from it and you'll walk home lighter.",
	],
	"carpenter": [
		"Tilda, carpenter. Show me materials and I'll show you a house.",
	],
	"villager": [
		"Lovely day for it.",
		"Have you tried the stew? Two vegetables and a good fire.",
		"My gran says the stone circle in the south hums at night.",
		"They say the quarry skeletons are still digging. For what, nobody knows.",
	],
	"mayor": [
		"Mayor Holt, at your service! Brindle Valley is growing faster than ever since you took over the old homestead.",
		"Speak with the folks around the square - everyone here has a trade, a story, and a favorite gift.",
	],
	"herbalist": [
		"I'm Wren! I gather wild herbs and mushrooms along the forest edge before the morning dew dries.",
		"Brewing a Health Tonic at your Alchemy Bench takes fresh herbs and a clean glass vial. Never enter the mines without one!",
	],
	"barkeep": [
		"Name's Cass! Pull up a bench by the fire. Nothing beats a hot skewer and stew after a long day chopping timber.",
		"Folks gather around the square in the evening to unwind and trade stories.",
	],
	"farmer": [
		"Howdy, neighbor! Farmer Dell here. Keep your rows tilled and harvest on time, and that soil will treat you right.",
		"Garlic and cabbage hold up best when the chill winds blow down from Frostvale.",
	],
	"tailor": [
		"Patch Silas, master tailor! Spin plant fiber into twine, weave twine into cloth, and you'll have fine gear in no time.",
	],
	"busker": [
		"Hey there! I'm Rio. Every good frontier town needs a little guitar music in the square to keep spirits high!",
	],
	"fortune": [
		"I am Moth... The crystal ball whispers of ancient crystal veins sleeping beneath the southern stone circle.",
	],
	"archivist": [
		"Archivist Sloane. I've been cataloging the inscriptions around the old ruins and the founders' graveyard.",
	],
	"elder": [
		"Elder Grain... I remember when the Old Mine still rang with pickaxes. Guard your lantern well when night falls.",
	],
	"nurse": [
		"Hi, I'm Nurse Mira! If you get roughed up by Orcs in the east basin, eat a hearty meal or rest in your cabin bed to recover.",
	],
	"grocer": [
		"Welcome to the market! I'm Elena. Fresh carrots, beets, and cauliflower straight from the valley's gardens!",
	],
	"rancher": [
		"Pen Ridge, ranch hand. The south meadows have the sweetest grass in the whole valley.",
	],
}


const HEART_LINES := {
	"elena": {
		2: ["I'm starting to think you're not so bad for a newcomer.", "The weather is nice today, don't you think?"],
		4: ["I usually don't talk to strangers this much... but you're different.", "I'm glad you moved here."],
		6: ["Have I ever told you why I opened this market? ...No, it's nothing.", "You always know how to make me smile."],
		8: ["You're the brightest part of my day, you know that?", "I... I really look forward to your visits."],
		10: ["I can't imagine this valley without you.", "I love you."]
	},
	"wren": {
		2: ["The woods are quiet today.", "You have a good step for the forest."],
		4: ["Most people stay away from the deep woods. You're brave.", "I found a rare mushroom today... I'll show you sometime."],
		6: ["The animals seem to like you. That says a lot.", "I feel... comfortable, when you're around."],
		8: ["I never thought I'd want someone to join me in the wild... until you.", "You've captured my heart."],
		10: ["Together, we belong to the forest.", "I love you."]
	},
	"pell": {
		2: ["You're doing good work on that old farm.", "Need any more seeds?"],
		4: ["My grandfather used to farm that land. It's good to see it alive again.", "You're a hard worker."],
		6: ["If you ever need a break from farming, you're always welcome to chat.", "Business is better since you arrived."],
		8: ["I've been thinking about you a lot lately...", "You're very special to me."],
		10: ["Every day with you is a blessing.", "I love you."]
	}
}

const LOVES := {
	"mayor_holt": ["crystal_amulet", "cake", "wine"],
	"barkeep_cass": ["ale", "mead", "stew"],
	"farmer_dell": ["pumpkin", "melon", "corn"],
	"wren": ["health_potion", "wild_mushroom", "flower"],
	"elena": ["carrot", "tomato", "salad"],
}

const SCHEDULES = {
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

const HATES := {
	"mayor_holt": ["slime", "bone", "bat_wing"],
	"elena": ["stone", "wood", "coal"],
	"wren": ["meat", "cooked_meat"],
}


var target_pos := Vector2.INF
var current_schedule := ""

var actor: String
var display_name: String
var lines_key: String
var custom: Array = []      # lines of its own, instead of a shared set
var shop := ""              # a shopkeeper: talking opens their shop
var span := 0.0
var body: AnimatedSprite2D
var _line := 0
var _home := Vector2.ZERO
var _target := 0.0
var _wait := 0.0
var _anim := ""


func _init(actor_name := "wizard", name_ := "Stranger", lines := "villager", walk_span := 0.0) -> void:
	actor = actor_name
	display_name = name_
	lines_key = lines
	span = walk_span


func _ready() -> void:
	_home = position
	add_to_group("interactable")
	var sh := Pack.sprite("shadow_actor")
	sh.z_index = -1
	add_child(sh)
	body = AnimatedSprite2D.new()
	body.sprite_frames = Pack.frames(actor)
	body.centered = false
	add_child(body)
	_play("idle")
	if span <= 0.0:
		var blocker := StaticBody2D.new()
		blocker.collision_layer = 1
		blocker.add_child(World.foot_shape(5))
		add_child(blocker)
	_wait = randf_range(0.5, 3.0)


func _process(delta: float) -> void:
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

func _face(left: bool) -> void:
	if left != body.flip_h:
		body.flip_h = left
		body.offset = Pack.actor_offset(actor, _anim, left)


func _play(anim: String) -> void:
	if anim == _anim:
		return
	_anim = anim
	body.play(anim)
	body.offset = Pack.actor_offset(actor, anim, body.flip_h)


func interact(_player: Node) -> void:
	var item = _player.selected()
	if item != "" and not item in Inventory.TOOLS and not item in Inventory.WEAPONS and not item in Inventory.AXES and not item in Inventory.PICKAXES:
		if not Game.relationships.has(actor):
			Game.relationships[actor] = {"hearts": 0, "gifted_today": false, "status": "single"}
		var rel = Game.relationships[actor]
		
		if item == "sunforged_ring":
			if rel.get("hearts", 0) == 10 and rel.get("status", "single") == "dating":
				Game.hud.show_dialog(display_name, "A Sunforged Ring... Oh my goodness! Yes, I will marry you!")
				rel["status"] = "married"
				Game.relationships[actor] = rel
				Inventory.take(item)
			else:
				Game.hud.show_dialog(display_name, "I... I don't think we're ready for this step yet.")
			_face(_player.global_position.x < global_position.x)
			return
			
		if item == "bouquet":
			if rel.get("hearts", 0) == 8 and rel.get("status", "single") == "single":
				Game.hud.show_dialog(display_name, "A bouquet? For me? I... I have feelings for you too.")
				rel["status"] = "dating"
				Game.relationships[actor] = rel
				Inventory.take(item)
			else:
				Game.hud.show_dialog(display_name, "Oh, flowers! How nice.")
				rel["hearts"] = min(8, rel.get("hearts", 0) + 1)
				Inventory.take(item)
			_face(_player.global_position.x < global_position.x)
			return
		
		if rel.get("gifted_today", false):
			Game.hud.show_dialog(display_name, "You already gave me a gift today. But thank you!")
			return
			
		var pref = "like"
		if LOVES.has(actor) and item in LOVES[actor]: pref = "love"
		if HATES.has(actor) and item in HATES[actor]: pref = "hate"
		
		var max_hearts = 10 if rel.get("status", "single") in ["dating", "married"] else 8
		
		if pref == "love":
			Game.hud.show_dialog(display_name, "Oh wow, I absolutely love this! Thank you so much!")
			rel["hearts"] = min(max_hearts, rel.get("hearts", 0) + 2)
		elif pref == "hate":
			Game.hud.show_dialog(display_name, "Ew... what am I supposed to do with this?")
			rel["hearts"] = max(0, rel.get("hearts", 0) - 1)
		else:
			Game.hud.show_dialog(display_name, "Thank you, that's very kind.")
			rel["hearts"] = min(max_hearts, rel.get("hearts", 0) + 1)
			
		rel["gifted_today"] = true
		Game.relationships[actor] = rel
		Inventory.take(item)
		_face(_player.global_position.x < global_position.x)
		return

	if shop != "":
		Game.hud.open_shop(shop, display_name)
		return
	
	var lines: Array = custom if not custom.is_empty() else LINES.get(lines_key, LINES.villager)
	
	# Override with heart lines if applicable
	var rel = Game.relationships.get(actor, {})
	var hearts = rel.get("hearts", 0)
	if HEART_LINES.has(actor):
		# Find highest unlocked heart tier
		var unlocked_tier = 0
		for tier in HEART_LINES[actor].keys():
			if hearts >= tier and tier > unlocked_tier:
				unlocked_tier = tier
		if unlocked_tier > 0:
			lines = HEART_LINES[actor][unlocked_tier]
			
	Game.hud.show_dialog(display_name, lines[_line % lines.size()])
	_line += 1
