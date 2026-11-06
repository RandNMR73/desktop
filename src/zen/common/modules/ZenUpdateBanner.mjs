/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const { ZenForkUpdates } = ChromeUtils.importESModule("resource:///modules/ZenForkUpdates.sys.mjs");
import { ThemeControlSpring } from "resource:///modules/zen/ZenThemeColorPad.mjs";
import { UpdateBannerMotion } from "chrome://browser/content/zen-components/ZenUpdateBannerMotion.mjs";
import { createNativeUpdateButton } from "resource:///modules/zen/ZenNativeTheme.sys.mjs";

export function initUpdateBanner(window, updates = ZenForkUpdates) {
  const document = window.document;
  const footer = document.getElementById("zen-sidebar-foot-buttons");
  if (!footer || document.getElementById("zen-update-banner")) return null;
  const html = name => document.createElementNS("http://www.w3.org/1999/xhtml", name);
  const stylesheet = html("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "chrome://browser/content/zen-styles/zen-update-banner.css";
  document.documentElement.append(stylesheet);
  const host = html("div");
  host.id = "zen-update-banner";
  host.hidden = true;
  const card = html("div");
  card.className = "zen-update-card";
  const title = html("button");
  title.type = "button";
  title.className = "zen-update-title";
  title.textContent = "New Zen Version Available";
  title.setAttribute("aria-expanded", "false");
  title.setAttribute("aria-controls", "zen-update-actions");
  const body = html("div");
  body.id = "zen-update-actions";
  body.inert = true;
  const automaticLabel = html("label");
  automaticLabel.className = "zen-update-automatic";
  const automatic = html("input");
  automatic.type = "checkbox";
  automaticLabel.append(automatic, "Automatic Updates");
  const primary = html("button");
  primary.type = "button";
  primary.className = "zen-update-primary";
  const primaryLabel = html("span");
  primaryLabel.className = "zen-update-primary-label";
  primaryLabel.textContent = "Restart and Update";
  const surface = html("span");
  surface.className = "zen-update-primary-surface";
  surface.setAttribute("aria-hidden", "true");
  const material = html("span");
  material.className = "zen-update-material";
  for (const name of ["light", "shade"]) {
    const layer = html("span");
    layer.className = `zen-update-material-${name}`;
    material.append(layer);
  }
  // SwiftUI brightness adds to RGB; CSS brightness() multiplies it. Keep
  // the two color pipelines explicit rather than substituting that filter.
  const svg = name => document.createElementNS("http://www.w3.org/2000/svg", name);
  const filters = svg("svg");
  filters.setAttribute("width", "0");
  filters.setAttribute("height", "0");
  filters.setAttribute("aria-hidden", "true");
  for (const [name, hue, saturation, brightness] of [["light", 40, 5, 1.25], ["shade", -20, 2, -.5]]) {
    const filter = svg("filter");
    filter.id = `zen-update-${name}-color`;
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("x", "-200%");
    filter.setAttribute("y", "-800%");
    filter.setAttribute("width", "500%");
    filter.setAttribute("height", "1700%");
    for (const [type, values] of [["hueRotate", hue], ["saturate", saturation]]) {
      const matrix = svg("feColorMatrix");
      matrix.setAttribute("type", type);
      matrix.setAttribute("values", values);
      filter.append(matrix);
    }
    const transfer = svg("feComponentTransfer");
    for (const channel of ["R", "G", "B"]) {
      const component = svg(`feFunc${channel}`);
      component.setAttribute("type", "linear");
      component.setAttribute("slope", "1");
      component.setAttribute("intercept", brightness);
      transfer.append(component);
    }
    filter.append(transfer);
    filters.append(filter);
  }
  surface.append(material);
  primary.append(surface, primaryLabel);
  host.append(filters);
  const status = html("div");
  status.className = "zen-update-status";
  status.setAttribute("role", "status");
  body.append(automaticLabel, primary, status);
  card.append(title, body);
  host.append(card);
  footer.before(host);

  let nativeButton, paintFrame = 0, disposed = false, observedPanel;
  const paint = () => {
    paintFrame = 0;
    if (disposed) return;
    host.toggleAttribute("native-update-button", nativeButton?.sync(host, primary, body) === true);
    // Sidebar reveal/pin transitions move ancestors without resizing them.
    // Follow only finite movement; the native material itself needs no JS loop.
    for (let element = primary.parentElement; element; element = element.parentElement) {
      if (element.getAnimations().some(animation =>
        (animation.pending || animation.playState === "running") &&
        animation.effect?.getComputedTiming().iterations !== Infinity)) {
        paintFrame = window.requestAnimationFrame(paint);
        break;
      }
    }
  };
  const schedulePaint = () => {
    if (disposed || (host.hidden && !host.hasAttribute("native-update-button"))) return;
    const panel = document.getElementById("zen-native-sidebar-panel");
    if (panel && panel !== observedPanel) {
      observedPanel = panel;
      paintObserver.observe(panel, { attributes: true,
        attributeFilter: ["native-preparing", "native-ready", "style", "hidden"] });
    }
    if (!paintFrame) paintFrame = window.requestAnimationFrame(paint);
  };
  const paintObserver = new window.MutationObserver(schedulePaint);
  paintObserver.observe(host, { attributes: true, attributeFilter: ["style", "hidden", "data-phase"] });
  paintObserver.observe(body, { attributes: true, attributeFilter: ["style"] });
  paintObserver.observe(primary, { attributes: true, attributeFilter: ["disabled"] });
  paintObserver.observe(primaryLabel, { childList: true });
  paintObserver.observe(document.documentElement, { attributes: true, attributeFilter:
    ["zen-compact-mode", "zen-compact-animating", "zen-native-sidebar-slide", "inDOMFullscreen"] });
  const toolbox = document.getElementById("navigator-toolbox");
  if (toolbox) paintObserver.observe(toolbox, { attributes: true, attributeFilter:
    ["style", "zen-has-hover", "zen-user-show", "zen-has-empty-tab", "zen-compact-mode-active"] });
  const sizeObserver = new window.ResizeObserver(schedulePaint);
  sizeObserver.observe(primary);
  sizeObserver.observe(body);
  const paintEvents = ["resize", "sizemodechange", "fullscreen", "activate",
    "popupshown", "popuphidden", "ZenCompactMode:LayoutUpdate", "ZenCompactMode:Toggled",
    "ZenNativeThemeChanged", "ZenNativeThemeReady"];
  for (const event of paintEvents) window.addEventListener(event, schedulePaint, true);
  const interactionEvents = ["pointerdown", "pointerup", "keydown", "keyup"];
  const interactionPaint = event => {
    if (host.contains(event.target) || host.hasAttribute("native-update-button")) schedulePaint();
  };
  for (const event of interactionEvents) window.addEventListener(event, interactionPaint, true);
  const media = ["(prefers-reduced-motion: reduce)", "(forced-colors: active)", "(prefers-contrast: more)"]
    .map(query => window.matchMedia(query));
  for (const query of media) query.addEventListener("change", schedulePaint);
  createNativeUpdateButton(window).then(surface => {
    if (disposed) { surface?.clear(); return; }
    nativeButton = surface;
    schedulePaint();
  });

  const render = (value, active) => {
    host.style.setProperty("--zen-update-progress", Math.max(0, Math.min(1, value)));
    body.style.height = `${Math.max(0, value) * (host.dataset.phase === "error" ? 104 : 64)}px`;
    body.style.visibility = value > 0 || active ? "visible" : "hidden";
    host.toggleAttribute("animating", active);
  };
  const motion = new UpdateBannerMotion({
    now: () => window.performance.now(),
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: id => window.clearTimeout(id),
    requestAnimationFrame: fn => window.requestAnimationFrame(fn),
    cancelAnimationFrame: id => window.cancelAnimationFrame(id),
  }, new ThemeControlSpring([64, 1]), render, expanded => {
    host.toggleAttribute("expanded", expanded);
    title.setAttribute("aria-expanded", String(expanded));
    body.inert = !expanded;
  });
  host.addEventListener("pointerenter", () => motion.hover(true));
  host.addEventListener("pointerleave", () => motion.hover(false));
  host.addEventListener("focusin", () => motion.focus(true));
  host.addEventListener("focusout", event => motion.focus(host.contains(event.relatedTarget)));
  automatic.addEventListener("change", () => { updates.automatic(automatic.checked); });
  primary.addEventListener("click", () => { updates.restart(); });
  const unsubscribe = updates.subscribe(state => {
    const busy = state.restarting || ["preparing", "waiting", "installing"].includes(state.phase);
    host.hidden = state.phase === "idle";
    host.dataset.phase = state.phase;
    automatic.checked = state.automatic;
    automatic.disabled = busy;
    primary.disabled = busy;
    primaryLabel.textContent = state.phase === "preparing" ? "Preparing Update…"
      : state.phase === "waiting" || state.phase === "installing" ? "Restarting…"
        : state.phase === "error" ? "Try Again" : "Restart and Update";
    // Errors are actionable, but never expose paths or helper diagnostics in UI.
    status.textContent = state.phase === "error" ? "Update couldn’t finish. Please try again." : "";
    if (host.hidden) {
      motion.reset();
    } else render(motion.value, motion.spring.active);
  });
  window.addEventListener("unload", () => {
    disposed = true;
    unsubscribe(); motion.reset();
    paintObserver.disconnect(); sizeObserver.disconnect();
    for (const event of paintEvents) window.removeEventListener(event, schedulePaint, true);
    for (const event of interactionEvents) window.removeEventListener(event, interactionPaint, true);
    for (const query of media) query.removeEventListener("change", schedulePaint);
    if (paintFrame) window.cancelAnimationFrame(paintFrame);
    nativeButton?.clear();
  }, { once: true });
  return host;
}
