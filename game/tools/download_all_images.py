import urllib.request, json, os, io, sys
from PIL import Image
import base64

KEY = os.environ["PIXELLAB_API_KEY"]
API = "https://api.pixellab.ai/v2"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "pixellab_raw_images")
os.makedirs(OUT, exist_ok=True)

def api_get(path):
    req = urllib.request.Request(f"{API}/{path}", headers={"Authorization": f"Bearer {KEY}"})
    return urllib.request.urlopen(req, timeout=30)

def api_json(path):
    return json.loads(api_get(path).read().decode("utf-8"))

def main():
    print("Fetching image list from PixelLab...")
    all_images = []
    offset = 0
    while True:
        resp = api_json(f"images?limit=50&offset={offset}")
        images = resp.get("images", [])
        if not images:
            break
        all_images.extend(images)
        offset += len(images)
        if len(images) < 50:
            break

    print(f"Found {len(all_images)} total images.")
    
    # Save the prompt text and the image itself so we can see what the user generated!
    for img in all_images:
        desc = img.get("description", "no_desc").replace(" ", "_")[:30]
        # remove special chars
        desc = "".join(c for c in desc if c.isalnum() or c == "_")
        iid = img["id"]
        
        path = os.path.join(OUT, f"{iid}_{desc}.png")
        if os.path.exists(path):
            continue
            
        print(f"Downloading {iid} - {desc}...")
        try:
            # Get specific image data
            img_data = api_json(f"images/{iid}")
            b64 = img_data.get("image", {}).get("base64", "")
            if b64:
                raw = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
                raw.save(path)
        except Exception as e:
            print(f"Failed {iid}: {e}")

if __name__ == "__main__":
    main()
