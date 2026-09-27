import os
import json
import urllib.request

KEY = os.environ.get("PIXELLAB_API_KEY", "")

def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    resp = api_get("v2/characters?limit=15")
    chars = resp.get("characters", [])
    print("Latest 15 characters:")
    for c in chars:
        name = c.get("name") or "Unnamed"
        cid = c.get("id")
        status = c.get("status")
        created = c.get("created_at")
        print(f"- {name} (ID: {cid}) | Status: {status} | Created: {created}")

if __name__ == "__main__":
    main()
