with open('C:/Users/lil_c/.gemini/antigravity/brain/433fa0e9-d043-4a36-88b6-c820d8b1c3ab/task.md', 'r') as f:
    text = f.read()

text = text.replace('[ ] 7. Implement NPC Schedules & Pathfinding (`npc.gd`)', '[x] 7. Implement NPC Schedules & Pathfinding (`npc.gd`)')
text = text.replace('[ ] 4. Implement Gifting & Preferences (`npc.gd`)', '[x] 4. Implement Gifting & Preferences (`npc.gd`)')
text = text.replace('[ ] 2. Generate Furniture & Decor (background task)', '[x] 2. Generate Furniture & Decor (background task)')

with open('C:/Users/lil_c/.gemini/antigravity/brain/433fa0e9-d043-4a36-88b6-c820d8b1c3ab/task.md', 'w') as f:
    f.write(text)
