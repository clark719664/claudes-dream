import os
import re

with open('game/scripts/inventory.gd', 'r') as f:
    content = f.read()

# Add crops
crops_to_add = """
	"barley": {"grow": 4, "regrow": 0, "season": 1, "yield": 2},
	"hops": {"grow": 5, "regrow": 2, "season": 1, "yield": 1},
	"sugar": {"grow": 6, "regrow": 3, "season": 2, "yield": 1},
	"hemp": {"grow": 4, "regrow": 2, "season": 0, "yield": 2},
	"indica": {"grow": 5, "regrow": 2, "season": 0, "yield": 1},
	"sativa": {"grow": 5, "regrow": 2, "season": 1, "yield": 1},
	"hybrid": {"grow": 6, "regrow": 3, "season": 2, "yield": 1},"""
if '"barley":' not in content:
    content = content.replace('const CROP_DATA := {', 'const CROP_DATA := {' + crops_to_add)

# Add food
food_to_add = ',"beer": 20, "wine": 40, "edible": 50, "joint": 10, "blunt": 20'
if '"beer":' not in content:
    content = content.replace('"cooked_meat": 40', '"cooked_meat": 40' + food_to_add)

# Add tints
tints_to_add = """, "beer": Color(1.0, 0.9, 0.4), "wine": Color(0.8, 0.2, 0.5), "barley_seed": Color(0.9, 0.8, 0.4), "hops_seed": Color(0.5, 0.9, 0.5), "sugar_seed": Color(0.9, 0.9, 0.9), "hemp_seed": Color(0.3, 0.6, 0.3), "indica_seed": Color(0.6, 0.3, 0.8), "sativa_seed": Color(0.4, 0.8, 0.4), "hybrid_seed": Color(0.3, 0.8, 0.8), "barley": Color(0.9, 0.8, 0.4), "hops": Color(0.5, 0.9, 0.5), "sugar": Color(1.0, 1.0, 1.0), "hemp": Color(0.3, 0.6, 0.3), "indica": Color(0.6, 0.3, 0.8), "sativa": Color(0.4, 0.8, 0.4), "hybrid": Color(0.3, 0.8, 0.8), "joint": Color(0.9, 0.9, 0.9), "blunt": Color(0.6, 0.4, 0.2), "edible": Color(0.6, 0.8, 0.4), "ancient_doll": Color(0.7, 0.7, 0.7), "dinosaur_egg": Color(0.4, 0.8, 0.4), "rusty_sword": Color(0.6, 0.4, 0.2), "golden_relic": Color(1.0, 0.9, 0.2), "strange_fossil": Color(0.7, 0.5, 0.8)"""
if '"beer": Color' not in content:
    content = content.replace('Color(0.8, 0.86, 1.0)}', 'Color(0.8, 0.86, 1.0)' + tints_to_add + '}')

# Add shops
shops_to_add = """
	"saloon": {"title": "THE STARDROP SALOON", "greet": "Care for a drink? Or something stronger?", "goods": [
		{"item": "beer", "gold": 400},
		{"item": "wine", "gold": 1000},
		{"item": "barley_seed", "gold": 50},
		{"item": "hops_seed", "gold": 60},
		{"item": "sugar_seed", "gold": 80}
	]},
	"clinic": {"title": "TOWN CLINIC", "greet": "Let me patch you up.", "goods": [
		{"item": "poultice", "gold": 200},
		{"item": "tonic_health", "gold": 500},
		{"item": "tonic_strength", "gold": 800},
		{"item": "tonic_swift", "gold": 800}
	]},
	"dispensary": {"title": "GREEN THUMB DISPENSARY", "greet": "Welcome to the high life.", "goods": [
		{"item": "joint", "gold": 200},
		{"item": "blunt", "gold": 400},
		{"item": "edible", "gold": 500},
		{"item": "hemp_seed", "gold": 100},
		{"item": "indica_seed", "gold": 150},
		{"item": "sativa_seed", "gold": 150},
		{"item": "hybrid_seed", "gold": 200}
	]},
	"museum": {"title": "TOWN MUSEUM", "greet": "We gladly accept artifact donations.", "goods": [
		{"item": "golden_relic", "gold": 5000},
		{"item": "ancient_doll", "cost": {"strange_fossil": 1}},
		{"item": "rusty_sword", "cost": {"stone": 50}}
	]},"""
if '"saloon":' not in content:
    content = content.replace('"rancher": {', shops_to_add + '\n\t"rancher": {')

with open('game/scripts/inventory.gd', 'w') as f:
    f.write(content)

print("Updated inventory.gd successfully")
