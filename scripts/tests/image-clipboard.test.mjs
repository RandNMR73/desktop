import assert from "node:assert/strict";
import test from "node:test";
import { makePNGClipboardWriter } from "../../src/zen/urlbar/ZenImageClipboard.sys.mjs";

test("clipboard backend loads once and preserves exact encoded bytes", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
  let loads = 0;
  const copies = [];
  const copy = makePNGClipboardWriter(
    () => {
      loads++;
      return (buffer) => copies.push(buffer);
    },
    () => assert.fail("Native backend unexpectedly fell back"),
  );
  assert.deepEqual(await Promise.all([copy(bytes), copy(bytes)]), [true, true]);
  assert.equal(loads, 1);
  assert.deepEqual(copies, [bytes, bytes]);
});

test("missing, incompatible and unavailable native bundles retain Gecko copying", async () => {
  for (const load of [
    () => null,
    () => {
      throw new Error("missing ABI");
    },
    () => Promise.reject(new Error("unavailable")),
  ]) {
    let writes = 0;
    const copy = makePNGClipboardWriter(load, () => writes++);
    assert.equal(await copy(new ArrayBuffer(1)), true);
    assert.equal(writes, 1);
  }
});

test("stale ownership before or during asynchronous backend loading never writes", async () => {
  let release,
    current = true,
    loads = 0,
    writes = 0;
  const copy = makePNGClipboardWriter(
    () => {
      loads++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    () => writes++,
  );
  assert.equal(await copy(new ArrayBuffer(1), () => false), false);
  assert.equal(loads, 0);
  const pending = copy(new ArrayBuffer(1), () => current);
  await Promise.resolve();
  current = false;
  release(() => writes++);
  assert.equal(await pending, false);
  assert.equal(writes, 0);
});

test("a failed native write does not perform a second write through fallback", async () => {
  const copy = makePNGClipboardWriter(
    () => () => {
      throw new Error("write failed");
    },
    () => assert.fail("Second clipboard write"),
  );
  await assert.rejects(copy(new ArrayBuffer(1)), /write failed/);
});
