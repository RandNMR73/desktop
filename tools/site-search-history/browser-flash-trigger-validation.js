const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-typed-"))
    throw Error("Disposable profile required");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), bar = w.gURLBar;
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const library = ctypes.open(arguments[0]);
  const inspect = library.declare("zen_test_splash_state", ctypes.default_abi, ctypes.char.ptr);
  const checks = [], samples = [];
  let phase = "initial";
  const wait = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const state = () => JSON.parse(inspect().readString());
  const seen = name => samples.filter(sample => sample.phase === name).flatMap(sample => sample.views);
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
  const preference = "zen.urlbar.site-search.colors";
  const previous = Services.prefs.getStringPref(preference, "");
  const timer = w.setInterval(() => samples.push({ phase, views: state() }), 5);
  const enter = (name, engineName) => {
    phase = name;
    bar.searchMode = { engineName, entry: "shortcut", isPreview: false };
    bar.setValue(""); bar.startQuery({ searchString: "" });
  };
  try {
    await P.history.clear();
    Services.prefs.setStringPref(preference, "YouTube=#ff0000,Reddit=#0000ff");
    bar.searchMode = null;
    w.gZenUIManager.handleNewTab(false, false, "tab", true);
    await wait(250);
    enter("colored-entry", "YouTube"); await wait(300);
    const first = state()[0];
    check("colored entry flashes and springs", seen(phase).some(v => v.splash && v.animation && v.token > 0));
    enter("missing-switch", "Amazon"); await wait(300);
    check("missing color does not restart the spring or splash", seen(phase).length > 0 &&
      seen(phase).every(v => v.token === first.token && v.bounceToken === first.bounceToken && !v.animation), seen(phase));
    check("missing color retains the previous pill color", bar.style.getPropertyValue("--zen-site-search-color") === "#ff0000");
    enter("colored-switch", "Reddit"); await wait(300);
    check("newly resolved color flashes when switching scopes", seen(phase).some(v =>
      v.splash && v.animation && v.token > first.token && v.token === v.bounceToken));
    check("resolved scope replaces the pill color", bar.style.getPropertyValue("--zen-site-search-color") === "#0000ff");
    phase = "exit"; bar.searchMode = null; await wait(300);
    check("exit springs without a colored splash", seen(phase).some(v => v.animation && !v.splash && v.token === 0));
    enter("missing-entry", "Amazon"); await wait(300);
    check("entry without a color still springs", seen(phase).some(v => v.animation && v.bounceToken > 0));
    check("entry without a color does not flash a fallback color", seen(phase).length > 0 && seen(phase).every(v => !v.splash && v.token === 0));
    enter("rapid-entry", "YouTube"); await wait(35);
    const rapid = state()[0];
    enter("rapid-missing", "Amazon"); await wait(250);
    check("a rapid missing-color switch preserves the in-flight entry effect", seen(phase).some(v => v.splash) &&
      seen(phase).every(v => v.token === rapid.token && v.bounceToken === rapid.bounceToken), { rapid, views: seen(phase) });
    phase = "typing"; bar.setValue("lattice"); bar.startQuery({ searchString: "lattice" }); await wait(250);
    check("typing does not restart the effect", seen(phase).length > 0 && seen(phase).every(v => !v.animation && v.token === rapid.token));
    phase = "closed"; bar.view.close(); bar.blur(); await wait(100);
    check("closing removes all native command decorations", seen(phase).length === 0);
    done({ passed: checks.every(c => c.pass), checks, samples });
  } finally {
    w.clearInterval(timer); bar.view.close(); bar.blur(); bar.searchMode = null;
    Services.prefs.setStringPref(preference, previous); library.close();
  }
})().catch(error => done({ passed: false, error: String(error), stack: error.stack }));
