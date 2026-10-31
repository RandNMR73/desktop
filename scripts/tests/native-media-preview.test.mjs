import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../../src/zen/library/ZenNativeMediaPreview.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replaceAll("export ", "");
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const context = vm.createContext({ console: { error() {} },
    downloadDate: d => d.startTime,
    mediaKindOf: path => /\.(png|jpeg|svg)$/.test(path) ? "image" : "file",
    extensionOf: path => path.split(".").at(-1).toLowerCase(),
    Services: { appinfo: { OS: "Other" } },
  });
  const { ZenNativeMediaPreview: Preview, downloadCanPreview } = vm.runInContext(
    source + "\n({ZenNativeMediaPreview, downloadCanPreview})", context);
  const timers = new Map(), listeners = new Map(), calls = [], events = [];
  let serial = 0;
  const window = {
    matchMedia: () => ({ matches: true }),
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
    setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
    document: { l10n: { formatValues: async keys => keys.map(k => k.id),
      formatValue: async id => id, formatMessages: async keys => keys.map(k => ({ attributes: [{ name: "label", value: k.id }] })) } },
  };
  const api = { captures: true, open: (win, request) => { calls.push(["open", request]); return ++serial; },
    poll: () => events.shift(), close: id => calls.push(["close", id]),
    finish: (...args) => calls.push(["finish", ...args]) };
  const files = { date: t => "date " + t, destroy() { calls.push(["destroy files"]); } };
  const actions = { execute: async (...args) => calls.push(["execute", ...args]), destroy() {} };
  const preview = new Preview(window, api, files, actions);
  return { preview, api, window, calls, events, timers, listeners, actions, downloadCanPreview,
    flush: () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); } };
}
const file = (name, extra = {}) => ({ target: { path: "/owned/" + name, exists: true }, startTime: 123,
  succeeded: true, stopped: true, ...extra });

test("download preview routing accepts images and PDFs, leaves movie/installers and unavailable files alone", () => {
  const f = fixture();
  for (const name of ["image.png", "document.PDF", "vector.svg"]) assert.equal(f.downloadCanPreview(file(name)), true);
  for (const d of [file("movie.mp4"), file("install.dmg"), file("a.pdf", { succeeded: false }),
    file("a.pdf", { deleted: true }), file("a.pdf", { target: { path: "/owned/a.pdf", exists: false } })]) {
    assert.equal(!!f.downloadCanPreview(d), false);
  }
});

test("a clicked wrapper resolves by file path; file order and dates reach native unchanged", async () => {
  const f = fixture();
  assert.equal(await f.preview.openDownloads(file("b.pdf"), [file("a.png"), file("installer.dmg"), file("b.pdf")]), true);
  const request = f.calls[0][1];
  assert.equal(request.index, 1);
  assert.deepEqual(Array.from(request.items, i => i.path), ["/owned/a.png", "/owned/b.pdf"]);
  assert.equal(request.items[1].date, "date 123");
  assert.equal(f.timers.size, 1);
  f.preview.destroy();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});

test("closing while localization is pending cannot reopen a dismissed window or launch a fallback", async () => {
  const f = fixture(); let resolve;
  f.window.document.l10n.formatValues = () => new Promise(r => resolve = r);
  const opened = f.preview.openDownloads(file("a.pdf"), [file("a.pdf")]);
  f.preview.close(); resolve(["Close", "Back", "Forward", "More"]);
  assert.equal(await opened, true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.preview.isOpen, false);
});

test("native Escape releases the session and stops idle polling", async () => {
  const f = fixture();
  await f.preview.openDownloads(file("a.pdf"), [file("a.pdf")]);
  f.events.push({ closed: true }); f.flush();
  assert.equal(f.preview.isOpen, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.at(-1)[0], "close");
});

test("hide/trash finish only after shared persistence succeeds; stale completions cannot change a replacement", async () => {
  const f = fixture(); let resolve;
  f.actions.execute = () => new Promise(r => resolve = r);
  await f.preview.openDownloads(file("a.pdf"), [file("a.pdf")]);
  f.events.push({ events: [{ action: "hide", token: 0 }] }); f.flush();
  assert.equal(f.calls.some(c => c[0] === "finish"), false);
  await f.preview.openDownloads(file("b.pdf"), [file("b.pdf")]);
  resolve(); await tick();
  assert.equal(f.calls.some(c => c[0] === "finish"), false);
  f.actions.execute = async () => {};
  f.events.push({ events: [{ action: "trash", token: 0 }] }); f.flush(); await tick();
  assert.equal(f.calls.at(-1).at(-1), 1);
});

test("a failed hide/trash leaves the file selected and re-enables its native actions", async () => {
  const f = fixture(); f.actions.execute = async () => { throw new Error("disk full"); };
  await f.preview.openDownloads(file("a.pdf"), [file("a.pdf")]);
  f.events.push({ events: [{ action: "hide", token: 0 }] }); f.flush(); await tick();
  assert.equal(f.calls.at(-1)[0], "finish");
  assert.equal(f.calls.at(-1).at(-1), 0);
});

test("native refusal falls back without leaving timers or item ownership", async () => {
  const f = fixture(); f.api.open = () => 0;
  assert.equal(await f.preview.openDownloads(file("a.pdf"), [file("a.pdf")]), false);
  assert.equal(f.preview.isOpen, false);
  assert.equal(f.timers.size, 0);
});

test("capture identity and even an empty title reach native without substituting the cache filename", async () => {
  const f = fixture(), capture = file("internal-uuid.png", { _zenLibraryCapture: { id: "owned" }, title: "" });
  assert.equal(await f.preview.openDownloads(capture, [file("a.pdf"), capture]), true);
  const request = f.calls[0][1];
  assert.equal(request.items[1].capture, true);
  assert.equal(request.items[1].title, "");
  assert.equal(request.items[0].capture, undefined);
  f.preview.close(); f.api.captures = false;
  assert.equal(await f.preview.openDownloads(capture, [capture]), false);
  assert.equal(f.preview.isOpen, false);
});

test("capture actions retain selection except Delete; source navigation dismisses, and file-only actions are rejected", async () => {
  const f = fixture(), capture = file("capture.png", { _zenLibraryCapture: { id: "owned" }, title: "Source title" });
  await f.preview.openDownloads(capture, [capture]);
  f.events.push({ events: [{ action: "trash", token: 0 }, { action: "hide", token: 0 }] });
  f.flush(); await tick();
  assert.equal(f.calls.some(c => c[0] === "execute"), false);
  for (const action of ["copy", "copy-source", "message", "airdrop", "delete-capture"]) {
    f.events.push({ events: [{ action, token: 0 }] }); f.flush(); await tick();
    assert.equal(f.calls.at(-2)[1], action);
    assert.equal(f.calls.at(-1).at(-1), action === "delete-capture" ? 1 : 0);
  }
  f.events.push({ events: [{ action: "open-source", token: 0 }] }); f.flush(); await tick();
  assert.equal(f.preview.isOpen, false);
});
