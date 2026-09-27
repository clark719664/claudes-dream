with open('game/scripts/inventory.gd', 'r') as f:
    c = f.read()

smith_i = c.find('"smith":')
if smith_i != -1:
    goods_i = c.find('"goods": [', smith_i)
    if goods_i != -1:
        c = c[:goods_i + 10] + '{"item": "sunforged_ring", "cost": 5000}, ' + c[goods_i + 10:]

with open('game/scripts/inventory.gd', 'w') as f:
    f.write(c)

print('Added sunforged_ring to smith shop!')
