const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-sidebar-consistency-")) {
    throw Error("Disposable profile required");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const library = w.document.querySelector("zen-library"), Library = library.constructor;
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const read = () => ({progress: library.openProgress, open: Library.isLibraryOpen,
    transitioning: library.hasAttribute("transitioning"), pointerEvents: library.style.pointerEvents});
  const cases = [];
  try {
    for (const compact of [false, true]) {
      w.gZenCompactModeManager.preference = compact;
      w.gNavToolbox.toggleAttribute("zen-user-show", compact);
      for (const initial of [0, 1]) {
        for (const kind of ["cancel-movement", "cancel-still", "release-success", "native-return"]) {
        for (const early of kind.startsWith("cancel") ? [false, true] : [false]) {
          await Library.animateProgress(initial);
          await pause(1200);
          const start = Library.startSwipe();
          if (!early) await start;
          const direction = Library.libraryOnRight ? -1 : 1;
          if (kind !== "cancel-still") Library.swipeProgress((initial ? -.15 : .15) * direction);
          const dragged = read();
          if (kind === "release-success") Library.stopSwipe((initial ? 1 : -1) * direction);
          if (kind === "native-return") Library.swipeProgress(0);
          Library.swipeAnimationEnd();
          await start;
          await pause(1400);
          const settled = read();
          const expected = kind === "release-success" ? 1 - initial : initial;
          cases.push({compact, initial, kind, early, dragged, settled, expected,
            passed: Math.abs(settled.progress - expected) < 1e-6 && settled.open === !!expected &&
              !settled.transitioning && settled.pointerEvents === ""});
        }
        }
      }
    }
    return {input: "Direct Library lifecycle calls in a headed browser; not native or physical input",
      cases, count: cases.length, passed: cases.every(c => c.passed)};
  } finally {
    Library.close();
    await pause(1400);
  }
})().then(done, error => done({error: String(error), stack: error.stack}));
