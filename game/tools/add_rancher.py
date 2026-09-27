with open('game/scripts/inventory.gd', 'r') as f:
    content = f.read()

rancher_shop = """
	"rancher": {"title": "PEN RIDGE RANCH", "greet": "Animals for your farm. Treat them well.", "goods": [
		{"item": "chicken", "gold": 800},
		{"item": "duck", "gold": 1200},
		{"item": "cow", "gold": 1500},
		{"item": "sheep", "gold": 2000},
		{"item": "pig", "gold": 4000},
		{"item": "goat", "gold": 3000},
		{"item": "alpaca", "gold": 5000},
		{"item": "turkey", "gold": 2500}
	]},
	"smith": {
"""

if '"smith": {' in content:
    content = content.replace('"smith": {', rancher_shop)
    with open('game/scripts/inventory.gd', 'w') as f:
        f.write(content)
    print("Added rancher shop")
