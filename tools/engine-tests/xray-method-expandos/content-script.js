(async () => {
  const checks = [];
  const timings = [];
  const field = "__unrelatedXrayMethodFixture";
  const restore = [];
  const verify = (label, condition) => {
    checks.push({ label, passed: !!condition });
    if (!condition) {
      throw new Error(label);
    }
  };
  function preserve(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    restore.push(() => {
      if (descriptor) {
        Object.defineProperty(object, key, descriptor);
      } else {
        delete object[key];
      }
    });
  }
  function defineData(object, key, value) {
    Object.defineProperty(object, key, {
      value, writable: true, configurable: true, enumerable: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    verify("mutable property: " + key, descriptor.writable && descriptor.configurable);
  }
  function expectRead(label, reader, object, expected) {
    let mismatches = 0;
    for (let i = 0; i < 2500; i++) {
      mismatches += reader(object) !== expected;
    }
    if (mismatches) {
      const actual = reader(object);
      checks.push({ label: label + " mismatch detail", mismatches,
        actualName: actual?.name, expectedName: expected?.name,
        ownerName: Element.prototype.matches?.name,
        ownerDescriptor: Object.getOwnPropertyDescriptor(Element.prototype, "matches") && {
          writable: Object.getOwnPropertyDescriptor(Element.prototype, "matches").writable,
          configurable: Object.getOwnPropertyDescriptor(Element.prototype, "matches").configurable,
        },
      });
    }
    verify(label, mismatches === 0);
  }
  function readOwner(object) { return object.matches; }
  function readInstance(object) { return object.matches; }
  function readIntermediate(object) { return object.matches; }
  function readCustom(object) { return object.matches; }
  function readRealm(object) { return object.matches; }
  function readProxy(object) { return object.item; }
  let result;
  try {
    const nodes = [...document.querySelectorAll(".probe-node")];
    verify("fixture node count", nodes.length === 1600);
    const direct = Element.prototype.matches;
    preserve(Element.prototype, field);
    function measure(label, cached) {
      let count = 0;
      const start = performance.now();
      for (let round = 0; round < 30; round++) {
        for (let i = 0; i < nodes.length; i++) {
          count += cached
            ? direct.call(nodes[i], ".probe-node")
            : nodes[i].matches(".probe-node");
        }
      }
      timings.push({ label, ms: performance.now() - start, count });
      verify(label + " result", count === 48000);
    }
    measure("warmup", false);
    measure("clean", false);
    for (let i = 0; i < 3; i++) {
      defineData(Element.prototype, field, function unrelated() {});
      measure("unrelated-prototype-" + i, false);
      measure("cached-method-" + i, true);
      verify("unrelated field deleted " + i, delete Element.prototype[field]);
      verify("unrelated field absent " + i, !Object.hasOwn(Element.prototype, field));
      measure("after-delete-" + i, false);
    }

    const node = nodes[0];
    const originalMatches = node.matches;
    const closest = Element.prototype.closest;
    const query = Element.prototype.querySelector;
    const first = () => "first";
    const second = () => "second";
    preserve(Element.prototype, "matches");
    defineData(Element.prototype, field, 1);
    expectRead("unrelated owner property", readOwner, node, originalMatches);
    defineData(Element.prototype, "matches", first);
    expectRead("owner shadows native method", readOwner, node, first);
    Element.prototype.matches = second;
    expectRead("owner value replaced without shape change", readOwner, node, second);
    Element.prototype.matches = closest;
    expectRead("owner shadows with another native method", readOwner, node, closest);
    Element.prototype.matches = query;
    expectRead("native expando value replaced", readOwner, node, query);
    delete Element.prototype.matches;
    expectRead("owner deletion reveals native method", readOwner, node, originalMatches);
    let getterCalls = 0;
    Object.defineProperty(Element.prototype, "matches", {
      configurable: true,
      get() { getterCalls++; return first; },
    });
    expectRead("owner accessor", readOwner, node, first);
    verify("owner getter executes for every read", getterCalls === 2500);
    delete Element.prototype.matches;

    preserve(node, field);
    preserve(node, "matches");
    defineData(node, field, 1);
    expectRead("unrelated instance property", readInstance, node, originalMatches);
    defineData(node, "matches", closest);
    expectRead("instance shadows with native method", readInstance, node, closest);
    node.matches = query;
    expectRead("instance native value replaced", readInstance, node, query);
    delete node.matches;
    expectRead("instance deletion reveals native method", readInstance, node, originalMatches);
    Object.defineProperty(node, "matches", { configurable: true, get: () => second });
    expectRead("instance accessor replaces method", readInstance, node, second);
    delete node.matches;

    preserve(HTMLElement.prototype, field);
    preserve(HTMLElement.prototype, "matches");
    defineData(HTMLElement.prototype, field, 1);
    expectRead("unrelated intermediate property", readIntermediate, node, originalMatches);
    defineData(HTMLElement.prototype, "matches", first);
    expectRead("intermediate shadows owner", readIntermediate, node, first);
    HTMLElement.prototype.matches = closest;
    expectRead("intermediate native shadow", readIntermediate, node, closest);
    HTMLElement.prototype.matches = query;
    expectRead("intermediate native value replaced", readIntermediate, node, query);
    delete HTMLElement.prototype.matches;
    expectRead("intermediate deletion reveals owner", readIntermediate, node, originalMatches);

    const oldPrototype = Object.getPrototypeOf(node);
    restore.push(() => Object.setPrototypeOf(node, oldPrototype));
    expectRead("custom prototype warmup", readCustom, node, originalMatches);
    const replacement = { matches: first };
    Object.setPrototypeOf(node, replacement);
    expectRead("custom Xray prototype", readCustom, node, first);
    replacement.matches = second;
    expectRead("custom prototype value replaced", readCustom, node, second);
    Object.setPrototypeOf(node, oldPrototype);
    expectRead("original Xray prototype restored", readCustom, node, originalMatches);

    const frame = document.getElementById("other");
    if (frame.contentDocument.readyState !== "complete") {
      await new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
    }
    const otherNode = frame.contentDocument.createElement("div");
    const otherMatches = frame.contentWindow.Element.prototype.matches;
    verify("method identity differs between realms", otherMatches !== originalMatches);
    for (let i = 0; i < 3; i++) {
      expectRead("primary realm " + i, readRealm, node, originalMatches);
      expectRead("secondary realm " + i, readRealm, otherNode, otherMatches);
    }

    const list = document.querySelectorAll(".probe-node");
    const item = list.item;
    preserve(NodeList.prototype, field);
    preserve(NodeList.prototype, "item");
    defineData(NodeList.prototype, field, 1);
    expectRead("DOM proxy native method", readProxy, list, item);
    defineData(NodeList.prototype, "item", first);
    expectRead("DOM proxy method shadow", readProxy, list, first);
    NodeList.prototype.item = second;
    expectRead("DOM proxy method replacement", readProxy, list, second);
    delete NodeList.prototype.item;
    expectRead("DOM proxy native method restored", readProxy, list, item);
    verify("DOM proxy native method still works", list.item(0) === nodes[0]);
    result = { passed: true, checks, timings };
  } catch (error) {
    result = { passed: false, error: String(error), checks, timings };
  } finally {
    for (const undo of restore.reverse()) {
      try { undo(); } catch (error) { result.cleanupError = String(error); result.passed = false; }
    }
    document.documentElement.setAttribute("data-xray-method-results", JSON.stringify(result));
  }
})();
