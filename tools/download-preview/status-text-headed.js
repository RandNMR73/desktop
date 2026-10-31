// Run only through the owned disposable-profile harness. Expected labels and
// retention cases come from the Arc reference, not the implementation helpers.
const done = arguments[arguments.length - 1];
const phase = arguments[0] || "subtitles";
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
  const row = x => [...list.children].find(n => !n.hidden && n.download?.target.path === x.target.path);
  const folder = PathUtils.join(profile, "owned-status-text");
  await IOUtils.makeDirectory(folder);
  const owned = [], failures = [], samples = [];
  let checks = 0;
  const check = (value, message) => { checks++; if (!value) failures.push(message); };
  const apply = (x, state, extra = {}) => {
    Object.assign(x, {stopped:true,succeeded:false,canceled:false,hasPartialData:false,error:null,
      currentBytes:1200000,totalBytes:3600000,speed:40000,progress:33,hasProgress:true,launchWhenSucceeded:false});
    if (state === "active") x.stopped = false;
    if (state === "paused") { x.canceled = true; x.hasPartialData = true; }
    if (state === "cancelled") x.canceled = true;
    if (state === "failed") x.error = {message:"Owned failure"};
    if (state === "completed") { x.succeeded = true; x.endTime = Date.now(); }
    Object.assign(x, extra);
    x._notifyChange();
  };
  const add = async (name, state) => {
    const path = PathUtils.join(folder, name + ".txt");
    await IOUtils.writeUTF8(path, "Owned status fixture");
    const x = await Downloads.createDownload({source:{url:"https://cdn.example.co.uk/file"},target:{path},startTime:new Date()});
    await x.refresh(); x.target.exists = await IOUtils.exists(path);
    apply(x, state); await downloads.add(x); owned.push(x); return x;
  };
  const text = async x => {
    await pause(100);
    const subtitle = row(x)?.querySelector(".zen-library-download-list-subtitle");
    if (!subtitle) throw new Error("Fixture row missing");
    await d.l10n.translateElements([subtitle]);
    return subtitle.textContent.replace(/[\u2068\u2069]/g, "");
  };
  try {
    enter(); await pause(650); leave(); await pause(350);
    if (phase === "subtitles") {
      const x = await add("Status text fixture", "active");
      const cases = [
        ["active", {}, "1.2/3.6 MB · 1m"],
        ["active", {speed:0}, "1.2/3.6 MB"],
        ["active", {currentBytes:123000,speed:0}, "123 KB/3.6 MB"],
        ["active", {launchWhenSucceeded:true}, "Opening… (33%)"],
        ["active", {launchWhenSucceeded:true,totalBytes:0}, ""],
        ["active", {launchWhenSucceeded:true,totalBytes:-1}, ""],
        ["active", {totalBytes:-1}, ""],
        ["failed", {}, "Failed to Download"],
        ["paused", {}, "Paused · from example.co.uk"],
        ["cancelled", {}, "Cancelled · from example.co.uk"],
        ["notStarted", {}, ""],
      ];
      for (const space of w.gZenWorkspaces.getWorkspaces()) {
        await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); enter(); await pause(650);
        for (const [state, extra, expected] of cases) {
          apply(x, state, extra);
          const actual = await text(x);
          check(actual === expected, `${space.name} ${state} ${JSON.stringify(extra)}: ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
          const item = row(x), image = item.querySelector(".zen-library-download-badge").getBoundingClientRect();
          const title = item.querySelector(".zen-library-download-list-title").getBoundingClientRect();
          check(image.width === 40 && image.height === 40 && image.x === 8 && title.x === 60, `${space.name} ${state}: row alignment`);
          samples.push({space:space.name,state,extra,actual,frame:image.toJSON()});
        }
        leave(); await pause(350);
      }
      enter(); await pause(650);
      for (const [url, expected] of [
        ["https://unknown.invalid/file", "Paused"],
        ["http://127.0.0.1/file", "Paused"],
        ["https://localhost/file", "Paused"],
        ["https://a.site.blogspot.com/file", "Paused · from site.blogspot.com"],
        ["https://a.city.kawasaki.jp/file", "Paused · from city.kawasaki.jp"],
      ]) {
        x.source.url = url; apply(x, "paused");
        const actual = await text(x);
        check(actual === expected, `${url}: ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
        samples.push({url,actual});
      }
      apply(x,"active",{launchWhenSucceeded:true}); apply(x,"failed"); apply(x,"notStarted");
      check(await text(x) === "", "rapid changes clear queued localized subtitles");
    } else if (phase === "lifecycle") {
      for (const [state, retained] of [["completed",false],["failed",false],["cancelled",false],["active",true],["paused",true],["notStarted",true]]) {
        const x = await add("Lifecycle " + state, state); await pause(350);
        check(foot.hasAttribute("zen-library-badge"), state + ": new badge is present");
        enter(); await pause(650);
        check(foot.hasAttribute("zen-library-stack-open"), state + ": preview opens");
        check(foot.hasAttribute("zen-library-badge") === retained, state + ": opening consumes only terminal badge");
        leave(); await pause(350);
        check(foot.hasAttribute("zen-library-badge") === retained, state + ": closing retains active/paused/not-started badge");
        if (retained) {
          apply(x,"active"); await pause(150);
          check(foot.hasAttribute("zen-library-badge"), state + ": later activity retains footer badge");
          apply(x,"completed"); await pause(350);
          check(foot.hasAttribute("zen-library-badge"), state + ": completion after closing retains footer badge");
          enter(); await pause(650); leave(); await pause(350);
          check(!foot.hasAttribute("zen-library-badge"), state + ": subsequent expansion consumes completed badge");
        }
        await downloads.remove(x); owned.splice(owned.indexOf(x),1);
      }
    } else throw new Error("Unknown phase");
  } finally {
    leave(); for (const x of owned) await downloads.remove(x);
    await IOUtils.remove(folder,{recursive:true});
  }
  return {phase,checks,failures,samples,production_profile_used:false};
})().then(done,error=>done({error:String(error),stack:error.stack}));
