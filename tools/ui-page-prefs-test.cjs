// 界面偏好：只有暗色主题（原版主题已移除）；页面背景不透明度 30–100%（默认 60%）；窗口化时拖动顶栏改位置并记住，
// 「恢复默认」清掉位置。偏好都交给宿主保存。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { create } = require('./lib/ui-harness.cjs');

const ui = path.resolve(__dirname, '../client/src/main/resources/assets/cadeditor/ui');
const prefs = (h, key) => h.sent.filter((x) => x[0] === 'prefs' && x[1].key === key).map((x) => x[1].value);

// 没有主题可选：设置和命令面板里都没有入口，样式表里也没有原版 / 亮色主题，旧的 uiTheme 偏好不再起作用
{
  const h = create(),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: { uiTheme: 'java' } });
  assert.equal(c.document.documentElement.getAttribute('data-theme'), null, 'a saved theme is ignored');
  const gen = c.h('div');
  c.advSettings(gen, 'ui');
  assert.equal(
    gen.querySelectorAll('.k-segi').find((e) => e.textContent === '原版'),
    undefined,
    'no vanilla theme choice'
  );
  c.Store.open({ id: 'minecraft:stone', count: 1, comps: {} }, true);
  assert.equal(
    c.paletteItems().find((x) => x.label === '切换界面主题'),
    undefined,
    'no theme switch in the palette'
  );
  assert.equal(typeof c.applyUiTheme, 'undefined');
  const css = fs.readFileSync(path.join(ui, 'editor.css'), 'utf8');
  assert.ok(!/data-theme=(java|light)/.test(css), 'no vanilla or light theme rules');
  assert.ok(!/(?:sprite|url)\(minecraft:/.test(css), 'the stylesheet references no vanilla GUI art');
}

// 不透明度：整数 30–100，越界夹到范围内，其它值回到 60；100% 时不走半透明样式
for (const [saved, percent, translucent] of [
  [undefined, 60, 'true'],
  [30, 30, 'true'],
  [85, 85, 'true'],
  [100, 100, 'false'],
  [10, 30, 'true'],
  [140, 100, 'false'],
  [72.6, 73, 'true'],
  ['60', 60, 'true'],
  [null, 60, 'true']
]) {
  const { c } = create();
  c.Prefs.init({ hostPrefs: true, prefs: saved === undefined ? {} : { pageOpacity: saved } });
  const root = c.document.documentElement;
  assert.equal(c.UI.pageOpacity, percent, 'saved opacity ' + saved);
  assert.equal(root.style['--page-opacity'], percent + '%');
  assert.equal(root.getAttribute('data-page-translucent'), translucent);
}

// 设置 → 界面：输入数字立即生效并交给宿主保存
{
  const h = create(),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: {} });
  const gen = c.h('div');
  c.advSettings(gen, 'ui');
  const control = gen.querySelector('#editor-page-opacity');
  assert.ok(control, 'opacity control on the interface page');
  const input = control.querySelector('.k-numin');
  input.value = '85';
  input.fire('change');
  assert.equal(c.document.documentElement.style['--page-opacity'], '85%');
  input.value = '100';
  input.fire('change');
  assert.equal(c.document.documentElement.getAttribute('data-page-translucent'), 'false');
  assert.deepEqual(prefs(h, 'pageOpacity'), [85, 100]);
}

// 窗口位置：保存的位置写进窗口样式；拖动顶栏移动窗口（控件上按下不拖），松手才保存；最大化时不能拖
{
  const events = {};
  const h = create({ documentEvents: events }),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: { winX: 40, winY: 30 } });
  const win = c.$('win');
  c.applyWinStyle();
  assert.match(win.getAttribute('style'), /--wx:40px;--wy:30px;/);
  assert.ok(win.classList.contains('positioned'));

  const bar = c.h('div', { class: 'eb' });
  c.edTopHead(bar, { icon: c.h('span'), title: 'Stone', crumb: '' });
  const button = c.h('div', { class: 'k-btn' });
  bar.appendChild(button);
  const press = (target, x, y) => bar.fire('mousedown', { button: 0, target, clientX: x, clientY: y });
  const move = (x, y) => events.mousemove[events.mousemove.length - 1]({ clientX: x, clientY: y });
  const release = () => events.mouseup[events.mouseup.length - 1]({});
  const listeners = () => (events.mousemove || []).length;

  const idle = listeners();
  press(button, 100, 100);
  assert.equal(listeners(), idle, 'pressing a control in the top bar does not drag the window');

  press(bar, 100, 100);
  move(101, 101);
  assert.equal(c.UI.winX, 40, 'under 3 px is a click, not a drag');
  move(150, 120);
  assert.equal(c.UI.winX, 50);
  assert.equal(c.UI.winY, 20);
  assert.deepEqual(prefs(h, 'winX'), [], 'saved on release only');
  release();
  assert.deepEqual(prefs(h, 'winX'), [50]);
  assert.deepEqual(prefs(h, 'winY'), [20]);
  assert.match(win.getAttribute('style'), /--wx:50px;--wy:20px;/);

  // 拖不出视口：四边至少留 10px
  press(bar, 100, 100);
  move(-500, 900);
  release();
  assert.equal(c.UI.winX, 10);
  assert.equal(c.UI.winY, 560 - 300 - 10);

  c.UI.maxed = true;
  const before = listeners();
  press(bar, 100, 100);
  assert.equal(listeners(), before, 'a maximized window does not move');
  c.UI.maxed = false;

  // 高级 → 恢复默认：位置一起清掉，回到居中
  const adv = c.h('div');
  c.advSettings(adv, 'adv');
  adv
    .querySelectorAll('.k-btn')
    .find((b) => b.textContent === c.I18n.t('cadeditor.ui.common.reset'))
    .click();
  assert.equal(c.UI.winX, null);
  assert.equal(c.UI.winY, null);
  assert.equal(win.classList.contains('positioned'), false);
  assert.deepEqual(prefs(h, 'winX').slice(-1), [-1]);
  assert.deepEqual(prefs(h, 'winY').slice(-1), [-1]);
}

console.log('PASS page prefs: dark only, page opacity 30–100%, window drag saved on release, reset to centred.');
