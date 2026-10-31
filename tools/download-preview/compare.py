import json,base64,io
from pathlib import Path
from PIL import Image,ImageCms,ImageChops,ImageStat
w=Path(__file__).parent;report=[]
for r in json.loads((w/'progress-captures.json').read_text())['rows']:
 p=w/r['name'];p.write_bytes(base64.b64decode(r['png']))
 def rgb(p):
  im=Image.open(p)
  if im.info.get('icc_profile'):
   im=ImageCms.profileToProfile(im,ImageCms.ImageCmsProfile(io.BytesIO(im.info['icc_profile'])),ImageCms.createProfile('sRGB'),outputMode='RGBA')
  im=im.convert('RGBA');bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im);return bg.convert('RGB')
 a=rgb(p);b=rgb(w/r['name'].replace('actual-','reference-'));diff=ImageChops.difference(a,b)
 report.append({'name':p.name,'mean_absolute_channel_error':sum(ImageStat.Stat(diff).mean)/3,'max_channel_error':max(v[1]for v in diff.getextrema())})
(w/'progress-pixel-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
