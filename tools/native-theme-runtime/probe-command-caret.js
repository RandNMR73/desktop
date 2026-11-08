const done = arguments[arguments.length - 1];
(async () => {
  const w = Services.wm.getMostRecentWindow('navigator:browser');
  const b = w.gURLBar;
  await w.gZenWorkspaces.promiseInitialized;
  b.focusedViaMousedown = false;
  b.focus();
  b.search('browser keyboard', { allowAutofill: false });
  await b.lastQueryContextPromise;
  await new Promise(resolve => w.setTimeout(resolve, 350));
  const input = b.inputField;
  const rows = [];
  for (const fontSize of [18, 13]) {
   for (const [label, value, position] of [
    ['end', 'browser keyboard', 16],
    ['middle', 'browser keyboard', 7],
    ['start', 'browser keyboard', 0],
    ['empty', '', 0],
    ['cjk', '日本語', 1],
    ['rtl', 'שלום', 2],
    ['emoji', 'a😀b', 3],
  ]) {
    b.value = value;
    b.toggleAttribute('zen-arc-url-editor', fontSize === 13);
    input.focus();
    input.setSelectionRange(position, position);
    await new Promise(resolve => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)));
    const u = w.windowUtils;
    const caret = u.sendQueryContentEvent(u.QUERY_CARET_RECT, position, 0, 0, 0, 0);
    const box = input.getBoundingClientRect();
    const style = w.getComputedStyle(input);
    if (style.fontSize !== `${fontSize}px`) throw new Error(`Unexpected input size: ${style.fontSize}, requested ${fontSize}`);
    const canvas = w.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    canvas.width = Math.ceil(box.width * 2); canvas.height = Math.ceil(box.height * 2);
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.drawWindow(w, box.x, box.y, box.width, box.height, 'rgb(24,24,24)', ctx.DRAWWINDOW_DRAW_CARET);
    rows.push({label:`${label}-${fontSize}`, value, position, inputID: input.id, open: b.hasAttribute('open'),
      caret: {succeeded:caret.succeeded, left:caret.left, top:caret.top, width:caret.width, height:caret.height},
      inputBox:{x:box.x,y:box.y,width:box.width,height:box.height},
      style:{fontSize:style.fontSize,fontFamily:style.fontFamily,fontWeight:style.fontWeight,
        lineHeight:style.lineHeight,caretColor:style.caretColor},
      image:canvas.toDataURL('image/png')});
   }
  }
  b.removeAttribute('zen-arc-url-editor');
  b.view.close();
  await new Promise(resolve => w.setTimeout(resolve, 250));
  w.focus();
  const control = w.document.createElementNS('http://www.w3.org/1999/xhtml', 'input');
  control.id = 'ordinary-caret-control';
  control.style.cssText = 'position:fixed;left:300px;top:100px;width:600px;height:40px;font:18px system-ui;z-index:2147483647';
  control.value = 'browser keyboard';
  w.document.documentElement.append(control);
  control.focus();
  control.setSelectionRange(16,16);
  await new Promise(resolve => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)));
  const u = w.windowUtils;
  const q = u.sendQueryContentEvent(u.QUERY_CARET_RECT,16,0,0,0,0);
  const ordinaryControl = q.succeeded ? {succeeded:true,width:q.width,height:q.height} : {succeeded:false};
  control.remove();
  b.view.close();
  input.focus();
  input.setSelectionRange(0,0);
  await new Promise(resolve => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)));
  const closed = u.sendQueryContentEvent(u.QUERY_CARET_RECT,0,0,0,0,0);
  return {devicePixelRatio:w.devicePixelRatio, rows, ordinaryControl,
    closedField:closed.succeeded ? {open:b.hasAttribute('open'),succeeded:true,width:closed.width,height:closed.height} : {open:b.hasAttribute('open'),succeeded:false},
    imageLimit:'drawWindow does not include the separate native command popup. These images cannot verify command cursor paint.'};
})().then(done, error => done({error:String(error),stack:error.stack}));
