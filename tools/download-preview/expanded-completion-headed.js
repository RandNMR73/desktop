// Run through the owned disposable-profile harness. Expected selection and
// terminal scale come from arc-expanded-lifecycle-reference.json.
const done = arguments[arguments.length - 1];
const spaceIndex = Number(arguments[0] || 0);
(async () => {
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  if (!profile.includes("zen-region-colors-native-")) throw new Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const downloads = await Downloads.getList(Downloads.PUBLIC);
  const list = d.getElementById("zen-library-download-list");
  const foot = d.getElementById("zen-sidebar-foot-buttons"), button = d.getElementById("zen-library-button");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const enter = () => { const r = button.getBoundingClientRect(); button.dispatchEvent(new w.MouseEvent("mouseenter", {clientX:r.x+16,clientY:r.y+16})); };
  const leave = () => button.dispatchEvent(new w.MouseEvent("mouseleave", {clientX:400,clientY:400}));
  const folder = PathUtils.join(profile, "owned-expanded-completion");
  await IOUtils.makeDirectory(folder);
  const failures = [], samples = [], owned = [];
  let checks = 0;
  const check = (value, message) => { checks++; if (!value) failures.push(message); };
  const row = x => [...list.children].find(n => !n.hidden && n.download?.target.path === x.target.path);
  const space = w.gZenWorkspaces.getWorkspaces()[spaceIndex];
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
  try {
    enter(); await pause(650); leave(); await pause(350);
    for (const initial of ["active", "paused", "notStarted"]) {
      const path = PathUtils.join(folder, initial + ".txt");
      await IOUtils.writeUTF8(path, "Owned completion fixture");
      const x = await Downloads.createDownload({source:{url:"https://example.com/" + initial},target:{path},startTime:new Date()});
      await x.refresh(); x.target.exists = await IOUtils.exists(path);
      Object.assign(x, {stopped:initial !== "active",canceled:initial === "paused",hasPartialData:initial === "paused",
        succeeded:false,error:null,currentBytes:33,totalBytes:100,progress:33,hasProgress:true});
      await downloads.add(x); owned.push(x);
      enter(); await pause(650);
      check(foot.hasAttribute("zen-library-stack-open"), initial + ": flyout expanded");
      check(foot.hasAttribute("zen-library-badge"), initial + ": expansion retains initial item");
      Object.assign(x, {stopped:true,canceled:false,hasPartialData:false,succeeded:true,error:null,
        currentBytes:100,progress:100,endTime:Date.now()});
      x._notifyChange(); await pause(450);
      check(foot.hasAttribute("zen-library-stack-open"), initial + ": completing preserves expanded view");
      check(foot.hasAttribute("zen-library-badge"), initial + ": completing preserves selected badge");
      const item = row(x), icon = item.querySelector(".zen-library-download-badge");
      check(Math.abs(icon.getBoundingClientRect().width - 40) < 0.05, initial + ": completed expanded thumbnail is 40pt");
      leave();
      const animation = item.getAnimations().find(a => a.effect.getKeyframes().some(f => f.transform));
      check(!!animation, initial + ": close animates selected badge");
      if (animation) {
        animation.pause();
        const frame = animation.effect.getKeyframes().at(-1);
        const matrix = new w.DOMMatrix(frame.transform);
        check(Math.abs(matrix.a - 0.55) < 0.0001, initial + ": close ends at completed 0.55 scale");
        check(Number(frame.opacity) === 1, initial + ": selected badge returns without fading");
        samples.push({initial,scale:matrix.a,opacity:frame.opacity});
        animation.play();
      }
      await Promise.allSettled(item.getAnimations().map(a => a.finished));
      await pause(100);
      check(foot.hasAttribute("zen-library-badge"), initial + ": closing retains completion that arrived while open");
      check(!foot.hasAttribute("zen-library-stack-open"), initial + ": flyout closes");
      const footer = d.getElementById("library-button-badge");
      check(Math.abs(footer.getBoundingClientRect().width - 22) < 0.05, initial + ": closed completed thumbnail is 22pt");
      enter(); await pause(650);
      check(!foot.hasAttribute("zen-library-badge"), initial + ": next expansion consumes completed item");
      leave(); await pause(350);
      check(!foot.hasAttribute("zen-library-badge"), initial + ": consumed item does not return");
      await downloads.remove(x); owned.splice(owned.indexOf(x),1);
    }
  } finally {
    leave(); for (const x of owned) await downloads.remove(x);
    await IOUtils.remove(folder,{recursive:true});
  }
  return {space:space.name,checks,failures,samples,production_profile_used:false};
})().then(done,error=>done({error:String(error),stack:error.stack}));
