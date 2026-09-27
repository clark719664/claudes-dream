import os
from PIL import Image

src_dir = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab"
dst_dir = r"C:\Users\lil_c\claudes-dream\game\assets\portraits"

os.makedirs(dst_dir, exist_ok=True)

files = {
    "mayor_holt_1790397562939.jpg": "mayor_holt.png",
    "cass_1790397694969.jpg": "cass.png",
    "farmer_dell_1790397591916.jpg": "farmer_dell.png",
    "wren_1790397616569.jpg": "wren.png",
    "elena_1790397604148.jpg": "elena.png",
    "tilda_1790397641765.jpg": "tilda.png",
    "pell_1790397629529.jpg": "pell.png"
}

for src_name, dst_name in files.items():
    src_path = os.path.join(src_dir, src_name)
    dst_path = os.path.join(dst_dir, dst_name)
    if os.path.exists(src_path):
        with Image.open(src_path) as img:
            # Crop to square if needed. Pell has a dialog box at the bottom, so crop top square.
            w, h = img.size
            if dst_name == "pell.png":
                # Crop top 70% or so where the face is
                img = img.crop((w * 0.1, h * 0.1, w * 0.9, h * 0.7))
            elif dst_name == "wren.png":
                img = img.crop((w * 0.05, h * 0.05, w * 0.95, h * 0.95))
            else:
                img = img.crop((0, 0, w, w))
            
            # Resize to 64x64
            img = img.resize((64, 64), Image.Resampling.LANCZOS)
            img.save(dst_path, format="PNG")
            print(f"Saved {dst_path}")
    else:
        print(f"Missing {src_path}")
