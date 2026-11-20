// 界面偏好：只有暗色配色（原版主题已移除）；自定义主题（界面不透明度 30–100% 默认 100%、界面外背景 0–100% 默认 0%、
// 质感 通透 / 磨砂 / 亚克力 / 哑光 默认磨砂、模糊强度 0–20 默认 5）；窗口化时拖动顶栏改位置并记住，「恢复默认」清掉位置。
// 偏好都交给宿主保存。
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

// 自定义主题：数字取整后夹到范围内，其它值回到默认；100% 时不走半透明样式
for (const [saved, expected] of [
  [{}, { pageOpacity: 100, backdropDim: 0, material: 'frosted', blur: 5 }],
  [
    { pageOpacity: 85, backdropDim: 40, themeMaterial: 'acrylic', themeBlur: 12 },
    { pageOpacity: 85, backdropDim: 40, material: 'acrylic', blur: 12 }
  ],
  [
    { pageOpacity: 10, backdropDim: 95, themeMaterial: 'glass', themeBlur: 99 },
    { pageOpacity: 30, backdropDim: 95, material: 'frosted', blur: 20 }
  ],
  [
    { pageOpacity: 72.6, backdropDim: -3, themeMaterial: 'clear', themeBlur: 0 },
    { pageOpacity: 73, backdropDim: 0, material: 'clear', blur: 0 }
  ],
  [
    { pageOpacity: '60', backdropDim: null, themeMaterial: 1, themeBlur: '8' },
    { pageOpacity: 100, backdropDim: 0, material: 'frosted', blur: 5 }
  ],
  [{ pageOpacity: 100 }, { pageOpacity: 100, backdropDim: 0, material: 'frosted', blur: 5 }],
  [
    { pageOpacity: 50, backdropDim: 101, themeBlur: 24 },
    { pageOpacity: 50, backdropDim: 100, material: 'frosted', blur: 20 }
  ]
]) {
  const { c } = create();
  c.Prefs.init({ hostPrefs: true, prefs: saved });
  const root = c.document.documentElement;
  assert.deepEqual(JSON.parse(JSON.stringify(c.UI.theme)), expected, 'saved theme ' + JSON.stringify(saved));
  assert.equal(root.style['--page-opacity'], expected.pageOpacity + '%');
  assert.equal(root.style['--backdrop-color'], 'rgba(0, 0, 0, ' + expected.backdropDim / 100 + ')');
  assert.equal(root.getAttribute('data-material'), expected.material);
  assert.equal(root.getAttribute('data-page-translucent'), expected.pageOpacity < 100 ? 'true' : 'false');
}

