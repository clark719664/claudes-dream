import os, json, urllib.request

req = urllib.request.Request(
    'https://api.pixellab.ai/v2/characters?limit=30',
    headers={'Authorization': 'Bearer ' + os.environ.get('PIXELLAB_API_KEY'), 'User-Agent': 'Mozilla/5.0'}
)
resp = urllib.request.urlopen(req).read().decode('utf-8')
chars = json.loads(resp).get('characters', [])
for c in chars[15:27]:
    name = c.get('name', '').strip().lower().replace(' ', '_').replace('a_', '')
    cid = c.get('id')
    print(f'    ("{name}", "{cid}"),')
