// 取色器：HSV / HEX / ARGB 互转、多停靠点渐变插值、预设去重 / 排序 / 改名与 prefs 消息（格式与宿主 EditorPrefs 校验一致）、
// 最近使用、kColor（签名与回调语义不变，新增 HSV 色板）、kColorPicker 的纯色 / 渐变 / 预设流程。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

const t = H.create({ data: { uiLocale: 'zh_cn', hostPrefs: true } }),
  c = t.c,
  CP = c.CP;
c.snd = () => {};
c.toasts = [];
c.toast = (text, kind) => c.toasts.push([text, kind]);
c.window.EDITOR_PREVIEW = true;
c.Prefs.init({ hostPrefs: true, prefs: {} });
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// vm 里的数组 / 对象和本文件的原型不同：都转成普通 JSON 再比较
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);
const prefsSent = (key) => t.sent.filter((m) => m[0] === 'prefs' && m[1].key === key).map((m) => plain(m[1].value));
// 宿主 EditorPrefs.validColorPresets 的同一套规则（这里只为确认页面发出的值能通过）
function hostAccepts(value) {
  const ARGB = /^#[0-9A-F]{8}$/;
  const layer = (l) =>
    l &&
    typeof l === 'object' &&
    'c' in l !== 'stops' in l &&
    Object.keys(l).every((k) => {
      if (k === 'c') return ARGB.test(l.c);
      if (k === 'n') return /^[a-z_]{1,32}$/.test(l.n) && 'c' in l;
      if (k === 'stops')
        return (
          Array.isArray(l.stops) &&
          l.stops.length >= 2 &&
          l.stops.length <= 16 &&
          l.stops.every(
            (s) => Object.keys(s).length === 2 && Number.isInteger(s.p) && s.p >= 0 && s.p <= 1000 && ARGB.test(s.c)
          )
        );
      return false;
    });
  if (JSON.stringify(value).length > 65536) return false;
  return Object.entries(value).every(
    ([kind, list]) =>
      ['color', 'gradient', 'shadow', 'style'].includes(kind) &&
      Array.isArray(list) &&
      list.length <= 64 &&
      list.every((e) => {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(e.id) || typeof e.name !== 'string' || e.name.length > 48) return false;
        const rest = Object.assign({}, e);
        delete rest.id;
        delete rest.name;
        if (kind === 'style')
          return (
            Object.keys(rest).length > 0 &&
            Object.keys(rest).every((k) =>
              k === 'flags'
                ? Object.entries(rest.flags).every(
                    ([f, v]) =>
                      ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'].includes(f) &&
                      typeof v === 'boolean'
                  )
                : (k === 'text' || k === 'shadow') && layer(rest[k])
            )
          );
        return layer(rest) && (kind !== 'gradient' || 'stops' in rest) && (kind !== 'color' || 'c' in rest);
      })
  );
}

