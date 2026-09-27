"""Generate missing farm animal characters on PixelLab."""
import urllib.request, json, os, time

KEY = os.environ.get("PIXELLAB_API_KEY", "")
API = "https://api.pixellab.ai/v2"

def api_post(path, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(f"{API}/{path}", data=data,
                                headers={"Authorization": f"Bearer {KEY}",
                                         "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))

MISSING_ANIMALS = [
    # Adults
    ("duck", "quadruped", "Farm duck, white feathers, orange beak, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("alpaca", "quadruped", "Farm alpaca, fluffy white wool, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("llama", "quadruped", "Farm llama, brown and white fur, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("donkey", "quadruped", "Farm donkey, grey fur, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("turkey", "quadruped", "Farm turkey, brown feathers, red wattle, low top-down 16-bit RPG pixel art, crisp black outline"),
    # Babies
    ("baby_duck", "quadruped", "Baby duckling, small yellow, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("baby_goat", "quadruped", "Baby goat kid, small white and brown, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("baby_alpaca", "quadruped", "Baby alpaca cria, small fluffy white, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("baby_llama", "quadruped", "Baby llama cria, small brown and white, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("baby_donkey", "quadruped", "Baby donkey foal, small grey, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("baby_turkey", "quadruped", "Baby turkey poult, small brown chick, low top-down 16-bit RPG pixel art, crisp black outline"),
    ("baby_chicken", "quadruped", "Baby chick, tiny yellow, low top-down 16-bit RPG pixel art, crisp black outline"),
]

# First, check what already exists
existing = []
offset = 0
while True:
    req = urllib.request.Request(f"{API}/characters?limit=30&offset={offset}", headers={"Authorization": f"Bearer {KEY}"})
    batch = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))["characters"]
    if not batch:
        break
    existing.extend(batch)
    offset += len(batch)
    if len(batch) < 30:
        break
existing_names = {(c.get("name") or "").lower().strip() for c in existing}
print(f"Found {len(existing)} existing characters.")

created = 0
for name, template, prompt in MISSING_ANIMALS:
    if name in existing_names:
        print(f"  [{name}] Already exists, skipping.")
        continue
    
    print(f"  Creating [{name}]...")
    try:
        resp = api_post("create-character-with-8-directions", {
            "description": prompt,
            "image_size": {"width": 64, "height": 64},
            "view": "low top-down",
            "outline": "single color black outline",
            "shading": "basic shading",
            "detail": "medium detail",
        })
        print(f"    Created! ID: {resp.get('id')}, Status: {resp.get('status')}")
        created += 1
        time.sleep(1)  # Gentle rate limiting
    except Exception as e:
        print(f"    FAILED: {e}")

print(f"\nDone! Created {created} new characters.")
