import urllib.request, json, os

KEY = os.environ.get("PIXELLAB_API_KEY", "")
offset = 0
pending = []
while True:
    req = urllib.request.Request(f"https://api.pixellab.ai/v2/characters?limit=30&offset={offset}", headers={"Authorization": f"Bearer {KEY}"})
    chars = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))["characters"]
    if not chars: break
    for c in chars:
        if c["status"] in ("pending", "processing", "queued"):
            pending.append(f"{c['name']}: {c['status']}")
    offset += len(chars)
    if len(chars) < 30: break

if pending:
    print(f"{len(pending)} still processing:")
    for p in pending: print(f"  {p}")
else:
    print("All characters completed!")
