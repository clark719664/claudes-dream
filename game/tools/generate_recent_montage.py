import os
from PIL import Image

# Paths
UPLOAD_DIR = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab\.user_uploaded"
OUTPUT_PATH = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab\recent_generations.png"

# Gather PNG files
images = [os.path.join(UPLOAD_DIR, f) for f in os.listdir(UPLOAD_DIR) if f.lower().endswith('.png')]
if not images:
    print('No PNG images found')
    exit(0)

# Load images
pics = [Image.open(p).convert('RGBA') for p in images]
# Determine max width/height
max_w = max(im.width for im in pics)
max_h = max(im.height for im in pics)
# Grid layout (e.g., 2 columns)
cols = 2
rows = (len(pics) + cols - 1) // cols
# Create canvas
canvas = Image.new('RGBA', (cols * max_w, rows * max_h), (0,0,0,0))

for idx, im in enumerate(pics):
    x = (idx % cols) * max_w
    y = (idx // cols) * max_h
    # Center each image in its cell
    offset_x = x + (max_w - im.width)//2
    offset_y = y + (max_h - im.height)//2
    canvas.alpha_composite(im, (offset_x, offset_y))

canvas.save(OUTPUT_PATH)
print('Montage saved to', OUTPUT_PATH)
