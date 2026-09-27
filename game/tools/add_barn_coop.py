with open("game/scripts/inventory.gd", "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace('{"item": "fence", "gold": 8, "n": 1}', '{"item": "fence", "gold": 8, "n": 1},\n\t\t{"item": "barn", "gold": 6000, "cost": {"wood": 350, "stone": 150}},\n\t\t{"item": "coop", "gold": 4000, "cost": {"wood": 300, "stone": 100}}')

with open("game/scripts/inventory.gd", "w", encoding="utf-8") as f:
    f.write(text)
print("Updated inventory.gd")