// ---- HEX / ARGB 解析与格式 ----
{
  eq(plain(CP.parse('#FFAA00')), { a: 255, rgb: 0xffaa00 });
  eq(plain(CP.parse('fa0')), { a: 255, rgb: 0xffaa00 });
  eq(plain(CP.parse('#80112233')), { a: 0x80, rgb: 0x112233 });
  eq(plain(CP.parse('255, 0, 16')), { a: 255, rgb: 0xff0010 });
  eq(plain(CP.parse('1,2,3,4')), { a: 4, rgb: 0x010203 });
  for (const bad of ['', '#GG0000', '#12345', '256,0,0', 'red', null]) assert.equal(CP.parse(bad), null, String(bad));
  assert.equal(CP.hex6(0x0a0b0c), '#0A0B0C');
  assert.equal(CP.hex8(0x05, 0xffffff), '#05FFFFFF');
}
// ---- HSV ⇄ RGB ----
{
  const cases = [
    [0, 1, 1, 0xff0000],
    [120, 1, 1, 0x00ff00],
    [240, 1, 1, 0x0000ff],
    [60, 1, 1, 0xffff00],
    [0, 0, 1, 0xffffff],
    [0, 0, 0, 0x000000],
    [30, 1, 1, 0xff8000]
  ];
  cases.forEach(([hh, s, v, rgb]) => assert.equal(CP.hsvToRgb(hh, s, v), rgb, hh + ',' + s + ',' + v));
  assert.equal(CP.hsvToRgb(360, 1, 1), 0xff0000, 'hue wraps');
  for (let rgb = 0; rgb < 0x1000000; rgb += 0x0f0e0d) {
    const hsv = CP.rgbToHsv(rgb),
      back = CP.hsvToRgb(hsv.h, hsv.s, hsv.v);
    for (const sh of [16, 8, 0]) assert.ok(Math.abs(((back >> sh) & 255) - ((rgb >> sh) & 255)) <= 1, CP.hex6(rgb));
  }
  const gray = CP.rgbToHsv(0x808080);
  assert.equal(gray.s, 0);
}
// ---- shadow_color 的 ARGB 整数（有符号）与 [r,g,b,a] 列表 ----
{
  assert.equal(CP.toSigned(255, 0), -16777216);
  assert.equal(CP.toSigned(0x80, 0x112233), 0x80112233 | 0);
  eq(plain(CP.fromArgb(-16777216)), { a: 255, rgb: 0 });
  eq(plain(CP.fromArgb(0x80112233)), { a: 0x80, rgb: 0x112233 }, 'unsigned form too');
  eq(plain(CP.fromArgb([1, 0, 0, 0.5])), { a: 128, rgb: 0xff0000 });
  assert.equal(CP.fromArgb('x'), null);
  assert.equal(CP.fromArgb(1.5), null);
}
// ---- 多停靠点渐变 ----
{
  const stops = [
    { p: 1, rgb: 0x0000ff, a: 255 },
    { p: 0, rgb: 0xff0000, a: 0 },
    { p: 0.5, rgb: 0x00ff00, a: 255 }
  ];
  const n = CP.normStops(stops);
  eq(
    n.map((s) => s.p),
    [0, 0.5, 1],
    'sorted'
  );
  eq(plain(CP.sample(stops, 0.25)), { a: 128, rgb: 0x808000 }, 'between first two, alpha too');
  eq(plain(CP.sample(stops, 0.75)), { a: 255, rgb: 0x008080 });
  eq(plain(CP.sample(stops, -1)), { a: 0, rgb: 0xff0000 }, 'clamped low');
  eq(plain(CP.sample(stops, 2)), { a: 255, rgb: 0x0000ff }, 'clamped high');
  const five = CP.spread(stops, 5).map((x) => x.rgb);
  eq(plain(five), [0xff0000, 0x808000, 0x00ff00, 0x008080, 0x0000ff], 'first and last char on the ends');
  eq(plain(CP.spread(stops, 1)), [{ a: 0, rgb: 0xff0000 }]);
  assert.equal(CP.normStops([{ p: 0, rgb: 1 }]), null, 'needs two stops');
  const same = [
    { p: 0.6, rgb: 1 },
    { p: 0.2, rgb: 2 }
  ];
  const kept = same[0];
  CP.sortStops(same);
  assert.equal(same[1], kept, 'sortStops keeps identity');
  // 保存格式：位置是 0–1000 的整数，颜色 #AARRGGBB，文字层不带透明度
  const out = CP.layerOut({ stops: stops }, false);
  eq(plain(out), {
    stops: [
      { p: 0, c: '#FFFF0000' },
      { p: 500, c: '#FF00FF00' },
      { p: 1000, c: '#FF0000FF' }
    ]
  });
  eq(plain(CP.layerOut({ rgb: 0x112233, a: 0x40 }, true)), { c: '#40112233' });
  eq(plain(CP.layerOut({ rgb: 0xffaa00, a: 10, n: 'gold' }, false)), { c: '#FFFFAA00', n: 'gold' });
  eq(plain(CP.layerIn(out).stops.map((s) => s.p)), [0, 0.5, 1]);
  assert.equal(CP.layerIn({ c: '#fff' }), null);
  assert.equal(CP.layerIn({ stops: [{ p: 0, c: '#FF000000' }] }), null);
}
// ---- 预设：保存、同值去重（名字不算）、上限、删除、排序、改名；每次都发 prefs 消息，值能通过宿主校验 ----
{
  const r1 = CP.addPreset('color', { c: '#FFFFAA00', n: 'gold' }, '金色');
  assert.equal(r1.dup, false);
  assert.equal(r1.entry.name, '金色');
  const r2 = CP.addPreset('color', { n: 'gold', c: '#FFFFAA00' }, '另一个名字');
  assert.equal(r2.dup, true, 'same value, key order irrelevant');
  assert.equal(r2.entry.id, r1.entry.id);
  const g = CP.addPreset(
    'gradient',
    CP.layerOut(
      {
        stops: [
          { p: 0, rgb: 0xff0000 },
          { p: 1, rgb: 0xff }
        ]
      },
      false
    )
  );
  assert.equal(g.entry.name, '#FFFF0000 → #FF0000FF', 'default name summarises stops');
  CP.addPreset('shadow', { c: '#80000000' }, '  软阴影\u0007 ');
  CP.addPreset('style', { text: { c: '#FFFFFF55' }, flags: { bold: true, italic: false } }, '标题');
  assert.equal(
    CP.addPreset('style', { flags: { italic: false, bold: true }, text: { c: '#FFFFFF55' } }).dup,
    true,
    'flag order'
  );
  CP.addPreset('color', { c: '#FF000000' }, 'B');
  CP.addPreset('color', { c: '#FF111111' }, 'C');
  let all = CP.presets();
  eq(
    all.color.map((e) => e.name),
    ['金色', 'B', 'C']
  );
  assert.equal(all.shadow[0].name, '软阴影', 'control chars stripped, trimmed');
  CP.movePreset('color', 2, 0);
  CP.renamePreset('color', r1.entry.id, '  新名字 ');
  CP.removePreset('color', all.color[1].id);
  all = CP.presets();
  eq(
    all.color.map((e) => e.name),
    ['C', '新名字']
  );
  const sent = prefsSent('colorPresets');
  assert.ok(sent.length >= 8, 'every change persists through the host');
  sent.forEach((v) => assert.ok(hostAccepts(v), 'host validator accepts ' + JSON.stringify(v)));
  eq(sent[sent.length - 1], plain(c.Prefs.get('colorPresets')));
  // 满 64 个不再加
  for (let i = 0; i < 70; i++)
    CP.addPreset('shadow', { c: '#FF' + ('000000' + i.toString(16).toUpperCase()).slice(-6) });
  assert.equal(CP.presets().shadow.length, 64);
  assert.equal(CP.addPreset('shadow', { c: '#FFABCDEF' }).full, true);
  assert.ok(hostAccepts(prefsSent('colorPresets').pop()));
}
// ---- 最近使用：去重、最新在前、最多 12 个 ----
{
  for (let i = 0; i < 14; i++) CP.pushRecent(255, i);
  CP.pushRecent(255, 5);
  const rec = CP.recent();
  assert.equal(rec.length, 12);
  assert.equal(rec[0], '#FF000005');
  assert.equal(rec.filter((x) => x === '#FF000005').length, 1);
  assert.ok(prefsSent('recentColors').every((l) => l.length <= 16 && l.every((x) => /^#[0-9A-F]{8}$/.test(x))));
}
// ---- kColor：签名与回调语义不变（0xRRGGBB | null，确定时才回调），多了 HSV 色板 ----
{
  const got = [];
  const cc = c.kColor(0xff0000, (v) => got.push(v), { allowNone: true });
  assert.ok(cc.el && typeof cc.set === 'function');
  const hex = cc.el.querySelector('.k-hex');
  hex.value = '#00ff00';
  hex.fire('change');
  eq(got, [0x00ff00]);
  cc.el.querySelector('.k-swatches').children[0].click();
  assert.equal(got.pop(), 0xf9fffe, 'dye swatch');
  const more = cc.el.querySelector('.cp-more');
  assert.ok(more, 'HSV toggle');
  assert.equal(cc.el.querySelector('.cp-sv'), null, 'collapsed by default');
  more.click();
  const panelHex = cc.el.querySelector('.cp-hex');
  panelHex.value = '123456';
  panelHex.fire('change');
  assert.equal(got.pop(), 0x123456, 'HSV panel input commits');
  assert.equal(hex.value, '#123456', 'row input follows');
  const pop = c.kColorPop(c.h('div'), 0x00ff00, () => {});
  assert.ok(pop.el.querySelector('.cp-sv'), 'kColorPop opens with the palette expanded');
  c.kPopClose();
}
// ---- cpHsvEditor：输入不合法给提示，不回调 ----
{
  let cur = { a: 255, rgb: 0 },
    finals = 0;
  const ed = c.cpHsvEditor({
    alpha: true,
    get: () => cur,
    set: (v, final) => {
      cur = v;
      if (final) finals++;
    }
  });
  const hex = ed.el.querySelector('.cp-hex');
  hex.value = '#zz';
  hex.fire('change');
  assert.equal(finals, 0);
  assert.match(ed.el.querySelector('.k-numerr').textContent, /AARRGGBB/);
  hex.value = '#40FF0000';
  hex.fire('change');
  eq(plain(cur), { a: 0x40, rgb: 0xff0000 });
  const a = ed.el.querySelectorAll('.cp-num')[3];
  a.value = '300';
  a.fire('change');
  assert.equal(cur.a, 0x40, 'out of range alpha ignored');
}
// ---- kColorPicker：文字 + 阴影两层，只返回动过的层；渐变模式；保存样式预设 ----
{
  let result;
  const p = c.kColorPicker({
    layers: ['text', 'shadow'],
    active: 'text',
    value: { text: { rgb: 0xffffff, a: 255 }, shadow: null },
    flags: { bold: true },
    onApply: (r) => (result = r)
  });
  const sw = p.el.querySelector('.cp-sw').querySelectorAll('.k-sw');
  sw[6].click(); // gold
  p.el.querySelector('.cp-foot').querySelector('.k-btn.pri').click();
  eq(plain(result), { text: { rgb: 0xffaa00, a: 255, n: 'gold' } }, 'only the text layer');
  // 切到渐变：默认两点；点阴影页签改阴影
  p.el
    .querySelectorAll('.k-segi')
    .find((x) => x.textContent === '渐变')
    .click();
  assert.equal(p.value().text.stops.length, 2);
  p.el.querySelectorAll('.cp-tab')[1].click();
  p.el.querySelector('.cp-hex').value = '#80102030';
  p.el.querySelector('.cp-hex').fire('change');
  p.el.querySelector('.cp-foot').querySelector('.k-btn.pri').click();
  assert.equal(result.text.stops.length, 2, 'gradient layer');
  eq(plain(result.shadow), { rgb: 0x102030, a: 0x80 }, 'shadow keeps alpha');
  // 样式预设：文字渐变 + 阴影 + 全部开关
  const before = CP.presets().style.length;
  p.el
    .querySelectorAll('.k-segi')
    .find((x) => x.textContent.indexOf('样式') === 0)
    .click();
  p.el
    .querySelectorAll('.k-btn')
    .find((x) => x.textContent === '保存')
    .click();
  const style = CP.presets().style;
  assert.equal(style.length, before + 1);
  const saved = style[style.length - 1];
  assert.equal(saved.text.stops.length, 2);
  assert.equal(saved.shadow.c, '#80102030');
  eq(saved.flags, { bold: true, italic: false, underlined: false, strikethrough: false, obfuscated: false });
  assert.ok(hostAccepts(prefsSent('colorPresets').pop()));
  // 默认颜色按钮：层设为 null（去掉 color）
  const q = c.kColorPicker({ layers: ['text'], value: { text: { rgb: 1, a: 255 } }, onApply: (r) => (result = r) });
  q.el.querySelector('.cp-none').click();
  q.el.querySelector('.cp-foot').querySelector('.k-btn.pri').click();
  eq(plain(result), { text: null });
  // 打开即渐变：没动过也算一次渐变应用
  const g = c.kColorPicker({ layers: ['text', 'shadow'], mode: 'gradient', onApply: (r) => (result = r) });
  g.el.querySelector('.cp-foot').querySelector('.k-btn.pri').click();
  assert.equal(result.text.stops.length, 2);
  assert.equal(result.shadow, undefined);
}
console.log(
  'PASS color picker: HSV/HEX/ARGB, multi-stop gradients, presets (dedupe, order, host format), recent, kColor, picker flow'
);
