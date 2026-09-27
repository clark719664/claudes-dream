import os

with open('game/scripts/player.gd', 'r') as f:
    content = f.read()

target = """var o := {"t": "custom_building", "kind": item, "x": cell.x * 16 + 84, "y": cell.y * 16 + 144}"""
replacement = """var o := {"t": "custom_building", "kind": item, "x": cell.x * 16 + 8, "y": cell.y * 16 + 14}"""

if target in content:
    content = content.replace(target, replacement)
    with open('game/scripts/player.gd', 'w') as f:
        f.write(content)
    print("Fixed custom_building offset in player.gd")
