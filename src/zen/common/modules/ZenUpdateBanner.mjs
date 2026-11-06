/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const { ZenForkUpdates } = ChromeUtils.importESModule("resource:///modules/ZenForkUpdates.sys.mjs");
import { ThemeControlSpring } from "resource:///modules/zen/ZenThemeColorPad.mjs";
import { UpdateBannerMotion } from "chrome://browser/content/zen-components/ZenUpdateBannerMotion.mjs";

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
  primary.textContent = "Restart and Update";
  const status = html("div");
  status.className = "zen-update-status";
  status.setAttribute("role", "status");
  body.append(automaticLabel, primary, status);
  card.append(title, body);
  host.append(card);
  footer.before(host);

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
    primary.textContent = state.phase === "preparing" ? "Preparing Update…"
      : state.phase === "waiting" || state.phase === "installing" ? "Restarting…"
        : state.phase === "error" ? "Try Again" : "Restart and Update";
    // Errors are actionable, but never expose paths or helper diagnostics in UI.
    status.textContent = state.phase === "error" ? "Update couldn’t finish. Please try again." : "";
    if (host.hidden) {
      motion.reset();
    } else render(motion.value, motion.spring.active);
  });
  window.addEventListener("unload", () => { unsubscribe(); motion.reset(); }, { once: true });
  return host;
}
