// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Arc's two inset strokes follow an AppKit rounded path, starting bottom-left. */
export function developerRing(width, height, favorite = false) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 24 ||
    height < 24
  )
    return null;
  if (favorite) return favoriteRing(width, height);
  const right = width - 1;
  const bottom = height - 1;
  const radius = 11;
  const control = radius * 0.55228;
  const leftCenter = 1 + radius;
  const rightCenter = right - radius;
  const topCenter = 1 + radius;
  const bottomCenter = bottom - radius;
  const path = [
    `M${leftCenter} ${bottom}`,
    `C${leftCenter - control} ${bottom} 1 ${bottomCenter + control} 1 ${bottomCenter}`,
    `L1 ${topCenter}`,
    `C1 ${topCenter - control} ${leftCenter - control} 1 ${leftCenter} 1`,
    `L${rightCenter} 1`,
    `C${rightCenter + control} 1 ${right} ${topCenter - control} ${right} ${topCenter}`,
    `L${right} ${bottomCenter}`,
    `C${right} ${bottomCenter + control} ${rightCenter + control} ${bottom} ${rightCenter} ${bottom} Z`,
  ].join(" ");
  const innerWidth = width - 2;
  const segments = innerWidth < 210 ? 60 : innerWidth < 346 ? 80 : 100;
  const dash =
    (2 * innerWidth + 2 * (height - 2) - 88 + 2 * Math.PI * radius) / segments;
  return { path, dash, viewBox: `0 0 ${width} ${height}` };
}

// SwiftUI's continuous 11 pt corner has three cubics per corner. These control
// distances were measured from an owned SwiftUI Path fixture, not approximated
// with the circular AppKit path used by ordinary tabs.
function favoriteRing(width, height) {
  const right = width - 1,
    bottom = height - 1;
  const a = 16.815314412117004,
    b = 11.973390102386475,
    c = 9.55247712135315,
    d = 6.946433842182159,
    e = 0.8240254074335098,
    f = 1.8596600741147995,
    g = 4.101064145565033;
  const commands = [`M${right} ${height / 2}`];
  const corner = [
    [0, -a],
    [0, -b, 0, -c, -e, -d],
    [-f, -g, -g, -f, -d, -e],
    [-c, 0, -b, 0, -a, 0],
  ];
  const transforms = [
    (x, y) => [right + x, bottom + y],
    (x, y) => [1 - y, bottom + x],
    (x, y) => [1 - x, 1 - y],
    (x, y) => [right + y, 1 - x],
  ];
  for (const transform of transforms) {
    for (const points of corner) {
      const mapped = [];
      for (let i = 0; i < points.length; i += 2)
        mapped.push(...transform(points[i], points[i + 1]));
      commands.push((points.length === 2 ? "L" : "C") + mapped.join(" "));
    }
  }
  return {
    path: commands.join(" ") + " Z",
    dash: 6,
    viewBox: `0 0 ${width} ${height}`,
  };
}

/** One observer for developer rows; no polling, animation loop or layout reads. */
export class ZenDeveloperSidebar {
  #window;
  #rows = new Map();
  #backgrounds = new WeakMap();
  #observer;

  constructor(window) {
    this.#window = window;
  }

  update(tab, host) {
    if (!host || !tab.isConnected || tab.closing) {
      this.remove(tab);
      return;
    }
    let row = this.#rows.get(tab);
    if (!row) {
      const background = tab.querySelector(".tab-background");
      const labels = tab.querySelector(".tab-label-container");
      if (!background || !labels) return;
      const d = this.#window.document;
      const ring = d.createElementNS(SVG_NS, "svg");
      ring.classList.add("zen-developer-ring");
      ring.setAttribute("aria-hidden", "true");
      const paths = [false, true].map(() => {
        const path = d.createElementNS(SVG_NS, "path");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke-width", "2");
        ring.append(path);
        return path;
      });
      const subtitle = d.createElement("span");
      subtitle.className = "zen-developer-host";
      labels.append(subtitle);
      background.append(ring);
      tab.setAttribute("zen-developer-tab", "true");
      row = {
        tab,
        background,
        ring,
        paths,
        subtitle,
        host: null,
        width: 0,
        height: 0,
      };
      this.#rows.set(tab, row);
      this.#backgrounds.set(background, row);
      this.#observer ||= new this.#window.ResizeObserver((entries) => {
        for (const entry of entries) {
          const current = this.#backgrounds.get(entry.target);
          if (!current) continue;
          const { width, height } = entry.contentRect;
          if (current.width === width && current.height === height) continue;
          current.width = width;
          current.height = height;
          const geometry = developerRing(
            width,
            height,
            current.tab.hasAttribute("zen-essential"),
          );
          if (!geometry) continue; // Hidden Spaces receive their size when shown.
          current.ring.setAttribute("viewBox", geometry.viewBox);
          for (const path of current.paths)
            path.setAttribute("d", geometry.path);
          current.paths[1].setAttribute(
            "stroke-dasharray",
            `${geometry.dash} ${geometry.dash}`,
          );
        }
      });
      this.#observer.observe(background);
    }
    if (row.host !== host) {
      row.subtitle.textContent = host;
      row.host = host;
    }
  }

  remove(tab) {
    const row = this.#rows.get(tab);
    if (!row) return;
    this.#observer.unobserve(row.background);
    this.#backgrounds.delete(row.background);
    row.ring.remove();
    row.subtitle.remove();
    tab.removeAttribute("zen-developer-tab");
    this.#rows.delete(tab);
    if (!this.#rows.size) {
      this.#observer.disconnect();
      this.#observer = null;
    }
  }

  destroy() {
    for (const tab of this.#rows.keys()) this.remove(tab);
  }
}
