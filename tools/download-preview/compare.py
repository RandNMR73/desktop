import json,base64,io
from pathlib import Path
from PIL import Image,ImageCms,ImageChops,ImageStat
w=Path(__file__).parent;report=[]
capture=w/'progress-captures.json'
if capture.exists():
 for r in json.loads(capture.read_text())['rows']:
  (w/r['name']).write_bytes(base64.b64decode(r['png']))
images=w if capture.exists() else w/'progress-static'
for p in sorted(images.glob('actual-*.png')):
 def rgb(p):
  im=Image.open(p)
  if im.info.get('icc_profile'):
   im=ImageCms.profileToProfile(im,ImageCms.ImageCmsProfile(io.BytesIO(im.info['icc_profile'])),ImageCms.createProfile('sRGB'),outputMode='RGBA')
  im=im.convert('RGBA');bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im);return bg.convert('RGB')
 a=rgb(p);b=rgb(p.with_name(p.name.replace('actual-','reference-')));diff=ImageChops.difference(a,b)
 report.append({'name':p.name,'mean_absolute_channel_error':sum(ImageStat.Stat(diff).mean)/3,'max_channel_error':max(v[1]for v in diff.getextrema())})
(w/'progress-pixel-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