// 设置 → 界面 → 自定义主题：每项立即生效并交给宿主保存；通透时模糊强度变淡；恢复默认回到默认主题
{
  const h = create(),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: {} });
  const gen = c.h('div');
  c.advSettings(gen, 'ui');
  const root = c.document.documentElement;
  const text = gen.textContent;
  for (const label of ['自定义主题', '界面不透明度', '界面外背景', '质感', '模糊强度', '恢复默认主题'])
    assert.ok(text.includes(label), label + ' on the interface page');
  const number = (id, value) => {
    const input = gen.querySelector(id).querySelector('.k-numin');
    input.value = value;
    input.fire('change');
  };
  const materialRow = () => gen.querySelector('#editor-material').closest('.k-xrow');
  assert.equal(root.getAttribute('data-page-translucent'), 'false', 'opaque by default');
  assert.ok(materialRow().classList.contains('set-off'), 'no material while opaque');
  number('#editor-page-opacity', '85');
  assert.equal(root.style['--page-opacity'], '85%');
  assert.equal(root.getAttribute('data-page-translucent'), 'true');
  assert.equal(materialRow().classList.contains('set-off'), false, 'material applies below 100%');
  number('#editor-page-opacity', '100');
  assert.equal(root.getAttribute('data-page-translucent'), 'false');
  assert.ok(materialRow().classList.contains('set-off'));
  number('#editor-page-opacity', '85');
  assert.deepEqual(prefs(h, 'pageOpacity'), [85, 100, 85]);
  number('#editor-backdrop-dim', '30');
  assert.equal(root.style['--backdrop-color'], 'rgba(0, 0, 0, 0.3)');
  assert.deepEqual(prefs(h, 'backdropDim'), [30]);
  number('#editor-backdrop-dim', '100');
  assert.equal(root.style['--backdrop-color'], 'rgba(0, 0, 0, 1)', 'the outside can be fully dark');
  number('#editor-backdrop-dim', '0');
  assert.equal(root.style['--backdrop-color'], 'rgba(0, 0, 0, 0)', 'and fully clear');
  assert.deepEqual(prefs(h, 'backdropDim'), [30, 100, 0]);
  assert.equal(root.style['--mask-color'], undefined, 'sub-window shade does not follow the outside setting');
  number('#editor-material-blur', '14');
  assert.equal(c.UI.theme.blur, 14);
  assert.deepEqual(prefs(h, 'themeBlur'), [14]);
  const material = (label) =>
    gen
      .querySelector('#editor-material')
      .querySelectorAll('.k-segi')
      .find((e) => e.textContent === label);
  const blurRow = () => gen.querySelector('#editor-material-blur').closest('.k-xrow');
  assert.ok(material('通透') && material('磨砂') && material('亚克力') && material('哑光'), 'four materials');
  assert.ok(material('磨砂').classList.contains('on'), 'frosted by default');
  material('通透').click();
  assert.equal(root.getAttribute('data-material'), 'clear');
  assert.ok(blurRow().classList.contains('set-off'), 'blur is not used with Clear');
  material('哑光').click();
  assert.equal(root.getAttribute('data-material'), 'matte');
  assert.equal(blurRow().classList.contains('set-off'), false);
  assert.deepEqual(prefs(h, 'themeMaterial'), ['clear', 'matte']);
  gen.querySelector('#editor-theme-reset').click();
  assert.deepEqual(JSON.parse(JSON.stringify(c.UI.theme)), {
    pageOpacity: 100,
    backdropDim: 0,
    material: 'frosted',
    blur: 5
  });
  assert.equal(root.getAttribute('data-material'), 'frosted');
  assert.equal(prefs(h, 'pageOpacity').slice(-1)[0], 100);
  assert.equal(prefs(h, 'backdropDim').slice(-1)[0], 0);
  assert.equal(gen.querySelector('#editor-material').querySelector('.k-segi.on').textContent, '磨砂', 'page redrawn');
}

// 样式表：主题变量都用上了；三种质感各有面板底色，通透用默认底色。模糊由宿主画（EditorBackdrop），
// 样式表里不能有 backdrop-filter：Oriel 0.15 的实现每帧做几遍整窗离屏绘制并重建渲染目标，切换质感时让 Vulkan 设备丢失
{
  const css = fs.readFileSync(path.join(ui, 'editor.css'), 'utf8');
  for (const v of ['--page-opacity', '--backdrop-color']) assert.ok(css.includes('var(' + v), v + ' is used');
  for (const m of ['frosted', 'acrylic', 'matte']) assert.ok(css.includes('[data-material=' + m + ']'), m + ' styled');
  assert.ok(!css.includes('[data-material=clear]'), 'clear keeps the plain translucent panel');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/backdrop-filter\s*:/.test(rules), 'no backdrop-filter in the stylesheet');
  assert.ok(!/(?:^|[;{\s])filter\s*:\s*blur/.test(rules), 'no blur filter in the stylesheet');
  for (const v of ['--mask-color', '--material-blur']) assert.ok(!rules.includes(v), v + ' is gone');
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

console.log(
  'PASS page prefs: dark only, custom theme (opacity, background, material, blur, reset), window drag saved on release, reset to centred.'
);
