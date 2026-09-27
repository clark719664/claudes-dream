with open('C:/Users/lil_c/.gemini/antigravity/brain/433fa0e9-d043-4a36-88b6-c820d8b1c3ab/walkthrough.md', 'r') as f:
    text = f.read()

text += '''
### 6. Romance & Marriage System
The logic for dating and marriage has been fully added to the codebase!
- **Hearts 1-8:** Normal friendship. At 8 hearts, the UI caps unless you start dating.
- **Dating (Bouquet):** Give a character a `bouquet` when they are at 8 hearts to start dating them, which unlocks Hearts 9 and 10!
- **Marriage (Sunforged Ring):** Give a character a `sunforged_ring` when they are at 10 hearts to propose to them! If accepted, their social status will permanently change to "married".
'''
with open('C:/Users/lil_c/.gemini/antigravity/brain/433fa0e9-d043-4a36-88b6-c820d8b1c3ab/walkthrough.md', 'w') as f:
    f.write(text)
