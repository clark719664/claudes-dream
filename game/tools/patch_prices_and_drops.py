with open('game/scripts/inventory.gd', 'r') as f:
    c = f.read()

prices_to_add = ', "beer": 200, "wine": 600, "barley": 20, "hops": 30, "sugar": 40, "hemp": 50, "indica": 80, "sativa": 80, "hybrid": 120, "joint": 120, "blunt": 200, "edible": 300, "golden_relic": 2000, "ancient_doll": 800, "dinosaur_egg": 1200, "strange_fossil": 500, "rusty_sword": 300'

if '"golden_relic": 2000' not in c:
    c = c.replace('"tonic_swift": 160', '"tonic_swift": 160' + prices_to_add)
    with open('game/scripts/inventory.gd', 'w') as f:
        f.write(c)
    print("Patched prices")

with open('game/scripts/harvestable.gd', 'r') as f:
    h = f.read()

artifact_drop = """
	if kind == "stone" and randf() < 0.08:
		var artifacts = ["ancient_doll", "dinosaur_egg", "rusty_sword", "golden_relic", "strange_fossil"]
		Game.world.drop(artifacts[randi() % artifacts.size()], 1, at)
"""
if 'artifacts = [' not in h:
    h = h.replace('if drop == "crystal" and randf() < 0.2:\n		Game.world.drop("gem", 1, at)', 'if drop == "crystal" and randf() < 0.2:\n		Game.world.drop("gem", 1, at)' + artifact_drop)
    with open('game/scripts/harvestable.gd', 'w') as f:
        f.write(h)
    print("Patched harvestable.gd")
