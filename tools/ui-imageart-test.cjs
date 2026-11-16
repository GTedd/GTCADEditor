// 图片转 Lore（页面侧）：参数校验与宿主规则一致、生成前估算、256 行与 JSON 体积上限（给出具体数字）、
// 宿主消息（choose / generate / release）、结果预览与替换 / 追加写入、Lore 卡片入口。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

function fresh(data) {
  const t = H.create({ data: Object.assign({ uiLocale: 'zh_cn' }, data || {}) });
  t.c.snd = () => {};
  t.c.toasts = [];
  t.c.toast = (text, kind) => t.c.toasts.push([text, kind]);
  return t;
}
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);
const t = fresh(),
  c = t.c;

// ---- 参数校验（与 ImageArt.Params 相同的范围） ----
{
  const ok = c.imageArtValidate({});
  assert.ok(ok.ok);
  eq(ok.params, {
    width: 48,
    mode: 'color',
    dither: true,
    background: '#100010',
    tolerance: 8,
    levels: 32,
    threshold: 50,
    invert: false,
    foreground: '#FFFFFF',
    cells: 'half'
  });
  const mono = c.imageArtValidate({ width: 4, mode: 'mono', threshold: 1, invert: true, foreground: '#ff5555' });
  assert.ok(mono.ok);
  assert.equal(mono.params.foreground, '#FF5555', 'hex normalised');
  const bad = c.imageArtValidate({
    width: 129,
    tolerance: -1,
    levels: 1,
    threshold: 100,
    mode: 'sepia',
    cells: 'sextant',
    dither: 'yes',
    background: 'red',
    url: 'http://x'
  });
  assert.equal(bad.ok, false);
  eq(Object.keys(bad.errors).sort(), [
    'background',
    'cells',
    'dither',
    'levels',
    'mode',
    'threshold',
    'tolerance',
    'url',
    'width'
  ]);
  assert.match(bad.errors.width, /4–128/);
  assert.equal(c.imageArtValidate({ width: 3 }).ok, false);
  assert.equal(c.imageArtValidate({ width: 4.5 }).ok, false);
  assert.equal(c.imageArtValidate({ width: true }).ok, false);
  assert.equal(c.imageArtValidate({ width: 128, levels: 256 }).ok, true);
  assert.equal(c.imageArtValidate({ cells: 'octant' }).params.cells, 'octant');
}
// ---- 估算：行数按宽高比，2 像素一行；JSON 上限是最坏情况 ----
{
  const p = c.imageArtValidate({ width: 48 }).params;
  const e = c.imageArtEstimate(100, 50, p);
  eq({ rows: e.rows, lines: e.lines }, { rows: 24, lines: 12 });
  assert.ok(e.maxChars > 12 * 48 * 30, 'worst case: a run per character');
  const mono = c.imageArtEstimate(100, 50, c.imageArtValidate({ width: 48, mode: 'mono' }).params);
  assert.ok(mono.maxChars < e.maxChars, 'mono is one run per line');
  eq(c.imageArtEstimate(1000, 1, p).lines, 1, 'at least one row');
  assert.equal(c.imageArtEstimate(1, 1000, c.imageArtValidate({ width: 4 }).params).lines, 2000);
  // Octant: two pixel columns and four rows per character; same line count for this aspect, twice the rows.
  const o = c.imageArtEstimate(100, 50, c.imageArtValidate({ width: 48, cells: 'octant' }).params);
  eq({ rows: o.rows, lines: o.lines }, { rows: 48, lines: 12 });
  assert.ok(o.maxChars > e.maxChars, 'octant glyphs are two UTF-16 units');
}
// ---- 能否写入：Lore 256 行（追加时含现有行），JSON 524,288 字符；理由带具体数字 ----
{
  eq(c.imageArtVerdict({ lineCount: 256, jsonChars: 524288 }, 10, 'replace'), { ok: true, total: 256, reasons: [] });
  const append = c.imageArtVerdict({ lineCount: 250, jsonChars: 1000 }, 10, 'append');
  assert.equal(append.ok, false);
  assert.equal(append.total, 260);
  assert.match(append.reasons[0], /260/);
  assert.match(append.reasons[0], /10/);
  assert.match(append.reasons[0], /250/);
  assert.match(append.reasons[0], /256/);
  const big = c.imageArtVerdict({ lineCount: 10, jsonChars: 600000 }, 0, 'replace');
  assert.equal(big.ok, false);
  assert.match(big.reasons[0], /600,000/);
  assert.match(big.reasons[0], /524,288/);
  assert.equal(c.imageArtVerdict({ lineCount: 300, jsonChars: 1e6 }, 0, 'replace').reasons.length, 2);
}
// ---- 没有宿主：不发消息，界面说明要在游戏里用 ----
{
  assert.equal(c.ImageArtHost.available(), false);
  assert.equal(c.ImageArtHost.send('choose'), null);
  c.openImageArt({ get: () => [], set() {} });
  const win = t.root.querySelector('.ia-win');
  assert.ok(win);
  assert.match(win.textContent, /需要在游戏内使用/);
  win
    .querySelectorAll('.k-btn')
    .find((b) => b.textContent === '选择图片…')
    .click();
  assert.equal(t.sent.filter((m) => m[0] === 'image_art').length, 0);
  c.closeModal();
}
// ---- 有宿主：选择 → 生成（防抖）→ 预览 → 替换 / 追加写入；关闭时释放图片 ----
{
  const h = fresh({ hostPrefs: true }),
    k = h.c;
  let lore = [{ text: 'old' }];
  const writes = [];
  k.openImageArt({
    get: () => lore,
    set: (l) => {
      writes.push(plain(l));
      lore = l;
    }
  });
  const win = h.root.querySelector('.ia-win');
  const btn = (label) => win.querySelectorAll('.k-btn').find((b) => b.textContent === label);
  btn('选择图片…').click();
  const choose = h.sent.filter((m) => m[0] === 'image_art').pop()[1];
  eq(Object.keys(choose).sort(), ['op', 'requestId']);
  assert.equal(choose.op, 'choose');
  k.ImageArtHost.receive({
    op: 'choose',
    requestId: choose.requestId,
    status: 'chosen',
    name: 'a.png',
    width: 96,
    height: 48,
    bytes: 2048
  });
  assert.match(win.textContent, /a\.png · 96×48 · 2 KiB/);
  assert.match(win.textContent, /约 12 行/);
  // 防抖后发出生成请求
  h.timers.filter((x) => x.ms === 250).forEach((x) => x.fn());
  const gen = h.sent.filter((m) => m[0] === 'image_art').pop()[1];
  assert.equal(gen.op, 'generate');
  eq(gen.params, k.imageArtDefaults());
  // 迟到的旧回包被忽略
  k.ImageArtHost.receive({
    op: 'generate',
    requestId: 'image-art-0',
    status: 'result',
    lineCount: 1,
    jsonChars: 1,
    lines: ['']
  });
  assert.equal(win.querySelector('.ia-prev').children.length, 0);
  const lines = [{ text: '', font: 'minecraft:uniform', italic: false, color: 'red', extra: ['█▀'] }, ''];
  k.ImageArtHost.receive({
    op: 'generate',
    requestId: gen.requestId,
    status: 'result',
    lineCount: 2,
    jsonChars: 90,
    maxLines: 256,
    maxJsonChars: 524288,
    lines
  });
  assert.equal(win.querySelector('.ia-prev').children.length, 2, 'preview lines');
  assert.match(win.textContent, /2 行 · 90 \/ 524,288 字符/);
  const insert = btn('写入 Lore');
  assert.ok(!insert.classList.contains('dis'));
  insert.click();
  eq(writes.pop(), lines, 'replace');
  // 追加：现有行 + 新行
  k.openImageArt({ get: () => lore, set: (l) => writes.push(plain(l)) });
  const w2 = h.root.querySelectorAll('.ia-win').pop();
  w2.querySelectorAll('.k-btn')
    .find((b) => b.textContent === '选择图片…')
    .click();
  const ch2 = h.sent.filter((m) => m[0] === 'image_art').pop()[1];
  k.ImageArtHost.receive({
    op: 'choose',
    requestId: ch2.requestId,
    status: 'chosen',
    name: 'b.jpg',
    width: 10,
    height: 10,
    bytes: 10
  });
  h.timers.filter((x) => x.ms === 250).forEach((x) => x.fn());
  const g2 = h.sent.filter((m) => m[0] === 'image_art').pop()[1];
  w2.querySelectorAll('.k-segi')
    .find((x) => x.textContent === '追加')
    .click();
  k.ImageArtHost.receive({
    op: 'generate',
    requestId: g2.requestId,
    status: 'result',
    lineCount: 1,
    jsonChars: 10,
    lines: ['x']
  });
  w2.querySelectorAll('.k-btn')
    .find((b) => b.textContent === '写入 Lore')
    .click();
  eq(writes.pop(), lines.concat(['x']), 'append keeps existing lines');
  // 超过上限：按钮禁用、写入被拒绝，理由里有数字
  k.openImageArt({ get: () => new Array(250).fill(''), set: (l) => writes.push(l) });
  const w3 = h.root.querySelectorAll('.ia-win').pop();
  w3.querySelectorAll('.k-btn')
    .find((b) => b.textContent === '选择图片…')
    .click();
  const ch3 = h.sent.filter((m) => m[0] === 'image_art').pop()[1];
  k.ImageArtHost.receive({
    op: 'choose',
    requestId: ch3.requestId,
    status: 'chosen',
    name: 'c.png',
    width: 10,
    height: 10,
    bytes: 10
  });
  h.timers.filter((x) => x.ms === 250).forEach((x) => x.fn());
  const g3 = h.sent.filter((m) => m[0] === 'image_art').pop()[1];
  w3.querySelectorAll('.k-segi')
    .find((x) => x.textContent === '追加')
    .click();
  k.ImageArtHost.receive({
    op: 'generate',
    requestId: g3.requestId,
    status: 'result',
    lineCount: 10,
    jsonChars: 600000,
    tooLarge: true
  });
  const ins3 = w3.querySelectorAll('.k-btn').find((b) => b.textContent === '写入 Lore');
  assert.ok(ins3.classList.contains('dis'));
  assert.match(w3.querySelector('.ia-reasons').textContent, /260/);
  assert.match(w3.querySelector('.ia-reasons').textContent, /600,000 \/ 524,288/);
  const before = writes.length;
  ins3.click();
  assert.equal(writes.length, before, 'refused');
  k.closeModal();
  assert.equal(h.sent.filter((m) => m[0] === 'image_art').pop()[1].op, 'release', 'closing releases the decoded image');
  // 宿主报错直接显示
  k.openImageArt({ get: () => [], set() {} });
  const w4 = h.root.querySelectorAll('.ia-win').pop();
  w4.querySelectorAll('.k-btn')
    .find((b) => b.textContent === '选择图片…')
    .click();
  const ch4 = h.sent.filter((m) => m[0] === 'image_art').pop()[1];
  k.ImageArtHost.receive({ op: 'choose', requestId: ch4.requestId, status: 'error', reason: '只接受 PNG 和 JPG 图片' });
  assert.match(w4.textContent, /只接受 PNG 和 JPG 图片/);
}
// ---- Lore 卡片入口 ----
{
  const h = fresh({ hostPrefs: true });
  h.c.Reg.meta = { generation: 'g' };
  h.c.Store.open({ key: 'ia', id: 'minecraft:diamond_sword', comps: { lore: ['a'] } }, true);
  const card = h.c.CARDS.lore();
  const entry = card.body.querySelector('.ia-entry');
  assert.ok(entry, 'lore card has the image entry');
  entry.click();
  assert.ok(h.root.querySelector('.ia-win'), 'opens the image window');
}
console.log(
  'PASS image art: params, estimate, 256-line and JSON caps with numbers, host messages, preview, replace/append, lore entry'
);
