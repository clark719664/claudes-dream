import os

with open('game/tools/worldgen/build.py', 'r') as f:
    content = f.read()

target = "'Town Bathhouse': 'bathhouse'"
if target in content and "'Barn': 'barn'" not in content:
    content = content.replace(target, target + """,
        'Barn': 'barn',
        'Coop': 'coop',
        'Silo': 'silo',
        'Windmill': 'windmill',
        'Greenhouse': 'greenhouse',
        'Stone Well': 'well'""")
    with open('game/tools/worldgen/build.py', 'w') as f:
        f.write(content)

with open('game/tools/worldgen/farm.py', 'r') as f:
    farm = f.read()

target_barn = "a.add('house', hx + 12, hy, 0, 0, style='dark', name='Barn', gables=2)"
if target_barn in farm:
    # Let's replace the generic Barn house with B.lot so it uses the name_map logic!
    # Wait, build.py `house()` intercepts `name`! So `a.add('house', ..., name='Barn')` will actually call `house()` which checks `name_map`.
    # Let's also add Coop, Silo, Windmill, Greenhouse, Stone Well!
    additions = """    a.add('house', hx + 12, hy, 0, 0, name='Barn')
    a.add('house', hx + 20, hy, 0, 0, name='Coop')
    a.add('house', hx - 5, hy - 5, 0, 0, name='Silo')
    a.add('house', hx - 12, hy - 2, 0, 0, name='Windmill')
    a.add('house', hx + 15, hy - 8, 0, 0, name='Greenhouse')
    a.add('house', hx + 5, hy + 5, 0, 0, name='Stone Well')"""
    farm = farm.replace(target_barn, additions)
    with open('game/tools/worldgen/farm.py', 'w') as f:
        f.write(farm)
    print("Patched farm.py")
