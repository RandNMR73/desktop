const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-sidebar-consistency-")) {
    throw Error("Disposable profile required");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const ws = w.gZenWorkspaces, doc = w.document, spaces = ws.getWorkspaces();
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const original = {space: ws.activeWorkspace, compact: w.gZenCompactModeManager.preference};
  const move = (x, y) => new Promise((resolve, reject) => {
    const scale = w.devicePixelRatio;
    const timer = w.setTimeout(() => reject(Error("Native mouse callback timed out")), 3000);
    w.windowUtils.sendNativeMouseEvent(Math.round((w.mozInnerScreenX + x) * scale),
      Math.round((w.mozInnerScreenY + y) * scale), 3, 0, 0, w.gNavToolbox,
      () => { w.clearTimeout(timer); w.setTimeout(resolve, 0); });
  });
  const outside = () => {
    const box = w.gNavToolbox.getBoundingClientRect();
    return move(box.x + box.width / 2, box.y + 80);
  };
  const read = button => [...button.querySelectorAll(".zen-workspace-icon")].map(node => {
    const style = w.getComputedStyle(node);
    return {colored: node.classList.contains("zen-space-colored-icon"),
      opacity: +style.opacity, color: style.color,
      duration: style.transitionDuration, easing: style.transitionTimingFunction,
      animations: node.getAnimations().filter(animation => animation.transitionProperty === "opacity").map(animation => ({
        duration: animation.effect.getTiming().duration,
        easing: animation.effect.getTiming().easing,
        keyframes: animation.effect.getKeyframes().map(frame => ({opacity: frame.opacity, easing: frame.easing})),
      }))};
  });
  const close = (a, b) => Math.abs(a - b) < 1e-5;
  const cases = [];
  let pointerEvents = null;
  const recordPointer = event => {
    pointerEvents?.push({type: event.type, x: event.clientX, y: event.clientY,
      target: event.target.closest?.("toolbarbutton")?.getAttribute("zen-workspace-id") ?? event.target.id,
      focused: doc.hasFocus()});
  };
  for (const name of ["mousemove", "mouseover", "mouseout"]) w.addEventListener(name, recordPointer, true);
  try {
    for (const compact of [false, true]) {
      w.gZenCompactModeManager.preference = compact;
      w.gNavToolbox.toggleAttribute("zen-user-show", compact);
      await pause(400);
      for (let index = 0; index < spaces.length; index++) {
        for (const active of [false, true]) {
          await outside();
          await ws.changeWorkspaceWithID(spaces[active ? index : (index + 1) % spaces.length].uuid);
          await pause(400);
          const button = doc.querySelector(`#zen-workspaces-button toolbarbutton[zen-workspace-id="${spaces[index].uuid}"]`);
          if (!button) throw Error("Missing Space button");
          const rest = read(button);
          const box = button.getBoundingClientRect();
          pointerEvents = [];
          await move(box.x + box.width / 2, box.y + box.height / 2);
          // Force style so the transition exists before the next refresh tick.
          const entering = read(button);
          const hovered = button.matches(":hover");
          await pause(320);
          const held = read(button);
          const heldHovered = button.matches(":hover");
          await outside();
          const leaving = read(button);
          await pause(320);
          const settled = read(button);
          const animations = [...entering, ...leaving].flatMap(layer => layer.animations);
          const checks = {
            hovered,
            active: (button.getAttribute("active") === "true") === active,
            nativeDuration: animations.length >= 2 && animations.every(animation => animation.duration === 250),
            nativeEasing: animations.every(animation => animation.easing === "ease"),
            held: held.every(layer => close(layer.opacity, layer.colored ? 1 : 0)),
            restored: settled.every((layer, i) => close(layer.opacity, rest[i].opacity) && layer.color === rest[i].color),
            heldPalette: held.find(layer => layer.colored).color === rest.find(layer => layer.colored).color,
          };
          cases.push({compact, index, active, checks, rest, entering, held, leaving, settled,
            heldHovered, pointerEvents, targetBounds: {x: box.x, y: box.y, width: box.width, height: box.height},
            passed: Object.values(checks).every(Boolean)});
          pointerEvents = null;
        }
      }
    }
    return {input: "Native mouse events in a headed disposable browser; not physical Arc captures",
      count: cases.length, passed: cases.every(row => row.passed), cases};
  } finally {
    for (const name of ["mousemove", "mouseover", "mouseout"]) w.removeEventListener(name, recordPointer, true);
    await outside();
    w.gZenCompactModeManager.preference = original.compact;
    w.gNavToolbox.toggleAttribute("zen-user-show", original.compact);
    await ws.changeWorkspaceWithID(original.space);
  }
})().then(done, error => done({error: String(error), stack: error.stack}));
