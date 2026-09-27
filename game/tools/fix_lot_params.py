with open('game/tools/worldgen/town.py', 'r') as f:
    t = f.read()

t = t.replace("B.lot(a, 64, SOUTH, 12, 10, 'Green Thumb Dispensary', style='wood')", "B.lot(a, 64, SOUTH, 12, 'wood', 'Green Thumb Dispensary')")
t = t.replace("B.lot(a, 48, MAIN, 12, 10, 'Medical Clinic', style='wood')", "B.lot(a, 48, MAIN, 12, 'wood', 'Medical Clinic')")
t = t.replace("B.lot(a, 78, SOUTH, 14, 11, 'Town Museum', style='stone')", "B.lot(a, 78, SOUTH, 14, 'stone', 'Town Museum')")

with open('game/tools/worldgen/town.py', 'w') as f:
    f.write(t)
    
print("Fixed lot parameters")
