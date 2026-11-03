const done = arguments[arguments.length - 1];
const request = arguments[0];
(async () => {
  if (!Services.dirsvc.get('ProfD', Ci.nsIFile).path.includes('zen-cocoa-physics-') ||
      Services.env.get('MOZ_HEADLESS')) throw Error('Owned visible Cocoa fixture required');
  const w = Services.wm.getMostRecentWindow('navigator:browser');
  if (!['page', 'sidebar', 'nested'].includes(request.target || 'page')) throw Error('Invalid target');
  const browser = w.gBrowser.selectedBrowser;
  if (browser.currentURI.host !== '127.0.0.1' ||
      w.gBrowser.selectedTab.hasAttribute('zen-empty-tab')) throw Error('Selected normal fixture tab required');
  if (request.operation === 'zoom') {
    if (![0.8, 1, 1.25, 1.5].includes(request.value)) throw Error('Unexpected zoom');
    browser.fullZoom = request.value;
    await new Promise(resolve => w.setTimeout(resolve, 300));
    done({ok: true, zoom: browser.fullZoom});
    return;
  }
  const box = request.target === 'sidebar'
    ? w.document.querySelector('zen-workspace[active] arrowscrollbox')?.scrollbox
    : browser;
  if (!box) throw Error('Missing target');
  if (request.target === 'sidebar' && !w.__cocoaSidebarEvents) {
    w.__cocoaSidebarEvents = [];
    w.addEventListener('wheel', event => {
      if (!event.composedPath().includes(box)) return;
      const row = {trusted: event.isTrusted, dy: event.deltaY, mode: event.deltaMode};
      w.__cocoaSidebarEvents.push(row);
      w.setTimeout(() => { row.prevented = event.defaultPrevented; }, 0);
    }, {capture: true, passive: true});
  }
  if (request.operation === 'reset') {
    box.scrollTo({top: request.bottom ? 1e9 : 0, behavior: 'instant'});
    w.__cocoaSidebarEvents.length = 0;
  }
  const rect = box.getBoundingClientRect();
  const scale = w.devicePixelRatio;
  let localX = rect.x + rect.width / 2;
  let localY = rect.y + rect.height / 2;
  if (request.point) {
    if (request.target !== 'nested' || !Array.isArray(request.point) ||
        request.point.length !== 2 || !request.point.every(Number.isFinite)) throw Error('Invalid point');
    localX = rect.x + request.point[0] * browser.fullZoom;
    localY = rect.y + request.point[1] * browser.fullZoom;
  }
  if (localX <= rect.x || localX >= rect.right || localY <= rect.y || localY >= rect.bottom) {
    throw Error('Point must remain inside the owned target');
  }
  const point = {x: Math.round((w.mozInnerScreenX + localX) * scale),
    y: Math.round((w.mozInnerScreenY + localY) * scale)};
  if (request.operation === 'pan') {
    if (![1, 2, 4, 8].includes(request.phase) || !Number.isInteger(request.dy) ||
        Math.abs(request.dy) > 800) throw Error('Invalid test pan');
    await Promise.race([
      new Promise(resolve => w.windowUtils.sendNativeMouseScrollEvent(
        point.x, point.y, request.phase, 0, request.dy, 0, 0, 0, null, resolve)),
      new Promise((resolve, reject) => w.setTimeout(() => reject(Error('Native dispatch timed out')), 5000)),
    ]);
  }
  await new Promise(resolve => w.setTimeout(resolve, 150));
  const apz = w.windowUtils.getCompositorAPZTestData();
  const viewId = request.target === 'sidebar' ? w.windowUtils.getViewId(box) : null;
  done({ok: true, operation: request.operation, target: request.target || 'page',
    point, rect: rect.toJSON(), scale, zoom: browser.fullZoom,
    phase: request.phase, dy: request.dy, top: box.scrollTop,
    range: box.scrollHeight - box.clientHeight, apzFlags: apz.additionalData,
    viewId, events: request.target === 'sidebar' ? w.__cocoaSidebarEvents : null,
    nativeInput: 'Cocoa scrollWheel', physicalTrackpadVerified: false,
    arcPhysics: Services.prefs.getBoolPref('apz.overscroll.arc_physics', false)});
})().catch(error => done({ok: false, error: String(error), stack: error.stack}));
