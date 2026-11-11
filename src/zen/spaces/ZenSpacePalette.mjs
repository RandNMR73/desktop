/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const primaryPaletteKeys = ["tintedLight", "midTone", "shaded", "shadedDark"];
export const semanticPaletteKeys = ["foregroundPrimary", "foregroundSecondary", "foregroundTertiary",
  "maxContrastColor", "minContrastColor", "backgroundExtra", "background", "focus", "hover",
  "cutoutColor", "title", "subtitle"];

const rgba = value => Array.isArray(value) && value.length === 4 &&
  value.every(Number.isFinite) && value.slice(0, 3).every(c => Math.abs(c) <= 4) && value[3] >= 0 && value[3] <= 1;
export function validSpacePalette(value) {
  return !!value && primaryPaletteKeys.every(key => rgba(value.primary?.[key])) &&
    ["light", "dark"].every(mode => semanticPaletteKeys.every(key => rgba(value[mode]?.[key])));
}

export function unpackSpacePalette(values) {
  if (!Array.isArray(values) || values.length !== 112) return null;
  let offset = 0;
  const group = keys => Object.fromEntries(keys.map(key => [key, values.slice(offset, offset += 4)]));
  const result = { primary: group(primaryPaletteKeys), light: group(semanticPaletteKeys), dark: group(semanticPaletteKeys) };
  return validSpacePalette(result) ? result : null;
}

// The primary handle, not an average of stops, controls the semantic palette.
// Position, intensity, noise and secondary handles do not invalidate its cache.
export function spacePaletteInput(theme, imported = null) {
  const colors = theme?.gradientColors;
  if (theme?.type !== "gradient" || !Array.isArray(colors) || !colors.length || colors.length > 3) return null;
  let index = colors.findIndex(color => color?.isPrimary);
  if (index < 0) index = Math.floor(colors.length / 2);
  const color = colors[index];
  const bundled = imported?.version === 1 && imported.colors?.length === colors.length
    ? imported.colors[index] : null;
  const input = color?.p3 ? { space: "display-p3", rgb: color.p3 }
    : bundled?.space === "display-p3" ? bundled
      : !color?.isCustom && Array.isArray(color?.c) && color.c.every(Number.isFinite)
        ? { space: "srgb", rgb: color.c.map(c => c / 255) } : null;
  if (!input || !Array.isArray(input.rgb) || input.rgb.length !== 3 ||
      input.rgb.some(c => !Number.isFinite(c) || c < 0 || c > 1)) return null;
  return { space: input.space, rgb: [...input.rgb] };
}

export const paletteColorCSS = color => `color(srgb ${color.slice(0, 3).join(" ")} / ${color[3]})`;

// The update action uses the reference's BrandBlue for achromatic Spaces.
// Preserve the asset's Display P3 gamut instead of treating it as sRGB.
const updateButtonColor = color => color[0] === color[1] && color[1] === color[2]
  ? "color(display-p3 0.19215686274509805 0.2235294117647059 0.984313725490196)"
  : paletteColorCSS(color);

// Match the existing import's P3 composition for menu hover/divider colors.
// This is a UI mapping, separate from the native semantic palette calculation.
function p3(rgb) {
  const decode = c => Math.sign(c) * (Math.abs(c) <= .04045 ? Math.abs(c) / 12.92 : ((Math.abs(c) + .055) / 1.055) ** 2.4);
  const encode = c => Math.sign(c) * (Math.abs(c) <= .0031308 ? 12.92 * Math.abs(c) : 1.055 * Math.abs(c) ** (1 / 2.4) - .055);
  const matrix = [[.822461969, .177538031, 0], [.033194199, .966805801, 0], [.017082631, .072397441, .910519928]];
  const linear = rgb.map(decode);
  return matrix.map(row => encode(row.reduce((sum, c, i) => sum + c * linear[i], 0)));
}

