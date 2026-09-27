import os
import time
import json
import urllib.request
import urllib.error
import glob

KEY = os.environ.get("PIXELLAB_API_KEY", "")

def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    TARGETS = [
        "cow", "sheep", "pig", "baby_cow", "baby_sheep", "baby_pig",
        "baby_horse", "puppy", "kitten", "baby_ferret", "baby_bear",
        "baby_polar_bear", "baby_wolf", "baby_arctic_wolf",
        "baby_chicken", "tadpole", "duck", "goat", "alpaca",
        "llama", "donkey", "turkey"
    ]
    
    while True:
        resp = api_get("v2/characters?limit=100")
        chars = resp.get("characters", [])
        
        all_done = True
        downloaded_any = False
        
        local_pngs = glob.glob("../assets/pixellab_npcs/*.png")
        local_names = [os.path.basename(p).replace(".png", "") for p in local_pngs]
        
        active_jobs = 0
        for c in chars:
            name = (c.get("name") or "").lower().replace(" ", "_").replace("a_", "")
            status = c.get("status")
            cid = c.get("id")
            
            if name not in TARGETS:
                continue
                
            if status in ["processing", "queued", "pending"]:
                active_jobs += 1
                all_done = False
            elif status == "completed":
                # Check if we already have the first direction downloaded
                first_path = f"../assets/pixellab_npcs/{name}_south.png"
                if not os.path.exists(first_path):
                    print(f"[{name}] Status: completed")
                    try:
                        print(f"  Downloading rotations for {name}...")
                        base_url = f"https://api.pixellab.ai/v2/character/{cid}/sprite-sheet?direction="
                        dirs = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]
                        for d in dirs:
                            url = base_url + d
                            out_path = f"../assets/pixellab_npcs/{name}_{d}.png"
                            if not os.path.exists(out_path):
                                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
                                with urllib.request.urlopen(req) as response:
                                    with open(out_path, "wb") as f:
                                        f.write(response.read())
                        print(f"Saved master sheets for {name}")
                        downloaded_any = True
                    except Exception as e:
                        print(f"Failed downloading {name}: {e}")
        
        if active_jobs == 0 and not downloaded_any:
            print("No active jobs and nothing left to download.")
            break
            
        time.sleep(5)

if __name__ == "__main__":
    main()
