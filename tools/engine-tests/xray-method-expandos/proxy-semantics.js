(async () => {
  const checks = [];
  const timings = [];
  const restore = [];
  const verify = (label, passed) => {
    checks.push({label, passed: !!passed});
    if (!passed) throw new Error(label);
  };
  function preserve(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    restore.push(() => descriptor
      ? Object.defineProperty(object, key, descriptor)
      : delete object[key]);
  }
  function define(object, key, value) {
    Object.defineProperty(object, key, {value, writable: true, configurable: true});
  }
  function readMethod(object) { return object.matches; }
  function readComputed(object, key) { return object[key]; }
  function readLength(object) { return object.length; }
  function expectPair(label, reader, control, proxy, expectedControl, expectedProxy) {
    let mismatches = 0;
    for (let i = 0; i < 500; i++) {
      mismatches += reader(control, 'matches') !== expectedControl;
      mismatches += reader(proxy, 'matches') !== expectedProxy;
    }
    verify(label, mismatches === 0);
  }
  let result;
  try {
    const control = document.createElement('div');
    const original = Element.prototype.matches;
    const first = () => 'first';
    const second = () => 'second';
    const field = '__xrayProxyFallbackFixture';
    const frame = document.getElementById('other');
    if (frame.contentDocument.readyState !== 'complete') {
      await new Promise(resolve => frame.addEventListener('load', resolve, {once: true}));
    }
    for (const tag of ['select', 'form']) {
      const proxy = document.createElement(tag);
      const expect = (label, reader, expected = original) =>
        expectPair(tag + ': ' + label, reader, control, proxy, original, expected);
      verify(tag + ': native method identity', proxy.matches === original);
      expect('GetProp baseline', readMethod);
      expect('GetElem baseline', readComputed);
      preserve(proxy, field);
      preserve(proxy, 'matches');
      define(proxy, field, 1);
      expect('unrelated instance expando GetProp', readMethod);
      expect('unrelated instance expando GetElem', readComputed);
      define(proxy, 'matches', first);
      expect('own shadow GetProp', readMethod, first);
      expect('own shadow GetElem', readComputed, first);
      proxy.matches = second;
      expect('own replacement GetProp', readMethod, second);
      expect('own replacement GetElem', readComputed, second);
      proxy.matches = Element.prototype.closest;
      expect('native alias GetProp', readMethod, Element.prototype.closest);
      expect('native alias GetElem', readComputed, Element.prototype.closest);
      let calls = 0;
      Object.defineProperty(proxy, 'matches', {configurable: true, get() {calls++; return first;}});
      expect('own accessor GetProp', readMethod, first);
      expect('own accessor GetElem', readComputed, first);
      verify(tag + ': accessor ran on every proxy read', calls === 1000);
      verify(tag + ': own shadow removed', delete proxy.matches && !Object.hasOwn(proxy, 'matches'));
      expect('own deletion GetProp', readMethod);
      expect('own deletion GetElem', readComputed);
      const prototype = Object.getPrototypeOf(proxy);
      preserve(prototype, 'matches');
      define(prototype, 'matches', first);
      expect('prototype shadow GetProp', readMethod, first);
      expect('prototype shadow GetElem', readComputed, first);
      prototype.matches = second;
      expect('prototype replacement', readMethod, second);
      verify(tag + ': prototype shadow removed', delete prototype.matches && !Object.hasOwn(prototype, 'matches'));
      expect('prototype deletion', readMethod);
      restore.push(() => Object.setPrototypeOf(proxy, prototype));
      const custom = {matches: second};
      Object.setPrototypeOf(proxy, custom);
      expect('custom prototype GetProp', readMethod, second);
      expect('custom prototype GetElem', readComputed, second);
      custom.matches = first;
      expect('custom prototype replacement GetProp', readMethod, first);
      expect('custom prototype replacement GetElem', readComputed, first);
      Object.setPrototypeOf(proxy, prototype);
      expect('original prototype restored', readMethod);
      verify(tag + ': unrelated expando removed', delete proxy[field] && !Object.hasOwn(proxy, field));
      verify(tag + ': native getter baseline', readLength(proxy) === 0);
      verify(tag + ': computed getter baseline', readComputed(proxy, 'length') === 0);
      const child = document.createElement(tag === 'select' ? 'option' : 'input');
      proxy.appendChild(child);
      verify(tag + ': native getter sees child', readLength(proxy) === 1);
      proxy.appendChild(child.cloneNode());
      verify(tag + ': native getter sees second child', readLength(proxy) === 2);
      verify(tag + ': computed getter sees second child', readComputed(proxy, 'length') === 2);
      verify(tag + ': indexed child lookup', readComputed(proxy, 0) === child);
      proxy.replaceChildren();
      verify(tag + ': native getter sees removal', readLength(proxy) === 0);
      verify(tag + ': computed getter sees removal', readComputed(proxy, 'length') === 0);
      const other = frame.contentDocument.createElement(tag);
      const otherMethod = frame.contentWindow.Element.prototype.matches;
      verify(tag + ': cross-realm identity differs', otherMethod !== original);
      expectPair(tag + ': cross-realm GetProp', readMethod, control, other, original, otherMethod);
      expectPair(tag + ': cross-realm GetElem', readComputed, control, other, original, otherMethod);
    }
    result = {passed: true, checks, timings};
  } catch (error) {
    result = {passed: false, error: String(error), checks, timings};
  } finally {
    for (const undo of restore.reverse()) {
      try { undo(); } catch (error) {result.cleanupError = String(error); result.passed = false;}
    }
    document.documentElement.setAttribute('data-xray-method-results', JSON.stringify(result));
  }
})();
