const done = arguments[arguments.length - 1];
const request = arguments[0];
(async () => {
  if (location.hostname !== '127.0.0.1' || !document.title.startsWith('Cocoa bounce:')) {
    throw Error('Owned local fixture required');
  }
  if (!['page', 'nested'].includes(request.target || 'page')) throw Error('Invalid target');
  const box = request.target === 'nested' ? document.getElementById('nested') : document.scrollingElement;
  if (!box) throw Error('Target is missing');
  if (request.operation === 'reset') {
    box.scrollTo({top: request.bottom ? 1e9 : 0, behavior: 'instant'});
    window.fixtureEvents.length = 0;
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  const rect = box.getBoundingClientRect();
  const events = Array.from(window.fixtureEvents, row => ({
    trusted: row.trusted, dy: row.dy, mode: row.mode, time: row.time,
    target: row.target, prevented: row.prevented,
  }));
  done({ok: true, url: location.href, title: document.title,
    target: request.target || 'page', top: box.scrollTop,
    range: box.scrollHeight - box.clientHeight, rect: rect.toJSON(),
    viewport: {width: innerWidth, height: innerHeight, scale: devicePixelRatio},
    overscrollBehavior: getComputedStyle(box).overscrollBehavior, events});
})().catch(error => done({ok: false, error: String(error)}));
