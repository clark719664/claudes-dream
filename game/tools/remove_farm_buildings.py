import os

with open('game/tools/worldgen/farm.py', 'r') as f:
    farm = f.read()

target_barn = """    a.add('house', hx + 12, hy, 0, 0, name='Barn')
    a.add('house', hx + 20, hy, 0, 0, name='Coop')
    a.add('house', hx - 5, hy - 5, 0, 0, name='Silo')
    a.add('house', hx - 12, hy - 2, 0, 0, name='Windmill')
    a.add('house', hx + 15, hy - 8, 0, 0, name='Greenhouse')
    a.add('house', hx + 5, hy + 5, 0, 0, name='Stone Well')"""

if target_barn in farm:
    farm = farm.replace(target_barn, "")
    with open('game/tools/worldgen/farm.py', 'w') as f:
        f.write(farm)
    print("Removed hardcoded farm buildings from farm.py")
