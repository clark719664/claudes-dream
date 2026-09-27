import sys

with open('town.py', 'r') as f:
    content = f.read()

target = "B.lot(a, 91, MAIN, 12, 'log', 'The Coopers', 'woodpile')"
replacement = "B.lot(a, 91, MAIN, 12, 'log', 'The Coopers', 'woodpile')\n    door2 = B.lot(a, 105, MAIN, 12, 'plank', 'Pen Ridge Ranch', dress=False)\n    B.shopkeeper(a, door2 + 2.6, MAIN - 3.4, 'player_male', 'Pen Ridge', 'rancher')"

if target in content:
    content = content.replace(target, replacement)
    with open('town.py', 'w') as f:
        f.write(content)
    print("Patched town.py successfully.")
else:
    print("Could not find target in town.py")
