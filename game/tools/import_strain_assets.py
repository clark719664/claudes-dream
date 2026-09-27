from pathlib import Path
import json, shutil
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parent
ARCH=REPO/'ArtSource/PixelLabArchive/2026-09-26'
OUT=ROOT/'assets/curated/strains'
SOURCE=REPO/'ArtSource/StrainGrowth/foliage-original.png'
OUT.mkdir(parents=True,exist_ok=True)
SPECS={
 'sativa':{'id':'01cb8e15-1863-486c-b470-837f8f4b35dd','view':'south','heights':[7,17,28,40],'width':24},
 'hybrid':{'id':'ad155a81-6199-4d9c-9851-fef03732133b','view':'south-east','heights':[7,16,24,33],'width':26},
 'indica':{'id':'18bb9cb1-4efe-46fa-8276-997b37d7bfda','view':'south','heights':[7,14,21,28],'width':28}}

def import_assets():
    source=Image.open(SOURCE).convert('RGBA'); alpha=source.getchannel('A').point(lambda value: 255 if value >= 128 else 0)
    active=[alpha.crop((0,y,source.width,y+1)).getbbox() is not None for y in range(source.height)]
    bands=[]; start=None
    for y,on in enumerate(active+[False]):
        if on and start is None:start=y
        if not on and start is not None:
            if y-start>12:bands.append((start,y))
            start=None
    if len(bands)!=3:raise ValueError('Expected three isolated foliage rows, found '+str(bands))
    overlay={'sprites':{},'items':{},'strain_sources':SPECS}
    for row,(kind,spec) in enumerate(SPECS.items()):
        sprites=[];sheet=Image.new('RGBA',(128,48))
        for stage in range(4):
            box=(round(stage*source.width/4),bands[row][0],round((stage+1)*source.width/4),bands[row][1])
            cell=source.crop(box);bb=cell.getchannel('A').point(lambda value: 255 if value >= 128 else 0).getbbox()
            if not bb:raise ValueError('Empty foliage cell')
            cell=cell.crop(bb);h=spec['heights'][stage];w=round(cell.width*h/cell.height)
            if w>spec['width']:w=spec['width']
            cell=cell.resize((w,h),Image.Resampling.BOX)
            cell.putalpha(cell.getchannel('A').point(lambda value: 255 if value >= 72 else 0))
            sheet.alpha_composite(cell,(stage*32+(32-w)//2,46-h))
            sprites.append({'sheet':'curated/strains/'+kind+'_growth.png','region':[stage*32,0,(stage+1)*32,48],'anchor':[16,46]})
        sheet.save(OUT/(kind+'_growth.png'));overlay['sprites']['crop_'+kind]=sprites
        budpath=next((ARCH/'objects'/spec['id']/'original').rglob(spec['view']+'.png'))
        bud=Image.open(budpath).convert('RGBA');bud=bud.crop(bud.getchannel('A').getbbox())
        bud.thumbnail((14,16),Image.Resampling.NEAREST)
        icon=Image.new('RGBA',(16,16));icon.alpha_composite(bud,((16-bud.width)//2,16-bud.height));icon.save(OUT/(kind+'_bud.png'))
        overlay['items'][kind]={'sheet':'curated/strains/'+kind+'_bud.png','region':[0,0,16,16],'anchor':[8,8]}
        for suffix in ['_seed','_seeds']:
            overlay['items'][kind+suffix]={'sheet':'Environment/Props/Static/Farm.png','region':[0,2,16,14],'anchor':[8,6]}
    for kind in ['corn','eggplant','onion','pumpkin','strawberry','tomato']:
        path=ROOT/'assets/pixellab_crops'/('crop_'+kind+'.png')
        with Image.open(path) as im:
            if im.size!=(64,32):raise ValueError('Unexpected vegetable sheet size')
        overlay['sprites']['crop_'+kind]=[{'sheet':'pixellab_crops/crop_'+kind+'.png','region':[i*16,0,(i+1)*16,32],'anchor':[8,31]} for i in range(4)]
        for suffix in ['_seed','_seeds']:
            overlay['items'][kind+suffix]={'sheet':'Environment/Props/Static/Farm.png','region':[0,2,16,14],'anchor':[8,6]}
    (ROOT/'data/strain_catalog.json').write_text(json.dumps(overlay,indent=2)+'\n',encoding='utf-8')
    preview=Image.new('RGB',(640,340),(31,43,35));draw=ImageDraw.Draw(preview)
    for row,kind in enumerate(SPECS):
        growth=Image.open(OUT/(kind+'_growth.png')).convert('RGBA').resize((384,144),Image.Resampling.NEAREST)
        # Separate compact proof rows, retaining native pixels at 2x.
        growth=Image.open(OUT/(kind+'_growth.png')).convert('RGBA').resize((256,96),Image.Resampling.NEAREST)
        preview.paste(growth,(140,row*110+5),growth);draw.text((10,row*110+65),kind.upper(),fill=(246,220,158))
        bud=Image.open(OUT/(kind+'_bud.png')).convert('RGBA').resize((64,64),Image.Resampling.NEAREST);preview.paste(bud,(450,row*110+35),bud)
    preview.save(REPO/'ArtSource/StrainGrowth/import-preview.png')
    print('Imported 12 foliage stages, 3 exact-source bud icons, and 6 existing vegetable growth strips.')
if __name__=='__main__':import_assets()
