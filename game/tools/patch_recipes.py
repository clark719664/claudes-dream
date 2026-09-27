with open('game/scripts/inventory.gd', 'r') as f:
    c = f.read()

drinks = """
		{"out": "beer", "cost": {"barley": 2, "hops": 1}, "lv": 3, "st": 1, "desc": "Brew a cold one."},
		{"out": "wine", "cost": {"sugar": 2, "gem": 1}, "lv": 4, "st": 1, "desc": "A fine vintage."},
"""
if '"out": "beer"' not in c:
    c = c.replace('"kitchen": [', '"kitchen": [' + drinks)
    with open('game/scripts/inventory.gd', 'w') as f:
        f.write(c)
    print("Patched recipes")
