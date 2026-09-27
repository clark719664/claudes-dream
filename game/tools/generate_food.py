import os
import time
from generate_crops import generate_icon

ITEMS_DIR = "game/assets/pixellab_items"

new_items = {
    "pumpkin_pie": "A delicious slice of orange pumpkin pie",
    "corn_on_cob": "A cooked yellow corn on the cob on a stick",
    "strawberry_cake": "A slice of shortcake with hot pink strawberries and whipped cream",
    "stuffed_eggplant": "A baked purple eggplant split open and stuffed with meat",
    "onion_rings": "A basket of crispy golden fried onion rings"
}

def main():
    os.makedirs(ITEMS_DIR, exist_ok=True)
    
    for name, prompt in new_items.items():
        out_path = os.path.join(ITEMS_DIR, f"{name}.png")
        if not os.path.exists(out_path):
            generate_icon(prompt, out_path)
            time.sleep(1) # rate limit

if __name__ == "__main__":
    main()
