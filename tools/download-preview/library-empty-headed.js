const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned profile required");
  const native = await IOUtils.readJSON(arguments[0]);
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { ContextualIdentityService: profiles } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 200 && !predicate(); i++) await pause(20);
    return !!predicate();
  };
  let checks = 0; const failures = [], layouts = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const list = await Downloads.getList(Downloads.PUBLIC);
  for (const download of await list.getAll()) await list.remove(download);
  const lib = d.querySelector("zen-library");
  if (!lib.hasAttribute("open")) lib.constructor.toggle("downloads");
  let s;
  if (!await until(() => (s = d.querySelector("zen-library-downloads-section")))) throw new Error("Downloads did not open");
  const empty = () => s.querySelector(".zen-library-downloads-empty");
  const input = () => s.querySelector("input");
  const rows = () => s.querySelectorAll(".zen-library-row");
  const css = element => w.getComputedStyle(element);
  const clean = text => text.replace(/[\u2066-\u2069]/g, "");
  const search = async query => {
    input().value = query; input().dispatchEvent(new w.Event("input", { bubbles: true }));
    await pause(300); await s.updateComplete;
    await d.l10n.translateElements([...s.querySelectorAll("[data-l10n-id]")]);
  };
  check(await until(() => empty()?.querySelector("h2")?.textContent === "Nothing here yet!"), "empty history uses the reference title");
  check(empty().querySelector("p").textContent === "Come back after you’ve found some\ncool stuff to save.", "empty-history message retains the explicit line break");
  check(empty().getAttribute("role") === "status", "empty-state message is exposed as status text");
  const animations = empty().getAnimations();
  check(animations.length === 2, "empty state has separate spring and opacity animations");
  const rise = animations.find(a => a.animationName === "zen-library-empty-rise");
  const fade = animations.find(a => a.animationName === "zen-library-empty-fade");
  if (rise && fade) {
    rise.pause(); fade.pause(); rise.currentTime = 0; fade.currentTime = 0;
    check(Math.abs(new w.DOMMatrixReadOnly(css(empty()).transform).m42 - 16) < 0.001 && css(empty()).opacity === "0", "entrance starts 16pt lower and transparent");
    check(Math.abs(rise.effect.getTiming().duration / 1000 - native.duration) < 1e-6, "spring duration matches independent SwiftUI reference");
    check(fade.effect.getTiming().duration === 125 && fade.effect.getKeyframes()[0].easing === "ease-out", "opacity uses 125ms ease-out");
    for (const index of [12, 24, 36, 48, 72, 96]) {
      rise.currentTime = native.duration * 1000 * index / 120;
      const y = new w.DOMMatrixReadOnly(css(empty()).transform).m42;
      check(Math.abs(y - 16 * (1 - native.samples[index])) < 0.002, "native spring sample " + index);
    }
    rise.finish(); fade.finish();
  }
  const root = PathUtils.join(PathUtils.profileDir, "owned-empty");
  await IOUtils.makeDirectory(root);
  const path = PathUtils.join(root, "owned-report.json");
  await IOUtils.writeUTF8(path, "{}");
  const download = await Downloads.createDownload({ source: { url: "https://example.invalid/owned-report.json", userContextId: 0 }, target: path });
  download.succeeded = true; download.stopped = true; download.startTime = new Date();
  await download.target.refresh(); download._setBytes(download.target.size, download.target.size, true);
  await list.add(download);
  check(await until(() => rows().length === 1 && !empty()), "a new download replaces the empty state");
  await search("  owned-report  ");
  check(s.searchQuery === "  owned-report  " && rows().length === 0, "surrounding spaces are retained in matching");
  check(clean(empty().querySelector("p").textContent) === "No results found for “  owned-report  ”", "empty search displays the complete typed query");
  check(!empty().querySelector("h2"), "empty search omits the history-empty title");
  await search("owned-report");
  check(rows().length === 1 && !empty(), "same query without surrounding spaces matches");
  await search("   ");
  check(s.searchQuery === "   " && !empty().querySelector("h2"), "whitespace-only query remains a search");
  for (const query of ['owned <b>"雪" & preview</b>', '&lt;b&gt;literal&lt;/b&gt;', '<img src="x"> &copy;']) {
    await search(query);
    const message = empty().querySelector("p");
    check(!message.children.length && clean(message.textContent) === `No results found for “${query}”`, "query markup, entities and Unicode remain literal text: " + query);
  }
  await search("preview-reference-fixture");
  const spaces = w.gZenWorkspaces.getWorkspaces();
  check(spaces.length === 5, "five reference Spaces");
  for (const space of spaces) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); await pause(200);
    empty().getAnimations().forEach(a => a.finish());
    const results = s.querySelector(".zen-library-search-results").getBoundingClientRect();
    const box = empty().getBoundingClientRect(), icon = empty().querySelector("img"), p = empty().querySelector("p");
    const symbol = icon.getBoundingClientRect(), text = p.getBoundingClientRect();
    const scheme = css(lib).colorScheme, dark = scheme === "dark";
    check(Math.abs((box.left + box.right) / 2 - (results.left + results.right) / 2) < 0.1 && Math.abs((box.top + box.bottom) / 2 - (results.top + results.bottom) / 2) < 0.1, space.name + ": state centers in the results area");
    check(symbol.width === 48 && symbol.height === 48 && icon.naturalWidth === 48, space.name + ": 48pt native symbol loads");
    check(css(icon).opacity === "0.3" && css(icon).fill === (dark ? "rgba(255, 255, 255, 0.847)" : "rgba(0, 0, 0, 0.847)"), space.name + ": primary symbol color and opacity");
    check(Math.abs(text.top - symbol.bottom - 16) < 0.1, space.name + ": 16pt symbol-to-message gap");
    check(css(p).fontSize === "14px" && css(p).fontWeight === "400" && text.width <= 270 && css(p).textAlign === "center" && css(p).whiteSpace === "pre-wrap", space.name + ": reference message type and width with literal whitespace");
    check(css(p).color === (dark ? "rgba(255, 255, 255, 0.592)" : "rgba(0, 0, 0, 0.565)"), space.name + ": GrayA11 message color");
    const placeholder = w.getComputedStyle(input(), "::placeholder");
    check(placeholder.opacity === "1" && placeholder.color === (dark ? "rgba(255, 255, 255, 0.247)" : "rgba(0, 0, 0, 0.247)"), space.name + ": native placeholder color without extra opacity");
    check(css(s.querySelector(".zen-library-search-sentinel")).display === "none", space.name + ": empty state does not request more pages");
    layouts.push({ space: space.name, scheme, resultBounds: results.toJSON(), emptyBounds: box.toJSON(), iconBounds: symbol.toJSON(), messageBounds: text.toJSON(), placeholder: placeholder.color });
  }
  await search("preview-".repeat(35)); empty().getAnimations().forEach(a => a.finish());
  check(empty().querySelector("p").getBoundingClientRect().width <= 270 && s.scrollWidth <= s.clientWidth, "long queries wrap without horizontal overflow");
  await search("");
  check(rows().length === 1 && !empty(), "clearing query restores the download");
  const profile = profiles.create("Owned Empty Profile", "briefcase", "blue");
  s.querySelector(".zen-library-filter-button").click(); await s.updateComplete;
  s.querySelector(`.zen-library-filter-chip[data-filter-option="${profile.userContextId}"]`).click();
  s.querySelector(".zen-library-filter-done").click(); await s.updateComplete;
  check(await until(() => empty()?.querySelector("h2")?.textContent === "Nothing here yet!"), "empty selected profile uses the history-empty state");
  s.querySelector(".zen-library-selected-filter").click(); await s.updateComplete;
  check(await until(() => rows().length === 1 && !empty()), "removing empty profile chip restores results");
  profiles.remove(profile.userContextId);
  await search("preview-reference-fixture");
  lib.constructor.toggle("downloads"); await pause(400); lib.constructor.toggle("downloads");
  await until(() => lib.hasAttribute("open"));
  check(empty().getAnimations().length === 2, "reopening replays the empty-state entrance");
  await w.gZenWorkspaces.changeWorkspaceWithID(spaces[0].uuid); await pause(1000);
  return { checks, failures, layouts, productionProfileUsed: false, exactParityClaimed: false };
})().then(done, error => done({ error: String(error), stack: error.stack }));
