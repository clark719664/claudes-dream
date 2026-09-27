import re

with open('game/scripts/interior.gd', 'r') as f:
    content = f.read()

props_map = {
    '"saloon"': '["tavern_bar", 5.0, 4.0, 40, ""], ["tavern_table", 2.5, 7.0, 0, ""], ["tavern_table", 7.5, 7.0, 0, ""]',
    '"blacksmith_shop"': '["forge_anvil", 5.0, 5.0, 40, ""]',
    '"general_store"': '["store_counter", 5.0, 4.0, 40, ""]',
    '"clinic"': '["clinic_bed", 2.5, 5.0, 40, ""], ["clinic_bed", 7.5, 5.0, 40, ""]',
    '"church"': '["church_pew", 2.5, 4.0, 40, ""], ["church_pew", 7.5, 4.0, 40, ""], ["church_pew", 2.5, 7.0, 40, ""], ["church_pew", 7.5, 7.0, 40, ""]',
    '"school"': '["school_desk", 2.5, 4.0, 0, ""], ["school_desk", 5.0, 4.0, 0, ""], ["school_desk", 7.5, 4.0, 0, ""], ["school_desk", 2.5, 7.0, 0, ""], ["school_desk", 5.0, 7.0, 0, ""], ["school_desk", 7.5, 7.0, 0, ""]',
    '"museum"': '["museum_display", 2.5, 4.0, 40, ""], ["museum_display", 7.5, 4.0, 40, ""], ["museum_display", 5.0, 7.0, 40, ""]',
    '"bathhouse"': '["bathhouse_pool", 5.0, 5.0, 0, ""]',
    '"inn"': '["inn_bed", 2.5, 5.0, 40, ""], ["inn_bed", 7.5, 5.0, 40, ""]',
    '"library"': '["library_desk", 5.0, 5.0, 40, ""]'
}

for key, props in props_map.items():
    pattern = rf'({key}: {{"wall": \d+, "floor": \d+, "w": \d+, "h": \d+, "props": \[)(.*?)(\]}})'
    match = re.search(pattern, content)
    if match:
        content = content[:match.start(2)] + props + content[match.end(2):]

with open('game/scripts/interior.gd', 'w') as f:
    f.write(content)

print("Props added to interior.gd")
