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

def api_delete(path: str):
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
        method="DELETE",
    )
    try:
        urllib.request.urlopen(req, timeout=15)
    except:
        pass

def main():
    # 1. DELETE the bad human-shaped ones (the ones with prompt as name)
    existing = api_get("v2/characters?limit=100").get("characters", [])
    for c in existing:
        name = c.get("name", "")
        if name and len(name) > 30 and ("low top-down" in name.lower() or "pixel art" in name.lower()):
            print(f"Deleting broken character: {name[:40]}...")
            api_delete(f"v2/characters/{c['id']}")

    # 2. GENERATE the missing babies correctly
    mobs = [
        ("baby_duck", "custom", "Baby duckling, small yellow bird, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_goat", "quadruped", "Baby goat kid, small white and brown, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_alpaca", "quadruped", "Baby alpaca cria, small fluffy white, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_llama", "quadruped", "Baby llama cria, small brown and white, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_donkey", "quadruped", "Baby donkey foal, small grey, low top-down 16-bit RPG pixel art, crisp black outline"),
        ("baby_turkey", "custom", "Baby turkey poult, small brown bird, low top-down 16-bit RPG pixel art, crisp black outline"),
    ]
    
    existing = api_get("v2/characters?limit=100").get("characters", [])
    existing_names = {str(c.get("name") or "").lower() for c in existing}

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
            print(f"  Result: {resp['status']}")
            time.sleep(2)
        except Exception as e:
            print(f"Failed to launch {m_name}: {e}")
            break

    print("Finished.")

if __name__ == "__main__":
    main()