export function spacePaletteProperties(palette, appearance) {
  if (!validSpacePalette(palette) || !["light", "dark"].includes(appearance)) return null;
  // These panels explicitly use color-scheme: dark even in a light window.
  // Choose tokens for the surface, not for the enclosing app's appearance.
  const dark = palette.dark, css = key => paletteColorCSS(dark[key]);
  const adaptive = key => `light-dark(${paletteColorCSS(palette.light[key])}, ${paletteColorCSS(palette.dark[key])})`;
  // Arc's Create menu always uses the dark semantic palette, including in
  // light Spaces. Its white labels and icons are independent of app appearance.
  const menu = dark;
  const foreground = p3(menu.hover.slice(0, 3)), background = p3(menu.backgroundExtra.slice(0, 3));
  const hover = `color(display-p3 ${foreground.map((c, i) => c * menu.hover[3] + background[i] * (1 - menu.hover[3])).join(" ")})`;
  // Preserve the existing opaque sidebar-panel calibration. This does not
  // claim that the six-percent lift is Arc's native material composition.
  const panel = `rgb(${dark.background.slice(0, 3).map(c => (Math.max(0, Math.min(1, c)) * .94 + .06) * 255).join(" ")})`;
  return {
    zenCreateNewPopup: { "--arc-menu-background": paletteColorCSS(menu.backgroundExtra), "--arc-menu-hover": hover,
      "--arc-menu-separator": hover, "--arc-menu-shortcut": paletteColorCSS(menu.subtitle) },
    urlbar: { "--arc-sidebar-command-background": panel, "--arc-command-selection": css("focus"),
      "--arc-command-text-selection": css("subtitle"), "--arc-command-selected-text": "currentColor" },
    "zen-sidebar-foot-buttons": { "--arc-download-fill": adaptive("cutoutColor"),
      "--arc-download-outline": adaptive("foregroundPrimary"), "--arc-download-foreground": adaptive("maxContrastColor") },
    "zen-update-banner": { "--zen-update-button-background":
      `light-dark(${updateButtonColor(palette.light.maxContrastColor)}, ${updateButtonColor(palette.dark.cutoutColor)})` },
    // The native editor subscribes its popup window's tooltip controller to
    // the Space palette; this also updates help while the editor stays open.
    "PanelUI-zen-gradient-generator": { "--zen-appearance-tooltip-title": adaptive("title"),
      "--zen-appearance-tooltip-background": adaptive("background") },
    "zen-library": { "--zen-library-icon-primary": adaptive("maxContrastColor"), "--zen-library-icon-secondary": adaptive("cutoutColor") },
    "tabbrowser-tabs": { "--zen-empty-favicon-fill": adaptive("maxContrastColor"),
      "--zen-space-heading-icon-fill": adaptive("maxContrastColor") },
    "zen-unified-site-data-panel": { "--arc-site-text": css("title"), "--arc-site-icon-background": css("maxContrastColor"),
      "--arc-site-icon-foreground": css("minContrastColor") },
  };
}

// Track only our declarations and never rewrite unchanged styles. Late-created
// Library elements are picked up by the Space's existing marking lifecycle.
export class SpacePaletteStyles {
  constructor() { this.elements = new Map(); }
  apply(document, properties) {
    const next = new Map();
    for (const [id, values] of Object.entries(properties ?? {})) {
      const element = id === "zen-library" ? document.querySelector(id) : document.getElementById(id);
      if (!element) continue;
      for (const [key, value] of Object.entries(values)) {
        if (element.style.getPropertyValue(key) !== value || element.style.getPropertyPriority(key) !== "important")
          element.style.setProperty(key, value, "important");
      }
      next.set(element, Object.keys(values));
    }
    for (const [element, keys] of this.elements) {
      for (const key of keys) if (!next.get(element)?.includes(key)) element.style.removeProperty(key);
    }
    this.elements = next;
  }
  clear() { this.apply(null, null); }
}
