const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { create } = require('./lib/ui-harness.cjs');

for (const value of [0, 1, 2, 3, 4]) {
  const h = create(),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: { uiScale: value } });
  assert.equal(c.UI.uiScale, value, 'saved native scale restored');
  assert.equal(c.UI.uiScaleActive, value);
  assert.equal(c.uiScaleFactor(), 1, 'DOM dimensions require no second coordinate conversion');
  c.openSettings();
  assert.match(h.root.textContent, /编辑器界面比例/);
  assert.match(h.root.textContent, /自动跟随 Minecraft GUI/);
  assert.match(h.root.textContent, /编辑器和提示框/);
  const choices = h.root.querySelectorAll('.k-segi');
  const scale = choices.filter((e) => ['自动', '1', '2', '3', '4'].includes(e.textContent));
  assert.equal(scale.length, 5, 'all native scale choices visible in existing settings');
  for (const choice of scale) choice.click();
  assert.ok(h.sent.some((x) => x[0] === 'prefs' && x[1].key === 'uiScale' && x[1].value === 4));
}
for (const value of [-1, 5, 100, 2.5, '2', true, null]) {
  const { c } = create();
  c.Prefs.init({ hostPrefs: true, prefs: { uiScale: value } });
  assert.equal(c.UI.uiScale, 0, 'invalid/legacy percentages fall back to automatic');
}
{
  const h = create(),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: {} });
  assert.equal(c.UI.uiScale, 0, 'default follows Minecraft');
  c.Store.open({ id: 'minecraft:stone', count: 1, comps: { custom_name: '保留草稿' } }, true);
  const draft = c.Store.doc(),
    baseline = draft.base,
    history = draft.hist;
  c.UI.uiScale = 3;
  c.Prefs.set('uiScale', 3);
  c.applyUiScale();
  assert.equal(c.Store.doc(), draft, 'scale does not replace draft');
  assert.equal(c.Store.doc().base, baseline, 'scale never changes item baseline');
  assert.equal(c.Store.doc().hist, history, 'undo history survives scale change');
}
// ---- 比例切换动效：切换前记下屏幕位置，宿主换完比例后从旧的屏幕大小过渡到新的；只是一次性动画
{
  const h = create(),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: { uiScale: 2 } });
  c.window.devicePixelRatio = 2;
  c.openSettings();
  const calls = [];
  const targets = [h.root.querySelector('#win'), ...h.root.querySelectorAll('.k-modal')];
  assert.ok(targets.length >= 2, 'editor window and the settings dialog both morph');
  for (const el of targets)
    el.animate = (frames, options) => {
      const a = { el, frames, options, cancelled: false, cancel: () => (a.cancelled = true) };
      calls.push(a);
      return a;
    };
  const pick = (label) =>
    h.root
      .querySelector('#editor-scale')
      .querySelectorAll('.k-segi')
      .find((e) => e.textContent === label)
      .click();
  pick('3');
  assert.ok(h.sent.some((x) => x[0] === 'prefs' && x[1].key === 'uiScale' && x[1].value === 3));
  assert.equal(c.uiScaleMorphCheck(), false, 'nothing moves before the host has switched');
  assert.equal(calls.length, 0);
  c.window.devicePixelRatio = 3; // the host switched: the same resize that fires in game
  assert.equal(c.uiScaleMorphCheck(), true);
  assert.equal(calls.length, targets.length);
  // Fake rects are 400x300 at 0,0: centre (200,150) css @2 = (400,300) device = (133.33,100) css @3.
  assert.equal(calls[0].frames[0].transform, 'translate(-66.67px, -50.00px) scale(0.6667)');
  assert.equal(calls[0].frames[1].transform, 'none', 'nothing stays scaled afterwards');
  assert.equal(calls[0].options.duration, 260);
  assert.equal(c.uiScaleMorphCheck(), false, 'one switch, one morph');
  // A second switch while the first still runs replaces it instead of stacking.
  pick('2');
  c.window.devicePixelRatio = 2;
  assert.equal(c.uiScaleMorphCheck(), true);
  assert.ok(calls[0].cancelled, 'previous morph cancelled');
  assert.equal(calls[targets.length].frames[0].transform, 'translate(100.00px, 75.00px) scale(1.5000)');
  // Picking the scale already in effect (dpr unchanged) never animates.
  calls.length = 0;
  pick('2');
  assert.equal(c.uiScaleMorphCheck(), false);
  assert.equal(calls.length, 0);
  // 关闭界面动画：直接切换，不做过渡
  c.applyUiMotion(false);
  pick('4');
  c.window.devicePixelRatio = 4;
  assert.equal(c.uiScaleMorphCheck(), false);
  assert.equal(calls.length, 0);
}
console.log(
  'PASS scale morph: FLIP from the old on-screen size after the native switch, replaceable, motion setting respected.'
);
const ui = path.resolve(__dirname, '../client/src/main/resources/assets/cadeditor/ui');
const css = fs.readFileSync(path.join(ui, 'editor.css'), 'utf8');
assert.doesNotMatch(css, /\.k-(?:xrow|en):hover[^}]*transform\s*:/, 'list hover must not move its hit boundary');
assert.doesNotMatch(css, /--ui-scale|--ui-logical-size/, 'no CSS workspace scaling remains');
const host = fs.readFileSync(
  path.resolve(ui, '../../../../java/dev/rinorsi/editor/client/EditorPageHost.java'),
  'utf8'
);
assert.ok(host.includes('driver.uiScale(uiScalePreference())'), 'page-load hook uses official API');
assert.ok(
  host.includes('EditorPrefs.accept(value);') && host.includes('screen.driver().uiScale(uiScalePreference())'),
  'live prefs resize same driver'
);
const toastHost = fs.readFileSync(
  path.resolve(ui, '../../../../java/dev/rinorsi/editor/client/EditorToast.java'),
  'utf8'
);
assert.match(toastHost, /OrielHud\.show\(ID\)\.uiScale\(value\)/);
assert.match(host, /EditorToast\.refreshScale\(\)/);
console.log(
  'PASS native editor scale: auto/1..4, strict settings, preference channel, reopen, draft identity, no CSS transform.'
);
for (const mode of ['remember', 'maximized', 'windowed', 'invalid', null]) {
  for (const savedMax of [false, true]) {
    const h = create(),
      c = h.c;
    const saved = { windowMode: mode, windowMax: savedMax, winW: 720, winH: 410, heroWidth: 150 };
    c.Prefs.init({ hostPrefs: true, prefs: saved });
    const expected = mode === 'maximized' || (mode !== 'windowed' && mode !== 'maximized' && savedMax);
    assert.equal(c.UI.maxed, expected, 'opening mode applied to remembered geometry');
    assert.equal(c.UI.winW, 720);
    assert.equal(c.UI.winH, 410);
    assert.equal(c.UI.heroW, 150);
    c.openSettings();
    const choices = h.root.querySelector('#editor-window-mode').querySelectorAll('.k-segi');
    assert.equal(choices.length, 3);
    choices[1].click();
    assert.equal(c.UI.maxed, expected, 'opening mode changes next opening, not current window');
    assert.equal(c.Prefs.vals.windowMode, 'maximized');
    assert.ok(h.sent.some((x) => x[0] === 'prefs' && x[1].key === 'windowMode' && x[1].value === 'maximized'));
    c.Prefs.init({ hostPrefs: true, prefs: c.Prefs.vals });
    assert.equal(c.UI.maxed, true, 'reopen applies selected mode');
  }
}
{
  const h = create(),
    c = h.c;
  const input = c.h('input', { class: 'k-input', placeholder: '搜索效果名称或 ID；也可直接输入 模组id::效果id' });
  let searched;
  const control = c.kSearchBox(input, (q) => {
    searched = q;
  });
  assert.equal(input.getAttribute('placeholder'), '搜索效果名称或 ID');
  assert.match(input.getAttribute('data-tip') || input.getAttribute('title'), /模组id::效果id/);
  input.value = 'minecraft:speed';
  control.el.querySelector('.k-sbtn').click();
  assert.equal(searched, 'minecraft:speed');
}
console.log(
  'PASS window opening modes: defaults, migration, native preference channel, reopen, geometry retained; compact searchable hints and stable row hover.'
);
for (const [width, height] of [
  [320, 180],
  [4096, 2160]
]) {
  const h = create({ width, height }),
    c = h.c;
  c.Prefs.init({ hostPrefs: true, prefs: {} });
  const hero = h.doc.createElement('div');
  hero.id = 'hero';
  h.root.appendChild(hero);
  // Exercise the actual drag handlers; close may happen as soon as mouseup returns.
  c.dragTrack = (event, move, end) => {
    move({ clientX: 4000, clientY: 4000 });
    end();
  };
  c.startResize({ clientX: 0, clientY: 0, button: 0 });
  c.startSplit({ clientX: 0, button: 0 });
  for (const [key, min, max] of [
    ['winW', 320, 1600],
    ['winH', 200, 1000],
    ['heroWidth', 100, 320]
  ]) {
    const saved = h.sent.filter((x) => x[0] === 'prefs' && x[1].key === key);
    assert.equal(saved.length, 1, 'mouseup immediately submits geometry without a disposable page timer');
    assert(saved[0][1].value >= min && saved[0][1].value <= max, 'page geometry obeys host persistence limits');
  }
}
// 设置 → 高级 → 窗口大小「恢复默认」在玩家 / 世界编辑器里：重画的是世界页自己的顶栏，不会把顶栏清空
{
  const h = create(),
    c = h.c;
  c.snd = () => {};
  c.Prefs.init({ hostPrefs: true, prefs: { winW: 720, winH: 410, heroWidth: 150, windowMax: true } });
  c.weOpen({
    kind: 'entity',
    type: 'minecraft:player',
    slot: { kind: 'entity', player: 'self', token: 't' },
    revision: 'r1',
    snbt: '{}',
    player: { self: true, name: 'Test' },
    views: {
      player: {
        container: { size: 36, slots: [] },
        SelectedItemSlot: 0,
        schema: { inventorySize: 36, equipmentSlots: [] }
      }
    }
  });
  const topbar = h.root.querySelector('#topbar');
  const before = topbar.textContent;
  assert.ok(before.includes('Test'), 'world topbar drawn');
  c.openSettings();
  h.root
    .querySelectorAll('.ed-tab')
    .find((e) => e.textContent === '高级')
    .fire('click');
  h.root
    .querySelectorAll('.k-btn')
    .find((e) => e.textContent === '恢复默认')
    .fire('click');
  assert.equal(c.UI.maxed, false);
  assert.ok(h.sent.some((x) => x[0] === 'prefs' && x[1].key === 'winW' && x[1].value === 0));
  assert.ok(topbar.children.length > 0, 'topbar still has its controls');
  assert.equal(topbar.textContent, before, 'the world topbar is redrawn, not the item one');
}
console.log('PASS geometry persistence: immediate mouseup channel, tiny and large viewport values inside host limits.');
