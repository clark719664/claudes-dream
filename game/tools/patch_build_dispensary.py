with open('game/tools/worldgen/build.py', 'r') as f:
    b = f.read()

if "'Green Thumb Dispensary': 'dispensary'," not in b:
    b = b.replace("'Medical Clinic': 'clinic',", "'Medical Clinic': 'clinic',\n        'Green Thumb Dispensary': 'dispensary',")
    with open('game/tools/worldgen/build.py', 'w') as f:
        f.write(b)
    print("Patched build.py")
