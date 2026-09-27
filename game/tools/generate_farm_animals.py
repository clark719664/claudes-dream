import os
import time
import json
import urllib.request
import urllib.error

KEY = os.environ.get("PIXELLAB_API_KEY", "")

def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))

def api_post(path: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.read().decode('utf-8')}")
        raise

def main():
    mobs = [
        ("cow", "quadruped", "Farm cow, black and white spots, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("sheep", "quadruped", "Fluffy white sheep, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("pig", "quadruped", "Pink farm pig, low top-down 16-bit RPG pixel art, crisp black outline"),
        
        ("baby_cow", "quadruped", "Baby farm calf, small, black and white spots, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_sheep", "quadruped", "Baby lamb, small fluffy white, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_pig", "quadruped", "Baby piglet, small pink, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_horse", "quadruped", "Baby foal horse, small brown, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("puppy", "quadruped", "Baby puppy dog, small, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("kitten", "quadruped", "Baby kitten cat, small tabby, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_ferret", "quadruped", "Baby ferret, small long body, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_bear", "quadruped", "Baby bear cub, small brown, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_polar_bear", "quadruped", "Baby polar bear cub, small white, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_wolf", "quadruped", "Baby wolf pup, small gray, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_arctic_wolf", "quadruped", "Baby arctic wolf pup, small white, low top-down 16-bit RPG pixel art, crisp black outline"),
        
        ("baby_chicken", "custom", "Baby chick, small yellow bird, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("tadpole", "custom", "Baby tadpole frog, small green with tail, low top-down 16-bit RPG pixel art, crisp black outline"),
        
        ("duck", "custom", "Farm duck, white bird with orange bill, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("goat", "quadruped", "Farm goat, white with horns, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("alpaca", "quadruped", "Fluffy brown alpaca, tall neck, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("llama", "quadruped", "Farm llama, white tall neck, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("donkey", "quadruped", "Farm donkey, gray with long ears, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("turkey", "custom", "Farm turkey, large brown bird with tail fan, low top-down 16-bit RPG pixel art, crisp black outline"),
    ]
    
    existing = api_get("v2/characters?limit=100").get("characters", [])
    existing_names = {str(c.get("name") or "").lower() for c in existing}

    launched = []
    for m_name, tmpl, desc in mobs:
        if m_name in existing_names:
            print(f"'{m_name}' already exists.")
            continue
        try:
            print(f"Launching {m_name}...")
            resp = api_post("v2/create-character-v3", {
                "name": m_name,
                "description": desc,
                "template_id": tmpl,
                "view": "low top-down",
                "image_size": {"width": 64, "height": 64},
                "no_background": True,
                "outline": "single color black outline",
                "detail": "medium detail",
            })
            print(f"  Result: {resp}")
            launched.append(m_name)
            time.sleep(2) # stagger requests more to avoid rate limit
        except Exception as e:
            print(f"Failed to launch {m_name} with {tmpl}: {e}")
            break # break on rate limit so we can run it again later

    print("Finished launching jobs.")

if __name__ == "__main__":
    main()
