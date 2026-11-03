const done = arguments[arguments.length - 1];
const request = arguments[0];
(async () => {
  if (location.hostname !== '127.0.0.1' || !document.title.startsWith('Cocoa bounce:')) {
    throw Error('Owned local fixture required');
  }
  if (!['page', 'nested'].includes(request.target || 'page')) throw Error('Invalid target');
  const box = request.target === 'nested' ? document.getElementById('nested') : document.scrollingElement;
  if (!box) throw Error('Target is missing');
  if (request.operation === 'mutate') {
    if (!['grow', 'shrink', 'remove'].includes(request.action)) throw Error('Invalid mutation');
    const contents = request.target === 'nested' ? document.getElementById('nested-content') : document.querySelector('main');
    if (!contents) throw Error('Contents missing');
    if (request.action === 'remove') contents.remove();
    else contents.style.height = request.action === 'grow' ? '3000px' : '50px';
  }
  if (request.operation === 'reset') {
    if (request.top !== undefined && (!Number.isFinite(request.top) || request.top < 0 || request.top > 1e7)) {
      throw Error('Invalid reset offset');
    }
    box.scrollTo({top: request.top ?? (request.bottom ? 1e9 : 0), behavior: 'instant'});
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
    overscrollBehavior: getComputedStyle(box).overscrollBehavior,
    transform: getComputedStyle(box).transform, snapType: getComputedStyle(box).scrollSnapType,
    snapOffsets: [...box.querySelectorAll('.snap-section')].map(node => node.offsetTop), events});
})().catch(error => done({ok: false, error: String(error)}));
