// 分阶段启动（js/boot.js）：第一帧之前按偏好摆好窗口骨架和加载动画；第一帧不插脚本；之后按每帧预算分批插入，
// 顺序就是页面的加载清单；只开保险库 / 历史时不显示编辑器窗口，加载动画单独居中。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./lib/ui-harness.cjs');
const { scriptOrder } = require('./lib/ui-scripts.cjs');

function start(data) {
  const dir = path.resolve(__dirname, '../client/src/main/resources/assets/cadeditor/ui');
  const all = scriptOrder(dir);
  const t = H.create({ data, skip: all }); // a bare page: nothing but the markup
  const c = t.c;
  const win = t.root.querySelector('#win');
  const overlay = c.document.createElement('div');
  overlay.id = 'boot-loading';
  overlay.className = 'ed-loading boot';
  const text = c.document.createElement('div');
  text.className = 'ed-load-text';
  overlay.appendChild(text);
  win.appendChild(overlay);
  // Oriel runs an inserted <script src> at once; here each one only costs 5 ms of page time.
  const inserted = [];
  const append = t.root.appendChild.bind(t.root);
  t.root.appendChild = (child) => {
    if (child.tagName === 'SCRIPT') {
      inserted.push(child.getAttribute('src'));
      c.__t += 12;
      return child;
    }
    return append(child);
  };
  const sent = [];
  c.oriel.send = (k, v) => {
    sent.push([k, v]);
    return true;
  };
  vm.runInContext(fs.readFileSync(path.join(dir, 'js/boot.js'), 'utf8'), c, { filename: 'js/boot.js' });
  return { t, c, win, overlay, inserted, sent, all };
}
// One engine frame: the animation-frame callbacks queued so far.
function frame(t) {
  const due = t.timers.splice(0).filter((x) => x.ms === 16);
  due.forEach((x) => x.fn());
  return due.length;
}

{
  const b = start({
    prefs: {
      winW: 720,
      winH: 410,
      winX: 40,
      winY: 30,
      pageOpacity: 75,
      backdropDim: 20,
      themeMaterial: 'matte',
      themeBlur: 5,
      uiAnimations: false,
      uiFont: 'smooth'
    }
  });
  const root = b.c.document.documentElement;
  assert.equal(root.style['--page-opacity'], '75%', 'page opacity before the first frame');
  assert.equal(root.getAttribute('data-page-translucent'), 'true');
  assert.equal(
    root.style['--backdrop-color'],
    'rgba(0, 0, 0, 0.2)',
    'background outside the UI before the first frame'
  );
  assert.equal(root.getAttribute('data-material'), 'matte');
  assert.equal(root.style['--material-blur'], undefined, 'the blur is drawn by the host (EditorBackdrop)');
  assert.equal(root.getAttribute('data-motion'), 'reduced');
  assert.equal(root.getAttribute('data-ed-font'), 'smooth');
  assert.match(b.win.getAttribute('style'), /--ww:720px;--wh:410px;/, 'saved window size before the first frame');
  assert.match(b.win.getAttribute('style'), /--wx:40px;--wy:30px;/, 'saved window position before the first frame');
  assert.ok(b.win.classList.contains('positioned'));
  assert.equal(b.win.classList.contains('max'), false);
  assert.equal(b.inserted.length, 0, 'no script runs before the shell is painted');
  frame(b.t);
  assert.equal(b.inserted.length, 0, 'the first frame only paints the shell');
  let frames = 0;
  while (b.inserted.length < b.all.length && frames < 200) {
    frame(b.t);
    frames++;
  }
  assert.deepEqual(b.inserted, b.all, 'every script, in the page order');
  assert.equal(b.inserted[b.inserted.length - 1], 'js/app.js', 'app.js (boot) last');
  assert.ok(frames >= 10, 'spread over many frames, not one long stall: ' + frames);
  assert.deepEqual(
    b.sent.filter((x) => x[0] === 'editor_ready').map((x) => x[1].phase),
    ['shell'],
    'the host times when the shell reached the screen'
  );
  // Nothing adopted the loading layer (no EditorLoading here): it fades out.
  assert.equal(b.overlay.getAttribute('id'), null);
  assert.ok(b.overlay.classList.contains('out'));
}
{
  const b = start({ prefs: { windowMode: 'maximized' } });
  assert.ok(b.win.classList.contains('max'), 'opening mode maximized applies to the shell');
  assert.equal(b.c.document.documentElement.style['--page-opacity'], '100%', 'opaque by default');
  assert.equal(b.c.document.documentElement.getAttribute('data-page-translucent'), 'false');
  assert.equal(
    b.c.document.documentElement.style['--backdrop-color'],
    'rgba(0, 0, 0, 0)',
    'clear outside the UI by default'
  );
  assert.equal(b.c.document.documentElement.getAttribute('data-material'), 'frosted');
  assert.equal(b.win.classList.contains('positioned'), false, 'no saved position: centred');
}
{
  const b = start({ prefs: { pageOpacity: 100, winX: -1, winY: 30 } });
  assert.equal(b.c.document.documentElement.getAttribute('data-page-translucent'), 'false', 'opaque at 100%');
  assert.equal(b.win.classList.contains('positioned'), false, 'a position needs both coordinates');
}
{
  const b = start({ mode: 'vault', prefs: {} });
  assert.ok(b.t.root.classList.contains('vault-only'), 'vault-only page: no editor window shell');
  assert.ok(b.overlay.classList.contains('bare'));
  assert.equal(b.overlay.parentNode, b.t.root, 'loading animation centred on the screen on its own');
}
console.log(
  'PASS boot: shell before the first frame, scripts after it in page order over many frames, vault-only bare.'
);
