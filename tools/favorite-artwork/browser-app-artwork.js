const [port] = arguments;
const done = arguments[arguments.length - 1];
const checks = [];
(async () => {
  if (!Services.dirsvc.get('ProfD', Ci.nsIFile).path.includes('zen-search-color-retention-')) {
    throw Error('Disposable fixture required');
  }
  const w = Services.wm.getMostRecentWindow('navigator:browser');
  await w.gZenWorkspaces.promiseInitialized;
  const tabs = [];
  const check = (name, pass) => {
    checks.push({name, passed: !!pass});
    if (!pass) throw Error(name);
  };
  const pause = (ms = 60) => new Promise(r => w.setTimeout(r, ms));
  const until = async (condition, name) => {
    for (let i = 0; i < 160; i++) { if (condition()) return; await pause(); }
    throw Error('Timed out: ' + name);
  };
  const custom = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#8060d0"/></svg>');
  const manager = w.gZenPinnedTabManager, sync = w.gZenWindowSync;
  const root = w.document.documentElement;
  const url = (host, path = '/') => `http://${host}:${port}${path}`;
  const style = t => t.documentGlobal.getComputedStyle(t.querySelector('.tab-icon-image'));
  const expected = (id, appearance = 'light') => `url("chrome://browser/content/zen-images/favicons/app-tray/${id}-${appearance}.svg")`;
  const artwork = t => t.getAttribute('zen-favorite-app-icon');
  const navigate = async (tab, destination, final = destination) => {
    w.gBrowser.selectedTab = tab;
    tab.linkedBrowser.loadURI(Services.io.newURI(destination), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await until(() => tab.linkedBrowser.currentURI?.spec === final && !tab.hasAttribute('busy'), 'local navigation');
    await pause(120);
  };
  root.setAttribute('zen-should-be-dark-mode', 'false');
  for (const [id, host] of [['twitter', 'twitter.com'], ['gmail', 'mail.google.com'],
    ['spotify', 'open.spotify.com'], ['youtube', 'youtube.com'], ['whatsapp', 'web.whatsapp.com']]) {
    const destination = url(host);
    const tab = w.gBrowser.addTrustedTab(destination, {skipAnimation: true, createLazyBrowser: true});
    await until(() => tab.id, 'tab identity');
    manager.addToEssentials(tab);
    tab.label = id;
    sync.setPinnedInitialState(tab, {url: destination, title: id}, custom);
    tab.setAttribute('image', 'chrome://global/skin/icons/info.svg');
    manager.setEssentialTabIcon(tab);
    await pause();
    check(id + ' lazy URL selects the light 40pt artwork',
      style(tab).content === expected(id) && style(tab).width === '40px' && style(tab).height === '40px');
    check(id + ' remains unloaded with saved favicon intact',
      tab.hasAttribute('pending') && tab._zenPinnedInitialState.image === custom && !tab.zenStaticIcon);
    const image = new w.Image();
    const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    image.src = JSON.parse(style(tab).content.slice(4, -1)); await loaded;
    check(id + ' bundled artwork decodes', image.naturalWidth === 40 && image.naturalHeight === 40);
    tabs.push(tab);
  }
  root.setAttribute('zen-should-be-dark-mode', 'true'); await pause();
  for (const tab of tabs) check(tab.label + ' dark artwork', style(tab).content === expected(artwork(tab), 'dark'));
  const twitter = tabs[0], gmail = tabs[1], youtube = tabs[3];
  await navigate(twitter, url('twitter.com'));
  root.setAttribute('zen-should-be-dark-mode', 'false');
  await until(() => twitter.hasAttribute('zen-favorite-outline-ready'), 'initial outline');
  await pause(700);
  const lightOutline = twitter.style.getPropertyValue('--zen-favorite-outline-image');
  root.setAttribute('zen-should-be-dark-mode', 'true');
  await until(() => twitter.style.getPropertyValue('--zen-favorite-outline-image') !== lightOutline, 'dark outline');
  const darkOutline = twitter.style.getPropertyValue('--zen-favorite-outline-image');
  root.setAttribute('zen-should-be-dark-mode', 'false');
  await until(() => twitter.style.getPropertyValue('--zen-favorite-outline-image') !== darkOutline, 'light outline');
  check('appearance change refreshes the selected outline', twitter.hasAttribute('zen-favorite-outline-ready'));
  twitter.zenStaticIcon = custom; manager.setEssentialTabIcon(twitter); await pause();
  check('custom icon wins at 16pt', style(twitter).content === `url("${custom}")` && style(twitter).width === '16px' && !artwork(twitter));
  delete twitter.zenStaticIcon; manager.setEssentialTabIcon(twitter);
  check('removing custom icon restores current app artwork', style(twitter).content === expected('twitter'));

  await navigate(twitter, url('twitter.com', '/redirect'), url('x.com', '/final'));
  check('real redirect removes Twitter replacement without changing the saved destination',
    !artwork(twitter) && style(twitter).width === '16px' && twitter._zenPinnedInitialState.entry.url === url('twitter.com'));
  await navigate(twitter, url('twitter.com', '/return'));
  check('return navigation restores Twitter artwork', artwork(twitter) === 'twitter');
  twitter.linkedBrowser.goBack();
  await until(() => twitter.linkedBrowser.currentURI?.spec === url('x.com', '/final') && !artwork(twitter), 'history back');
  check('history back restores site favicon sizing', style(twitter).width === '16px');
  twitter.linkedBrowser.goForward();
  await until(() => artwork(twitter) === 'twitter', 'history forward');
  check('history forward restores app artwork', style(twitter).content === expected('twitter'));

  const music = w.gBrowser.addTrustedTab(url('music.youtube.com'), {skipAnimation: true, createLazyBrowser: true});
  await until(() => music.id, 'Music identity');
  manager.addToEssentials(music);
  sync.setPinnedInitialState(music, {url: url('youtube.com'), title: 'Saved YouTube'}, custom);
  check('unloaded current destination overrides saved YouTube URL', !artwork(music) && music.hasAttribute('pending') && style(music).width === '16px');
  check('restored matching destination paints before selection', artwork(youtube) === 'youtube' && youtube.hasAttribute('pending'));
  sync.setPinnedInitialState(youtube, {url: url('music.youtube.com'), title: 'Music'}, custom);
  check('editing saved destination does not replace current-page artwork', artwork(youtube) === 'youtube');

  await navigate(gmail, url('mail.google.com', '/mail/'));
  await until(() => gmail.hasAttribute('zen-favorite-outline-ready'), 'Gmail outline');
  const favicon = gmail.getAttribute('image');
  const gmailOutline = gmail.style.getPropertyValue('--zen-favorite-outline-image');
  await navigate(gmail, url('mail.google.com', '/chat/'));
  await until(() => gmail.style.getPropertyValue('--zen-favorite-outline-image') !== gmailOutline, 'changed URL outline');
  check('same favicon with an excluded URL refreshes artwork and outline',
    !artwork(gmail) && style(gmail).width === '16px' && gmail.getAttribute('image') === favicon);
  gmail.zenStaticIcon = custom; manager.setEssentialTabIcon(gmail);
  await navigate(gmail, url('mail.google.com', '/mail/'));
  check('custom icon survives matching navigation', !artwork(gmail) && gmail.zenStaticIcon === custom && style(gmail).width === '16px' &&
    (style(gmail).content === `url("${custom}")` || (style(gmail).content === 'normal' && gmail.getAttribute('image') === custom)));
  delete gmail.zenStaticIcon; manager.setEssentialTabIcon(gmail);
  await navigate(gmail, 'about:blank');
  check('explicit blank page does not revive saved app artwork', !artwork(gmail));

  const next = w.OpenBrowserWindow();
  try {
    await until(() => next.gZenWorkspaces?.promiseInitialized, 'second window');
    await next.gZenWorkspaces.promiseInitialized; await next.gZenStartup.promiseInitialized;
    await until(() => next.document.getElementById(youtube.id), 'mirrored Favorite');
    const twin = next.document.getElementById(youtube.id);
    check('second window restores current artwork despite a different saved URL', artwork(twin) === 'youtube');
    sync.setPinnedInitialState(youtube, {url: url('mail.google.com'), title: 'New saved destination'}, custom);
    check('saved destination edit preserves current artwork in both windows', artwork(youtube) === 'youtube' && artwork(twin) === 'youtube');
  } finally { next.close(); }
  return {passed: true, checks, productionProfileUsed: false, localFixtureOnly: true};
})().then(done, error => done({passed: false, error: String(error), stack: error.stack, checks}));
