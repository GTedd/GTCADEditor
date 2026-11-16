// 富文本高级字段：阴影色 / 字体 / 点击与悬停事件 / 插入文本 / 玩家头像 / 翻译键的分段往返保真，未知字段保留，
// § 代码导入导出不回退，工具栏入口与服务器能力提示，事件与对象表单的纯函数。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

function fresh(data) {
  const t = H.create({ data: Object.assign({ uiLocale: 'zh_cn' }, data || {}) });
  t.c.snd = () => {};
  t.c.window.EDITOR_PREVIEW = true; // 内置 16 色（没有游戏数据时）
  t.c.toasts = [];
  t.c.toast = (text, kind) => t.c.toasts.push([text, kind]);
  return t;
}
const t = fresh(),
  c = t.c;
const plain = (v) => JSON.parse(JSON.stringify(v));
// 关掉的弹层留着播退场动画（ui-leaving），取还在的那个
const livePop = (h) =>
  h.doc
    .getElementById('overlays')
    .querySelectorAll('.k-pop')
    .filter((x) => !x.classList.contains('ui-leaving'))
    .pop() || null;
const round = (v) => plain(c.tcBuild({}, c.tcRuns(v).runs));

// ---- 新样式键：shadow_color（有符号 ARGB 整数或 [r,g,b,a] 列表）、font、click_event、hover_event、insertion ----
{
  const one = {
    text: '点我',
    color: '#FFAA00',
    shadow_color: -16777216,
    font: 'minecraft:uniform',
    click_event: { action: 'run_command', command: '/say hi', extra_field: 1 },
    hover_event: { action: 'show_text', value: { text: 'tip', color: 'red', extra: ['!'] } },
    insertion: ''
  };
  assert.deepEqual(round(one), one, 'single styled node round-trips exactly, insertion "" kept');
  const list = { text: 'a', shadow_color: [1, 0.5, 0, 0.25] };
  assert.deepEqual(round(list), list, 'float-list shadow color kept as written');
  // 继承：子节点继承父节点的事件；拍平后每段带完整样式，语义不变
  const nested = {
    text: '',
    extra: [{ text: 'x', click_event: { action: 'open_url', url: 'https://example.com' }, extra: ['y'] }, 'z']
  };
  const runs = c.tcRuns(nested).runs;
  assert.equal(runs.length, 3);
  assert.deepEqual(
    plain(runs[1].click_event),
    { action: 'open_url', url: 'https://example.com' },
    'child inherits click'
  );
  assert.equal(runs[2].click_event, undefined, 'sibling does not');
  assert.deepEqual(round(nested), {
    text: '',
    extra: [{ text: 'xy', click_event: { action: 'open_url', url: 'https://example.com' } }, 'z']
  });
}
// ---- 对象字：图集精灵、玩家头像、翻译键、按键名；字段原样保留 ----
{
  const objects = [
    { object: 'atlas', atlas: 'minecraft:blocks', sprite: 'minecraft:block/stone', color: 'white' },
    { type: 'object', object: 'player', player: 'Notch', hat: false, fallback: { text: '[head]' }, color: 'white' },
    { object: 'player', player: { id: [1, -2, 3, -4], properties: [{ name: 'textures', value: 'abc' }] } },
    { translate: 'item.minecraft.diamond', fallback: 'Diamond', with: ['a', { text: 'b', bold: true }, 3] },
    { type: 'translatable', translate: 'k', shadow_color: 0x40ff0000 | 0 },
    { keybind: 'key.jump', italic: false }
  ];
  objects.forEach((o) => {
    const r = c.tcRuns(o);
    assert.ok(r, 'recognised: ' + JSON.stringify(o));
    assert.equal(r.runs.length, 1);
    assert.ok(r.runs[0]._object, 'atomic object run');
    assert.deepEqual(round(o), o, 'object round-trips: ' + JSON.stringify(o));
  });
  // 对象带 extra：对象后面接着子文字
  const withExtra = { translate: 'k', color: 'red', extra: ['!'] };
  assert.deepEqual(round(withExtra), {
    text: '',
    extra: [
      { translate: 'k', color: 'red' },
      { text: '!', color: 'red' }
    ]
  });
  assert.equal(c.tcObjLabel({ translate: 'k', fallback: 'F' }), 'F');
  assert.equal(c.tcObjLabel({ translate: 'k' }), 'k');
}
// ---- 未知字段 / 不认识的内容：整段退回 SNBT（原值保留，不改写） ----
{
  for (const v of [
    { text: 'a', unknown: 1 },
    { score: { name: '@s', objective: 'o' } },
    { selector: '@p' },
    { nbt: 'x', entity: '@s' },
    { object: 'player' },
    { type: 'text', text: 'a' },
    { text: 'a', extra: 'notalist' }
  ])
    assert.equal(c.tcRuns(v), null, 'unsupported keeps the raw editor: ' + JSON.stringify(v));
  let saved = 'untouched';
  const raw = c.kRichDoc(
    { text: 'a', unknown: 1 },
    {
      onChange: (v) => {
        saved = v;
      }
    }
  );
  assert.equal(raw.raw, true, 'raw SNBT editor');
  assert.equal(saved, 'untouched', 'opening raw editor writes nothing');
  assert.equal(c.kRichDoc([{ text: 'a', unknown: 1 }], { lines: 1, onChange() {} }), null, 'lines mode refuses');
}
// ---- 编辑带事件的文字：输入新字沿用光标前的样式，事件和阴影保留 ----
{
  let saved;
  const v = { text: 'ab', shadow_color: 0x80112233 | 0, click_event: { action: 'suggest_command', command: '/me' } };
  const doc = c.kRichDoc(v, { onChange: (x) => (saved = x) });
  assert.ok(!doc.raw, 'events and shadow no longer fall back to SNBT');
  const ta = doc.textarea;
  ta.value = 'abc';
  ta.selectionStart = ta.selectionEnd = 3;
  ta.fire('input');
  assert.deepEqual(plain(saved), Object.assign({}, v, { text: 'abc' }), 'typed char inherits events and shadow');
  const sign = c.kRichDoc(['', { text: 'x', insertion: 'hi' }, '', ''], { lines: 4, onChange() {} });
  assert.ok(sign, 'sign lines accept new keys');
}
// ---- 通用表单的文字控件（forms.js wText）：带新字段的文字进富文本编辑器，真不认识的才是 SNBT ----
{
  let committed;
  const rich = c.wText(
    { t: 'text' },
    { translate: 'item.minecraft.stick', shadow_color: -1 },
    (v) => (committed = v),
    {}
  );
  assert.ok(rich.querySelector('.k-rd') && !rich.querySelector('.ed-raw'), 'translate + shadow use the rich editor');
  const raw = c.wText({ t: 'text' }, { text: 'a', unknown: 1 }, () => {}, {});
  assert.ok(raw.querySelector('.ed-raw'), 'unknown structure stays SNBT');
  const simple = c.wText({ t: 'text' }, { text: 'a', color: 'red' }, (v) => (committed = v), {});
  assert.ok(simple.querySelector('.cp-more'), 'simple text form has the color picker button');
  assert.equal(committed, undefined, 'rendering commits nothing');
}
// ---- 工具栏：阴影、字体、头像、翻译键、事件入口；书与笔（§ 代码）里这些都禁用 ----
{
  const doc = c.kRichDoc('x', { onChange() {} });
  for (const cls of ['shadow', 'font', 'sprite', 'head', 'translate', 'event', 'grad'])
    assert.ok(doc.el.querySelector('.k-rdb.' + cls), 'toolbar has ' + cls);
  const book = c.kRichDoc('§6金', { mode: 'codes', onChange() {} });
  for (const cls of ['shadow', 'font', 'head', 'translate', 'event', 'sprite'])
    assert.ok(book.el.querySelector('.k-rdb.' + cls).classList.contains('dis'), 'codes mode disables ' + cls);
}
// ---- § 代码导入导出不回退 ----
{
  const runs = c.parseCodes('§6金§lB§rC', true);
  assert.deepEqual(plain(runs), [
    { color: 'gold', text: '金' },
    { color: 'gold', bold: true, text: 'B' },
    { text: 'C' }
  ]);
  assert.equal(c.rdCodes(runs), '§6金§lB§rC');
  // 新样式键不进 § 代码（§ 代码没有对应写法），也不报错
  assert.equal(
    c.rdCodes([{ text: 'a', color: 'red', shadow_color: -1, click_event: { action: 'open_url', url: 'x' } }]),
    '§ca'
  );
  assert.deepEqual(plain(c.parseCodes('&#12ABEF色&lB', false)), [
    { color: '#12ABEF', text: '色' },
    { color: '#12ABEF', bold: true, text: 'B' }
  ]);
  let saved;
  const book = c.kRichDoc('§6金', { mode: 'codes', onChange: (v) => (saved = v) });
  book.textarea.value = '§6金子';
  book.textarea.fire('input');
  assert.equal(typeof saved, 'string', 'book & quill still saves § text');
}
// ---- 取色器结果画到样式上：纯色（保留原版颜色名）、逐字渐变、阴影 ARGB、样式开关 ----
{
  const s = c.rdPaintStyle({ bold: true }, { text: { rgb: 0xffaa00, a: 255, n: 'gold' } }, -1, null, null, {});
  assert.deepEqual(plain(s), { bold: true, color: 'gold' });
  const g = {
    tc: c.CP.spread(
      [
        { p: 0, rgb: 0xff0000, a: 255 },
        { p: 1, rgb: 0x0000ff, a: 255 }
      ],
      3
    )
  };
  assert.equal(c.rdPaintStyle({}, { text: { stops: [] } }, 1, g, null, {}).color, '#800080', 'middle of red→blue');
  assert.equal(c.rdPaintStyle({}, { shadow: { rgb: 0x112233, a: 0x80 } }, -1).shadow_color, 0x80112233 | 0);
  assert.equal(c.rdPaintStyle({ shadow_color: 5 }, { shadow: null }, -1).shadow_color, undefined, 'null removes');
  const near = (hx) => (hx === '#FF5555' ? 'red' : null);
  assert.equal(c.rdPaintStyle({}, { text: { rgb: 0xff5555, a: 255 } }, -1, null, near).color, 'red', 'codes: nearest');
  const f = c.rdPaintStyle(
    { bold: true },
    { flags: { bold: false, italic: false, underlined: true } },
    -1,
    null,
    null,
    {
      italic: true
    }
  );
  assert.deepEqual(plain(f), { italic: false, underlined: true }, 'style preset flags, explicit non-italic lore');
  assert.deepEqual(plain(c.rdLayerOf([{ color: 'gold' }, { color: 'gold' }], 'color')), {
    rgb: 0xffaa00,
    a: 255,
    n: 'gold'
  });
  assert.equal(c.rdLayerOf([{ color: 'gold' }, { color: 'red' }], 'color'), null, 'mixed → null');
  assert.deepEqual(plain(c.rdLayerOf([{ shadow_color: -16777216 }], 'shadow_color')), { rgb: 0, a: 255 });
}
// ---- 阴影入口走取色器：选中全部 → 阴影层点黑色 → 应用，写入有符号 ARGB ----
{
  let saved;
  const doc = c.kRichDoc({ text: 'ab', color: 'red' }, { onChange: (v) => (saved = v) });
  const ta = doc.textarea;
  ta.selectionStart = 0;
  ta.selectionEnd = 2;
  const sh = doc.el.querySelector('.k-rdb.shadow');
  sh.fire('mousedown', { button: 0 });
  sh.fire('click');
  const pop = livePop(t).querySelector('.cp');
  assert.ok(pop, 'shadow opens the color picker');
  assert.ok(pop.querySelector('.cp-tab.on').textContent.includes('阴影'), 'shadow layer active');
  assert.ok(pop.querySelector('.cp-alpha'), 'shadow layer edits alpha');
  const black = pop.querySelector('.cp-sw').querySelectorAll('.k-sw')[0];
  black.click();
  pop.querySelector('.cp-foot').querySelector('.k-btn.pri').click();
  assert.deepEqual(
    plain(saved),
    { text: 'ab', color: 'red', shadow_color: -16777216 },
    'only the shadow layer changed'
  );
  // 渐变入口：直接进渐变，应用后逐字颜色
  ta.selectionStart = 0;
  ta.selectionEnd = 2;
  const gb = doc.el.querySelector('.k-rdb.grad');
  gb.fire('mousedown', { button: 0 });
  gb.click();
  const gp = livePop(t).querySelector('.cp');
  assert.ok(gp.querySelector('.cp-gbar'), 'gradient bar shown');
  gp.querySelector('.cp-foot').querySelector('.k-btn.pri').click();
  assert.equal(saved.extra.length, 2, 'two per-char colors');
  assert.equal(saved.extra[0].color, '#FF5555');
  assert.equal(saved.extra[1].color, '#5555FF');
  assert.equal(saved.extra[0].shadow_color, -16777216, 'shadow kept while text gradient applied');
}
// ---- 预览：阴影色画成 text-shadow，翻译键显示回退文字，头像画图标 ----
{
  const el = c.h('div');
  c.renderRuns(el, {}, [
    { text: 'a', shadow_color: 0x80ff0000 | 0 },
    { text: '￼', _object: { translate: 'k', fallback: 'FB' } },
    { text: '￼', _object: { object: 'player', player: 'Notch' } }
  ]);
  assert.match(el.children[0].attrs.style, /text-shadow:1px 1px 0 rgba\(255,0,0,0\.502\)/);
  assert.equal(el.children[1].textContent, 'FB');
  assert.ok(el.children[2].querySelector('img'), 'player head icon');
  const none = c.h('div');
  c.renderRuns(none, {}, [{ text: 'a', shadow_color: 0x00ffffff }]);
  assert.match(none.children[0].attrs.style, /text-shadow:none/, 'alpha 0 = no shadow');
}
// ---- 点击事件：每种 action 的字段、校验、保留原事件的其它字段 ----
{
  assert.deepEqual(plain(c.rdClickEvent('open_url', { url: 'https://a.b/c' })), {
    action: 'open_url',
    url: 'https://a.b/c'
  });
  assert.throws(() => c.rdClickEvent('open_url', { url: 'file:///etc' }), /http/);
  assert.throws(() => c.rdClickEvent('open_url', { url: '' }));
  assert.deepEqual(
    plain(c.rdClickEvent('run_command', { command: '/say hi' }, { action: 'run_command', command: 'x', keep: 1 })),
    {
      action: 'run_command',
      command: '/say hi',
      keep: 1
    }
  );
  assert.deepEqual(plain(c.rdClickEvent('suggest_command', { command: 'msg ' }, { action: 'open_url', url: 'x' })), {
    action: 'suggest_command',
    command: 'msg '
  });
  assert.throws(() => c.rdClickEvent('run_command', { command: 'a\nb' }));
  assert.deepEqual(plain(c.rdClickEvent('change_page', { page: '3' })), { action: 'change_page', page: 3 });
  assert.throws(() => c.rdClickEvent('change_page', { page: 0 }));
  assert.throws(() => c.rdClickEvent('change_page', { page: 1.5 }));
  assert.deepEqual(plain(c.rdClickEvent('copy_to_clipboard', { value: '' })), {
    action: 'copy_to_clipboard',
    value: ''
  });
  assert.deepEqual(plain(c.rdClickEvent('show_dialog', { dialog: 'custom_dialog' })), {
    action: 'show_dialog',
    dialog: 'minecraft:custom_dialog'
  });
  const inline = { type: 'minecraft:notice', title: 'x' };
  assert.deepEqual(plain(c.rdClickEvent('show_dialog', { dialog: inline })).dialog, inline, 'inline dialog kept');
  assert.deepEqual(plain(c.rdClickEvent('custom', { id: 'mod:act', payload: { a: 1 } })), {
    action: 'custom',
    id: 'mod:act',
    payload: { a: 1 }
  });
  assert.equal(
    c.rdClickEvent('custom', { id: 'mod:act', payload: '' }, { action: 'custom', id: 'x', payload: 1 }).payload,
    undefined
  );
  assert.throws(() => c.rdClickEvent('custom', { id: 'Bad Id' }));
  assert.throws(() => c.rdClickEvent('open_file', { path: '/x' }), 'open_file is not offered');
  assert.deepEqual(plain(c.RD_CLICK_ACTIONS), [
    'open_url',
    'run_command',
    'suggest_command',
    'change_page',
    'copy_to_clipboard',
    'show_dialog',
    'custom'
  ]);
}
// ---- 悬停事件 ----
{
  const text = { text: 'hi', color: 'red' };
  assert.deepEqual(plain(c.rdHoverEvent('show_text', { value: text })), { action: 'show_text', value: text });
  const item = c.rdHoverEvent(
    'show_item',
    { id: 'diamond', count: '5' },
    { action: 'show_item', id: 'x', components: { a: 1 } }
  );
  assert.deepEqual(plain(item), { action: 'show_item', id: 'minecraft:diamond', components: { a: 1 }, count: 5 });
  assert.equal(
    c.rdHoverEvent('show_item', { id: 'diamond', count: 1 }, { action: 'show_item', count: 3 }).count,
    undefined
  );
  assert.throws(() => c.rdHoverEvent('show_item', { id: 'diamond', count: 100 }));
  const ent = c.rdHoverEvent('show_entity', {
    id: 'pig',
    uuid: '0000000A-0000-0000-0000-00000000000B',
    name: { text: 'Bob' }
  });
  assert.deepEqual(plain(ent), {
    action: 'show_entity',
    id: 'minecraft:pig',
    uuid: '0000000a-0000-0000-0000-00000000000b',
    name: { text: 'Bob' }
  });
  assert.throws(() => c.rdHoverEvent('show_entity', { id: 'pig', uuid: 'nope' }));
  assert.equal(c.rdUuidInts(c.rdRandomUuid()).length, 4, 'random uuid is valid');
}
// ---- UUID ⇄ int[4]、玩家头像 profile、翻译键对象 ----
{
  const u = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
  const ints = c.rdUuidInts(u);
  assert.deepEqual(plain(ints), [-132296786, 2112623056, -1486552928, -920753162]);
  assert.equal(c.rdUuidText(ints), u);
  assert.equal(c.rdPlayerProfile('name', ' Notch '), 'Notch');
  assert.throws(() => c.rdPlayerProfile('name', 'has space'));
  assert.throws(() => c.rdPlayerProfile('name', 'x'.repeat(17)));
  assert.deepEqual(plain(c.rdPlayerProfile('uuid', u)), { id: plain(ints) });
  const hash = 'a'.repeat(64);
  const tex = c.rdPlayerProfile('texture', 'http://textures.minecraft.net/texture/' + hash);
  const decoded = Buffer.from(tex.properties[0].value, 'base64').toString('utf8');
  assert.equal(decoded, '{"textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/' + hash + '"}}}');
  assert.equal(c.rdBase64('中文 ok'), Buffer.from('中文 ok', 'utf8').toString('base64'));
  assert.throws(() => c.rdPlayerProfile('texture', 'not base64!'));
  assert.deepEqual(plain(c.rdProfileForm(c.rdPlayerProfile('uuid', u))), { mode: 'uuid', input: u });
  assert.deepEqual(plain(c.rdProfileForm(tex)), { mode: 'texture', input: tex.properties[0].value });
  assert.deepEqual(plain(c.rdProfileForm('Notch')), { mode: 'name', input: 'Notch' });
  assert.deepEqual(plain(c.rdTranslateObject(' k.x ', '', ['', 'b', '', ''])), { translate: 'k.x', with: ['', 'b'] });
  assert.deepEqual(plain(c.rdTranslateObject('k', 'F', [])), { translate: 'k', fallback: 'F' });
  const prev = { translate: 'old', with: [{ text: 'c' }], fallback: 'x', type: 'translatable' };
  assert.deepEqual(plain(c.rdTranslateObject('new', '', null, prev)), {
    translate: 'new',
    with: [{ text: 'c' }],
    type: 'translatable'
  });
  assert.throws(() => c.rdTranslateObject('  ', '', []));
}
// ---- 服务器不允许命令点击：握手能力下发后，事件窗口提前提示 ----
{
  assert.equal(c.rdCommandClicksBlocked(), false, 'no server caps: no hint');
  const b = fresh({ serverCaps: { 'item.command_clicks': false } });
  assert.equal(b.c.rdCommandClicksBlocked(), true);
  let result;
  b.c.kTextEventDialog({
    click: { action: 'run_command', command: '/op me' },
    onApply: (r) => (result = r)
  });
  const win = b.root.querySelector('.rd-evwin');
  assert.ok(win, 'event window opened');
  assert.match(win.textContent, /该服务器不允许执行命令的点击事件/);
  // 只改了插入文本：点击事件没动（undefined），插入文本写入
  const ins = win.querySelectorAll('input').find((x) => x.attrs.placeholder && x.attrs.placeholder.includes('聊天框'));
  ins.value = 'shift';
  ins.fire('input');
  win.querySelector('.k-mf').querySelector('.k-btn.pri').click();
  assert.deepEqual(plain(result), { insertion: 'shift' }, 'untouched sections are not rewritten');
  // 选「打开网址」、填网址、应用
  b.c.kTextEventDialog({ onApply: (r) => (result = r) });
  const w2 = b.root.querySelectorAll('.rd-evwin').pop();
  w2.querySelectorAll('.k-tile')
    .find((x) => x.textContent === '打开网址')
    .click();
  const url = w2.querySelectorAll('input').find((x) => x.attrs.placeholder === 'https://');
  url.value = 'https://minecraft.net';
  url.fire('input');
  w2.querySelector('.k-mf').querySelector('.k-btn.pri').click();
  assert.deepEqual(plain(result), { click_event: { action: 'open_url', url: 'https://minecraft.net' } });
}
console.log(
  'PASS rich text advanced: style keys, objects, raw fallback, events, shadow/gradient picker, § codes, profiles'
);
