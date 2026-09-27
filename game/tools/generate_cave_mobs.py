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
        ("cave_bat", "mannequin", "Giant cave bat monster, leathery brown wings and glowing red eyes, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("rock_slime", "mannequin", "Rocky cave slime monster, gray stone with glowing purple crystal core, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("tunnel_spider", "mannequin", "Giant venomous tunnel spider monster, hairy black legs and green glowing fangs, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("crystal_basilisk", "mannequin", "Crystal basilisk monster, armored reptilian beast with glowing blue geode spikes, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("abyssal_crawler", "mannequin", "Abyssal crawler monster, multi-legged deep cave horror with glowing pale eyes, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("shadow_fiend", "mannequin", "Dark shadow fiend monster, wraith-like deep cavern stalker with glowing purple hands, low top-down 16-bit RPG pixel art monster, crisp black outline"),
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
            time.sleep(1) # stagger requests
        except Exception as e:
            print(f"Failed to launch {m_name}: {e}")

    print("Finished launching jobs.")

if __name__ == "__main__":
    main()
