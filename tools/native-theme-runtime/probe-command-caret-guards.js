const done = arguments[arguments.length - 1];
(async () => {
  const w = Services.wm.getMostRecentWindow('navigator:browser');
  const b = w.gURLBar;
  const input = b.inputField;
  const settle = () => new Promise(resolve => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)));
  const query = (offset, win = w) => {
    const u = win.windowUtils;
    const r = u.sendQueryContentEvent(u.QUERY_CARET_RECT, offset, 0, 0, 0, 0);
    return r.succeeded ? {succeeded:true, left:r.left, top:r.top, width:r.width, height:r.height} : {succeeded:false};
  };
  const open = async () => {
    b.focusedViaMousedown = false;
    b.focus(); b.search('browser keyboard', {allowAutofill:false});
    await b.lastQueryContextPromise;
    await new Promise(resolve => w.setTimeout(resolve,350));
    input.focus(); input.setSelectionRange(16,16); await settle();
  };
  let tab, tip;
  const previousTab = w.gBrowser.selectedTab;
  for (const f of w.document.querySelectorAll('iframe')) {
    if (f.src.startsWith('data:text/html,%3Cdiv%20id%3D%22urlbar%22')) f.remove();
  }
  const pref = 'ui.caretWidth';
  const hadPref = Services.prefs.prefHasUserValue(pref);
  const previousWidth = Services.prefs.getIntPref(pref,1);
  const result = {};
  try {
    await open();
    Services.prefs.setIntPref(pref,4);
    await new Promise(resolve => w.setTimeout(resolve,150));
    result.wideCaret = {configuredPoints:4, caret:query(16)};
    if (hadPref) Services.prefs.setIntPref(pref,previousWidth); else Services.prefs.clearUserPref(pref);
    b.value=''; input.focus(); input.setSelectionRange(0,0); await settle();
    tip = Cc['@mozilla.org/text-input-processor;1'].createInstance(Ci.nsITextInputProcessor);
    const notifications = [];
    const began = tip.beginInputTransactionForTests(w, (processor,notification) => {
      notifications.push(notification.type);
      if (notification.type === 'request-to-commit') processor.commitComposition();
      if (notification.type === 'request-to-cancel') processor.cancelComposition();
      return true;
    });
    if (!began) throw new Error('Could not begin composition test transaction');
    tip.setPendingCompositionString('日本語');
    tip.appendClauseToPendingComposition(3,tip.ATTR_RAW_CLAUSE);
    tip.setCaretInPendingComposition(1);
    const flushed = tip.flushPendingComposition();
    await settle();
    result.composing = {flushed,hasComposition:tip.hasComposition,value:input.value,caret:query(1)};
    tip.commitComposition(); await settle();
    result.committed = {hasComposition:tip.hasComposition,value:input.value,notifications};
    b.view.close(); await new Promise(resolve => w.setTimeout(resolve,250)); w.focus();
    const html = '<div id="urlbar" open><input autofocus id="urlbar-input" value="browser keyboard" style="font:18px system-ui;width:600px"></div><script>onload=()=>{const i=document.querySelector("input");i.focus();i.setSelectionRange(16,16)}</script>';
    tab = w.gBrowser.addTab('data:text/html,' + encodeURIComponent(html), {
      triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
    w.gBrowser.selectedTab = tab;
    const browser = tab.linkedBrowser;
    const deadline = Date.now()+10000;
    while (!browser.currentURI.spec.startsWith('data:') || browser.webProgress.isLoadingDocument) {
      if (Date.now()>deadline) throw new Error('Timed out loading isolated webpage');
      await new Promise(resolve=>w.setTimeout(resolve,100));
    }
    browser.focus(); await new Promise(resolve=>w.setTimeout(resolve,300));
    result.webpageLookalike = {systemPrincipal:browser.contentPrincipal.isSystemPrincipal,
      uriScheme:browser.currentURI.scheme, caret:query(16)};
    return result;
  } finally {
    if (tip?.hasComposition) tip.cancelComposition();
    if (tab) w.gBrowser.removeTab(tab, {animate:false});
    w.gBrowser.selectedTab = previousTab;
    b.view.close();
    if (hadPref) Services.prefs.setIntPref(pref,previousWidth); else Services.prefs.clearUserPref(pref);
  }
})().then(done,error => done({error:String(error),stack:error.stack}));
