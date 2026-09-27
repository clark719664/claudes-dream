from pathlib import Path
import json,re,copy
from PIL import Image
GAME=Path(__file__).resolve().parents[1]
def main():
 p=GAME/'data/catalog.json';c=json.loads(p.read_text());added=[]
 for folder in sorted((GAME/'assets/pixellab_npcs').iterdir()):
  if not folder.is_dir() or folder.name in c['actors']:continue
  animations={}
  for sheet in sorted(folder.glob('*-Sheet.png')):
   name=sheet.stem.removesuffix('-Sheet').lower()
   if name.split('_')[0] not in ['idle','walk','run','attack','heavy','hurt','death']:continue
   w,h=Image.open(sheet).size
   if w%h:continue
   animations[name]={'sheet':str(sheet.relative_to(GAME/'assets')).replace('\\','/'),'frame':[h,h],'frames':w//h,'cols':w//h,'fps':6 if name.startswith('idle') else 10,'loop':not name.startswith(('death','hurt','attack','heavy')),'anchor':[h//2,h-1]}
  if not animations:continue
  for base,fallback in [('idle','idle_down'),('run','walk_down'),('walk','walk_down'),('death','death_down')]:
   if base not in animations and fallback in animations:animations[base]=copy.deepcopy(animations[fallback])
  for direction in ['down','left','right','up']:
   if 'walk_'+direction in animations and 'run_'+direction not in animations:animations['run_'+direction]=copy.deepcopy(animations['walk_'+direction])
  if 'idle' not in animations:continue
  c['actors'][folder.name]=animations;added.append(folder.name)
 # Small ambient creatures have recovered rotations but no generated animation sheets.
 archive=GAME.parent/'ArtSource/PixelLabArchive/2026-09-26/characters'
 names={}
 for d in archive.iterdir():
  m=d/'metadata.json'
  if m.exists():names[json.loads(m.read_text()).get('name','').strip().lower()]=d
 for kind in ['bee','butterfly','frog']:
  if kind in c['actors']:continue
  d=names[kind];anim={};out=GAME/'assets/curated/actors'/kind;out.mkdir(parents=True,exist_ok=True)
  for direction,view in [('down','south'),('up','north'),('left','west'),('right','east')]:
   source=next((d/'original').glob('**/rotations/'+view+'.png'));im=Image.open(source).convert('RGBA');im=im.crop(im.getchannel('A').getbbox());im.thumbnail((12,12),Image.Resampling.NEAREST)
   cell=Image.new('RGBA',(16,16));cell.alpha_composite(im,((16-im.width)//2,15-im.height));dest=out/(direction+'.png');cell.save(dest)
   spec={'sheet':str(dest.relative_to(GAME/'assets')).replace('\\','/'),'frame':[16,16],'frames':1,'cols':1,'fps':6,'loop':True,'anchor':[8,15]}
   for action in ['idle','run','walk','death']:anim[action+'_'+direction]=copy.deepcopy(spec)
  for action in ['idle','run','walk','death']:anim[action]=copy.deepcopy(anim[action+'_down'])
  c['actors'][kind]=anim;added.append(kind)
 p.write_text(json.dumps(c,indent=2)+'\n')
 print('Registered '+str(len(added))+' missing actors: '+', '.join(added))
if __name__=='__main__':main()
