import os

with open('game/tools/worldgen/town.py', 'r') as f:
    t = f.read()

# Change Cass to 'saloon'
t = t.replace("'Cass', 'barkeep')", "'Cass', 'saloon')")

# Add Dispensary lot
if 'Green Thumb Dispensary' not in t:
    disp_lot = """
    door = B.lot(a, 64, SOUTH, 12, 10, 'Green Thumb Dispensary', style='wood')
    B.shopkeeper(a, door + 2.6, SOUTH - 3.4, 'peasant', 'Snoop', 'dispensary')
"""
    t = t.replace("B.shopkeeper(a, door2 + 2.6, MAIN - 3.4, 'peasant', 'Pen Ridge', 'rancher')", "B.shopkeeper(a, door2 + 2.6, MAIN - 3.4, 'peasant', 'Pen Ridge', 'rancher')" + disp_lot)

# Add Museum and Clinic shopkeepers
if 'Nurse Mira' not in t:
    t = t.replace("door = B.lot(a, 48, MAIN, 12, 10, 'Medical Clinic', style='wood')", "door = B.lot(a, 48, MAIN, 12, 10, 'Medical Clinic', style='wood')\n    B.shopkeeper(a, door + 2.6, MAIN - 3.4, 'peasant', 'Nurse Mira', 'clinic')")
    t = t.replace("door = B.lot(a, 78, SOUTH, 14, 11, 'Town Museum', style='stone')", "door = B.lot(a, 78, SOUTH, 14, 11, 'Town Museum', style='stone')\n    B.shopkeeper(a, door + 2.6, SOUTH - 3.4, 'peasant', 'Gunther', 'museum')")

with open('game/tools/worldgen/town.py', 'w') as f:
    f.write(t)
    
print("Patched town.py")
