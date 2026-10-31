from pathlib import Path
import argparse, json, sys, tempfile
parser=argparse.ArgumentParser(description="Export the local Arc Library assets in a disposable Zen profile using lottie-web 5.13.0.")
for arg in ["arc","app","bench","lottie","out"]: parser.add_argument("--"+arg,type=Path,required=True)
args=parser.parse_args()
work=args.out.resolve();work.mkdir(parents=True,exist_ok=True)
(work/'lottie-5.13.0.js').write_bytes(args.lottie.read_bytes())
sys.path.insert(0,str(args.bench))
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs
assets = args.arc / 'Contents/Resources/ARC_HomeButton.bundle/Contents/Resources'
animations = {p.stem:json.loads(p.read_text()) for p in assets.glob('*.json')}
html = '''<!doctype html><meta charset="utf-8"><script src="lottie-5.13.0.js"></script>
<body><script>
const animations=ANIMATIONS;
function mark(x) {
 if (!x || typeof x !== 'object') return;
 if (x.ty===4 && ['primaryColor','secondaryColor'].includes(x.nm)) x.cl=x.nm;
 for (const v of Object.values(x)) if (v && typeof v==='object') mark(v);
}
window.exported=(async()=>{
 const result={};
 for(const [name,data] of Object.entries(animations)) {
  mark(data);
  const container=document.createElement('div');document.body.append(container);
  const anim=lottie.loadAnimation({container,renderer:'svg',loop:false,autoplay:false,animationData:data});
  await new Promise((resolve,reject)=>{
   if(anim.isLoaded)resolve();
   else {anim.addEventListener('DOMLoaded',resolve);anim.addEventListener('data_failed',reject);}
  });
  anim.setSubframe(false);
  const end=data.markers.find(m=>m.cm==='selection-end').tm;
  const frames=[];
  for(let n=0;n<=end;n++){anim.goToAndStop(n,true);frames.push(container.firstElementChild.outerHTML);}
  result[name]={name,end,frames};
  anim.destroy();container.remove();
 }
 return result;
})();
</script>'''.replace('ANIMATIONS', json.dumps(animations))
(work/'export.html').write_text(html)
app=args.app
with tempfile.TemporaryDirectory(prefix='zen-library-export-') as tmp:
 profile=Path(tmp);port=free_port()
 (profile/'user.js').write_text(render_prefs({**harness_prefs(port),'zen.welcome-screen.seen':True}))
 with Instance(app,profile,port,env={'MOZ_PURGE_CACHES':'1'},log=work/'export-browser.log') as inst:
  inst.client.call('WebDriver:SetTimeouts',{'script':30000})
  inst.client.call('Marionette:SetContext',{'value':'content'})
  inst.client.call('WebDriver:Navigate',{'url':(work/'export.html').as_uri()})
  result=inst.client.run('const done=arguments[arguments.length-1];window.exported.then(done).catch(e=>done({error:String(e)}));')
  assert not result.get('error'),result
  for name,data in result.items():
   (work/(name+'-frames.json')).write_text(json.dumps(data))
   print(name,data['end'],len(json.dumps(data)))
