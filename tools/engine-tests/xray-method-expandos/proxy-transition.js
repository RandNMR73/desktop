(() => {
  const checks = [];
  const timings = [];
  const verify = (label, passed) => {
    checks.push({label, passed: !!passed});
    if (!passed) throw new Error(label);
  };
  function readControl(nodes, rounds) {
    let count = 0;
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < nodes.length; i++) count += nodes[i].matches('.probe-node');
    }
    return count;
  }
  function readSelect(nodes, rounds) {
    let count = 0;
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < nodes.length; i++) count += nodes[i].matches('.probe-node');
    }
    return count;
  }
  function readForm(nodes, rounds) {
    let count = 0;
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < nodes.length; i++) count += nodes[i].matches('.probe-node');
    }
    return count;
  }
  let result;
  try {
    const nodes = [...document.querySelectorAll('.probe-node')];
    verify('native fixture node count', nodes.length === 1600);
    verify('sixteen native interface identities', new Set(nodes.slice(0,16).map(n => Object.getPrototypeOf(n))).size === 16);
    const cases = [
      {name: 'control', run: readControl, trigger: document.createElement('button')},
      {name: 'select', run: readSelect, trigger: document.createElement('select')},
      {name: 'form', run: readForm, trigger: document.createElement('form')},
    ];
    for (const test of cases) {
      test.trigger.className = 'probe-node';
      verify(test.name + ' method identity', test.trigger.matches === Element.prototype.matches);
    }
    function measure(test, phase, index) {
      const start = performance.now();
      const count = test.run(nodes, 30);
      const ms = performance.now() - start;
      timings.push({label: test.name + '/' + phase + '/' + index, phase, test: test.name, ms, count});
      verify(test.name + '/' + phase + '/' + index + ' count', count === 48000);
    }
    function measurePhase(phase) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < cases.length; j++) measure(cases[(i+j)%cases.length], phase, i);
      }
    }
    for (const test of cases) measure(test, 'warmup', 0);
    measurePhase('before');
    for (const test of cases) verify(test.name + ' single trigger', test.run([test.trigger], 1) === 1);
    measurePhase('after-single');
    for (const test of cases) verify(test.name + ' repeated trigger', test.run([test.trigger], 64) === 64);
    measurePhase('after-repeated');
    result = {passed: true, checks, timings, description: 'Same native-only node set before and after a form/select method read at each separate lookup site. No expandos or prototype mutations.'};
  } catch (error) {
    result = {passed: false, error: String(error), checks, timings};
  }
  document.documentElement.setAttribute('data-xray-method-results', JSON.stringify(result));
})();
