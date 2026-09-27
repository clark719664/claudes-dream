with open('game/scripts/cabin_fixture.gd', 'r') as f:
    c = f.read()

bathhouse = """		"bathhouse_pool":
			var best_actor := ""
			for actor in Game.relationships.keys():
				var rel: Dictionary = Game.relationships[actor]
				if rel.get("status", "") in ["dating", "married"]:
					best_actor = actor
			if best_actor != "" and Game.energy > 0:
				Game.hud.confirm("Get freaky with your partner in the pool? (Drains stamina completely, adds 1 heart)", func():
					Game.energy = 0
					var rel = Game.relationships[best_actor]
					rel["hearts"] = min(10, rel.get("hearts", 0) + 1)
					Game.relationships[best_actor] = rel
					Game.say("It got steamy... you are completely exhausted.")
					Game.hud.area_changed()
				)
			else:
				Game.hud.confirm("Bathe in the restorative waters for 50g? (Regenerates full stamina)", func():
					if Game.gold >= 50:
						Game.gold -= 50
						Game.energy = Game.MAX_ENERGY
						Game.say("You feel completely refreshed.")
						Game.hud.area_changed()
					else:
						Game.say("You need 50g.")
				)"""

if '"bathhouse_pool":' not in c:
    c = c.replace('"alchemy":', bathhouse + '\n\t\t"alchemy":')
    with open('game/scripts/cabin_fixture.gd', 'w') as f:
        f.write(c)
        
with open('game/scripts/interior.gd', 'r') as f:
    intg = f.read()

# Add bathhouse_pool to role list in interior.gd
if '"bathhouse_pool"' not in intg:
    intg = intg.replace('if role in ["bed", "kitchen", "alchemy"]:', 'if role in ["bed", "kitchen", "alchemy", "bathhouse_pool"]:')
    with open('game/scripts/interior.gd', 'w') as f:
        f.write(intg)

print("Patched cabin_fixture.gd and interior.gd")
