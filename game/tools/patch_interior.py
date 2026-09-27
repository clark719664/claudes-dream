import sys

with open('game/scripts/interior.gd', 'r') as f:
    content = f.read()

target = "const LAYOUTS := {"
replacement = """const LAYOUTS := {
	"barn": {"wall": 4, "floor": 6, "w": 12, "h": 6, "props": []},
	"coop": {"wall": 0, "floor": 0, "w": 8, "h": 5, "props": []},"""

if target in content:
    content = content.replace(target, replacement)
    with open('game/scripts/interior.gd', 'w') as f:
        f.write(content)
    print("Patched interior.gd successfully.")
else:
    print("Could not find target in interior.gd")
