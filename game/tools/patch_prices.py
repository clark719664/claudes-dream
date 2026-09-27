with open('game/scripts/inventory.gd', 'r') as f:
    c = f.read()

prices_to_add = ', "beer": 200, "wine": 600, "barley": 20, "hops": 30, "sugar": 40, "hemp": 50, "indica": 80, "sativa": 80, "hybrid": 120, "joint": 120, "blunt": 200, "edible": 300, "golden_relic": 2000, "ancient_doll": 800, "dinosaur_egg": 1200, "strange_fossil": 500, "rusty_sword": 300'

if '"golden_relic":' not in c:
    c = c.replace('"tonic_swift": 160,', '"tonic_swift": 160' + prices_to_add + ',')
    with open('game/scripts/inventory.gd', 'w') as f:
        f.write(c)
    print("Patched prices")
