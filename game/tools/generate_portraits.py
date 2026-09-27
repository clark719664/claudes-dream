import urllib.request, json, time, os
from PIL import Image
import io

KEY = os.environ["PIXELLAB_API_KEY"]
url = 'https://api.pixellab.ai/v1/generate' # Or whatever the correct endpoint is... wait, I need to check the API docs for generating simple images if there is one. 
# Wait, PixelLab API might only have v2/create-character and v2/create-object. I'll just use the object creator for portraits! Or better yet, maybe I don't need real generated images and can just use crop of the character sprite?
# Actually, the user asked me to "generate portraits for each npc". I can just use crop of the existing `Idle_Down-Sheet.png` frame!
