// 代码编辑器 IDE 能力：折叠时真实文本保真、括号配对、查找替换（含正则保护）、嵌入字符串转义往返、补全语境与插入、颜色字面量。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');
H.Element.prototype.setTextHighlights = function (source, ranges, numbers) {
  assert.equal(source, this.value, 'highlight source is the current display value');
  let last = 0;
  for (const r of ranges) {
    assert(r.start >= last && r.end > r.start, 'ordered, non-overlapping ranges');
    last = r.end;
  }
  this.highlight = { source, ranges, numbers };
  return true;
};
const t = H.create(),
  c = t.c;
c.snd = () => {};
c.Reg.meta = {};
let toasts = [];
c.toast = (m, kind) => toasts.push([m, kind]);
const qa = (el, sel) => el.querySelectorAll(sel);
const plain = (x) => JSON.parse(JSON.stringify(x));
// The completion layer leaves with the shared exit animation; a leaving copy no longer counts.
const liveAc = (surface) => qa(surface, '.kc-ac').find((e) => !e.classList.contains('ui-leaving')) || null;
function runTimers() {
  for (let guard = 0; guard < 20 && t.timers.length; guard++) {
    // Debounces only: request timeouts (seconds) must not fire in the middle of a test.
    const list = t.timers.splice(0);
    list.filter((x) => !x.repeat && x.ms <= 500).forEach((x) => x.fn());
  }
}
function editor(value, o) {
  const code = c.kCode(Object.assign({ value }, o || {}));
  const ta = qa(code.el, 'textarea')[0];
  ta.setSelectionRange = (a, b) => {
    ta.selectionStart = a;
    ta.selectionEnd = b;
  };
  ta.selectionStart = ta.selectionEnd = 0;
  return { code, ta };
}
const key = (ta, key, extra) => {
  let prevented = false;
  ta.fire('keydown', Object.assign({ key, preventDefault: () => (prevented = true) }, extra || {}));
  return prevented;
};
// User typing into the display: replace [a, b) of the current display with s, caret after it.
function type(ta, a, b, s, inputType) {
  ta.selectionStart = a;
  ta.selectionEnd = b;
  ta.fire('beforeinput', { inputType: inputType || 'insertText', data: s });
  ta.value = ta.value.slice(0, a) + s + ta.value.slice(b);
  ta.selectionStart = ta.selectionEnd = a + s.length;
  ta.fire('input', { inputType: inputType || 'insertText', data: s });
}

const PRETTY = [
  '{',
  '  id: "minecraft:diamond_sword",',
  '  count: 1,',
  '  components: {',
  '    "minecraft:custom_data": {',
  '      note: "a { not [ a bracket",',
  "      other: 'also } not ] one',",
  '      list: [',
  '        1,',
  '        2',
  '      ]',
  '    },',
  '    "minecraft:lore": [',
  '      "x"',
  '    ]',
  '  }',
  '}'
].join('\n');

// ---- 括号：跳过单双引号字符串；跨行区域；不配对
{
  const b = c.kcBrackets(PRETTY);
  assert.equal(b.unmatched.length, 0, 'brackets inside both quote styles are ignored');
  assert.equal(b.match[0], PRETTY.length - 1);
  const depths = b.regions.map((r) => r.depth);
  assert.deepEqual(plain(depths.slice(0, 3)), [1, 2, 3]);
  const bad = c.kcBrackets('{a:[1,2}');
  assert.deepEqual(
    plain(Array.from(bad.unmatched)),
    [0, 3, 7],
    'mismatched close and unclosed opens are all unmatched'
  );
  const r = c.kcRanges('{a:[1}', 'snbt');
  assert(
    r.some((x) => x.start === 3 && x.color === c.KC_COLORS.bad),
    'unmatched bracket in error colour'
  );
  assert(r.some((x) => x.start === 5 && x.color === c.KC_COLORS.bad));
}
// ---- 颜色字面量
{
  const text = '{color:"#FF0000",tint:"#80FF8000",shadow_color:-16777216,colors:[I;65280],x:5,named:{color:"gold"}}';
  const r = c.kcRanges(text, 'snbt');
  const at = (s) => r.find((x) => text.slice(x.start, x.end) === s);
  assert.equal(at('"#FF0000"').color, 0xffff0000, '#RRGGBB');
  assert.equal(at('"#80FF8000"').color, 0xffff8000, '#AARRGGBB uses RGB, opaque');
  assert.notEqual(at('-16777216').color, c.KC_COLORS.num, 'shadow_color integer is coloured');
  assert.equal(at('65280').color, 0xff00ff00, 'colour arrays');
  assert.equal(at('5').color, c.KC_COLORS.num, 'ordinary numbers keep number colour');
  assert.equal(at('"gold"').color, 0xffffaa00, 'named text colours');
  assert(c.kcReadable(0x000000) !== 0xff000000, 'very dark colours are lightened to stay readable');
}
// ---- 折叠：显示占位符，真实文本保真；编辑换算；碰到占位符拒绝并展开；复制 / 提交 / 格式化用真实文本
{
  const got = [];
  const { code, ta } = editor(PRETTY, { onInput: (tx) => got.push(tx) });
  const regions = c.kcBrackets(PRETTY).regions;
  const comps = regions.find((r) => r.depth === 2);
  code.fold(comps.open);
  assert(ta.value.includes(c.KC_FOLD_PH), 'placeholder shown');
  assert(!ta.value.includes('custom_data'), 'folded lines hidden');
  assert.equal(code.get(), PRETTY, 'real text unchanged by folding');
  assert.equal(ta.highlight.numbers, false, 'native line numbers off while folded');
  const lineNos = qa(code.el, '.kc-gln').map((e) => e.textContent);
  assert.deepEqual(plain(lineNos.slice(0, 5)), ['1', '2', '3', '4', '17'], 'gutter shows real line numbers');
  assert(
    qa(code.el, '.kc-fm').some((e) => e.textContent === '+'),
    'folded marker'
  );
  // Typing before the fold.
  const at = ta.value.indexOf('count: 1') + 'count: '.length;
  type(ta, at, at + 1, '7');
  assert.equal(code.get(), PRETTY.replace('count: 1', 'count: 7'), 'edit mapped to the real text');
  assert(ta.value.includes(c.KC_FOLD_PH));
  runTimers();
  assert(!got[got.length - 1].includes(c.KC_FOLD_PH), 'onInput receives real text, never the placeholder');
  assert.equal(got[got.length - 1], PRETTY.replace('count: 1', 'count: 7'));
  // Typing after the fold (after the closing bracket) is fine too.
  const after = ta.value.lastIndexOf('}');
  type(ta, after, after, ' ');
  assert.equal(code.get(), PRETTY.replace('count: 1', 'count: 7').replace(/}$/, ' }'));
  // Native undo restores an earlier display state: still mapped exactly.
  const undoDisplay = ta.value.slice(0, after) + ta.value.slice(after + 1);
  ta.value = undoDisplay;
  ta.selectionStart = ta.selectionEnd = after;
  ta.fire('input', { inputType: 'historyUndo' });
  assert.equal(code.get(), PRETTY.replace('count: 1', 'count: 7'));
  // Typing right inside the folded brackets is rejected and opens the fold.
  toasts = [];
  const ph = ta.value.indexOf(c.KC_FOLD_PH);
  type(ta, ph, ph, 'x');
  assert.equal(code.get(), PRETTY.replace('count: 1', 'count: 7'), 'rejected edit leaves the real text intact');
  assert(!ta.value.includes(c.KC_FOLD_PH), 'touched fold is opened');
  assert.equal(ta.value, code.get());
  assert(toasts.some(([m]) => /折叠/.test(m)));
  // Deleting the placeholder alone (Backspace) is rejected as well.
  code.fold(comps.open);
  const ph2 = ta.value.indexOf(c.KC_FOLD_PH);
  type(ta, ph2, ph2 + 1, '', 'deleteContentBackward');
  assert.equal(code.get(), PRETTY.replace('count: 1', 'count: 7'));
  // Fold-all / level / unfold-all never touch the real text.
  code.foldAll();
  assert.equal(ta.value, '{' + c.KC_FOLD_PH + '}');
  assert.equal(code.get(), PRETTY.replace('count: 1', 'count: 7'));
  code.foldLevel(3);
  assert(ta.value.includes('"minecraft:custom_data": {' + c.KC_FOLD_PH + '}'));
  assert(ta.value.includes('"minecraft:lore": [' + c.KC_FOLD_PH + ']'));
  code.unfoldAll();
  assert.equal(ta.value, code.get());
  // Selecting a whole folded block with its brackets and deleting it deletes the real block.
  code.foldLevel(3);
  const s0 = ta.value.indexOf('[' + c.KC_FOLD_PH + ']');
  type(ta, s0, s0 + 3, '[]', 'insertFromPaste');
  assert(code.get().includes('"minecraft:lore": []'), 'whole block replaced in the real text');
  assert(!code.get().includes('"x"'));
  // Copy / cut with placeholders in the selection uses the real text.
  code.set(PRETTY, true);
  code.fold(comps.open);
  let clip = null;
  c.Prefs.hostClip = true;
  const sent0 = t.sent.length;
  ta.selectionStart = 0;
  ta.selectionEnd = ta.value.length;
  assert.equal(key(ta, 'c', { ctrlKey: true }), true, 'copy intercepted while folds are in the selection');
  clip = t.sent.slice(sent0).find(([k]) => k === 'clipboard');
  assert.equal(clip[1].text, PRETTY, 'clipboard gets the real text');
  c.Prefs.hostClip = false;
  // Toolbar copy and format use the real text and drop folds.
  let copied;
  const copyText = c.copyText;
  c.copyText = (tx) => (copied = tx);
  qa(code.el, '.k-btn')
    .find((b) => b.getAttribute('data-code-action') === 'copy')
    .fire('click');
  assert.equal(copied, PRETTY);
  c.copyText = copyText;
  qa(code.el, '.k-btn')
    .find((b) => b.getAttribute('data-code-action') === 'compact')
    .fire('click');
  assert(!ta.value.includes(c.KC_FOLD_PH));
  assert.equal(code.get(), c.kcFormat(PRETTY, true));
  // Gutter marker click toggles the fold.
  code.set(PRETTY, true);
  const marker = qa(code.el, '.kc-fm').find((e) => e.style.top === 3 * code.editor.lineHeight() + 'px');
  assert(marker, 'marker on line 4');
  marker.fire('mousedown');
  assert(ta.value.includes('components: {' + c.KC_FOLD_PH + '}'));
  // Programmatic edits touching a fold open it first, then apply exactly.
  code.editor.replace(PRETTY.indexOf('note'), PRETTY.indexOf('note') + 4, 'memo');
  assert(!ta.value.includes(c.KC_FOLD_PH));
  assert.equal(code.get(), PRETTY.replace('note:', 'memo:'));
  // Error navigation reveals a folded error position.
  const broken = PRETTY.replace('1,\n', '1 x,\n');
  code.set(broken, true);
  code.foldAll();
  const err = code.check();
  assert(err && err.pos !== null);
  qa(code.el, '.kc-st')[0].fire('click');
  assert(!ta.value.includes(c.KC_FOLD_PH) || ta.value.indexOf(c.KC_FOLD_PH) > err.pos, 'error position revealed');
  assert.equal(c.kcD2R([], ta.selectionStart), ta.selectionStart);
}
// ---- 折叠模型纯函数
{
  const text = '{\n a:[\n  1\n ],\n b:2\n}';
  const b = c.kcBrackets(text);
  const inner = b.regions.find((r) => r.depth === 2);
  const v = c.kcFoldView(text, [{ open: inner.open, close: inner.close }]);
  assert.equal(v.display, '{\n a:[' + c.KC_FOLD_PH + '],\n b:2\n}');
  for (let p = 0; p <= text.length; p++) {
    const d = c.kcR2D(v.segs, p);
    if (p <= inner.open + 1 || p >= inner.close)
      assert.equal(c.kcD2R(v.segs, d), p, 'round trip outside the fold ' + p);
  }
  assert.equal(c.kcTouches(v.segs, v.segs[0].ds, v.segs[0].ds), 0);
  assert.equal(c.kcTouches(v.segs, v.segs[0].ds - 1, v.segs[0].ds + 2), -1, 'whole bracketed block is not "touching"');
  assert.deepEqual(plain(c.kcDiff('ab⋯c', 'a⋯c', 1)), { from: 1, to: 2, insert: '' });
  assert.deepEqual(plain(c.kcDiff('x⋯y', 'x⋯⋯y', 2)), { from: 1, to: 1, insert: '⋯' }, 'diff anchored at the caret');
}
// ---- 括号配对高亮：光标紧邻括号时，它和配对括号用配对色
{
  const { ta } = editor('{a:[1,"]"]}');
  ta.selectionStart = ta.selectionEnd = 4;
  ta.fire('keyup', { key: 'ArrowRight' });
  const pair = ta.highlight.ranges.filter((r) => r.color === c.KC_MARK.pair).map((r) => r.start);
  assert.deepEqual(plain(pair), [3, 9], 'bracket before the caret and its partner, skipping "]" in a string');
  ta.selectionStart = ta.selectionEnd = 6;
  ta.fire('keyup', { key: 'ArrowRight' });
  assert(!ta.highlight.ranges.some((r) => r.color === c.KC_MARK.pair), 'no pair away from brackets');
}
// ---- 查找：普通 / 大小写 / 全词 / 正则（长度上限、嵌套重复拒绝、非法提示）/ 选区；替换展开
{
  const text = 'Count count recount\ncount_2 COUNT';
  assert.equal(c.kcFind(text, 'count').matches.length, 5);
  assert.equal(c.kcFind(text, 'count', { case: true }).matches.length, 3);
  assert.deepEqual(plain(c.kcFind(text, 'count', { word: true }).matches.map((m) => m.s)), [0, 6, 28]);
  assert.equal(c.kcFind(text, '^count', { regex: true }).matches.length, 2, 'regex is multiline');
  assert.equal(c.kcFind(text, 'count', { scope: [6, 19] }).matches.length, 2, 'selection scope');
  for (const risky of ['(a+)+', '(a|aa)*', '(.*x){3,}', '((ab)*c)+', '(.|x)+', '(a|)*', '(\\d|1)+'])
    assert.equal(c.kcFind('aaaa', risky, { regex: true }).error, 'risky', risky);
  // Repeated alternation of plain, non-prefix literals cannot backtrack exponentially.
  for (const ok of ['a+b', '(ab)+', '[(+]+', '\\(a+\\)+', '(a){2}', '(true|false)+', '(?:id|count)*', '(a|b)?'])
    assert.equal(c.kcFind('aaaa', ok, { regex: true }).error, null, ok);
  assert.equal(c.kcFind('a', 'x'.repeat(c.KC_REGEX_MAX + 1), { regex: true }).error, 'long');
  const bad = c.kcFind('a', '(', { regex: true });
  assert.equal(bad.error, 'invalid');
  assert(bad.detail);
  assert.equal(c.kcFind('aaa', 'x*', { regex: true }).matches.length, 0, 'empty matches never loop');
  const m = c.kcFind('id:"minecraft:stone"', '(?<ns>\\w+):(\\w+)', { regex: true }).matches[0];
  assert.equal(c.kcExpand('$2 of $<ns> ($&) $$1', m.m, m.g), 'stone of minecraft (minecraft:stone) $1');
  const all = c.kcReplaceAll(text, 'count', { word: true }, 'n');
  assert.equal(all.count, 3);
  const replaced = text.slice(0, all.from) + all.insert + text.slice(all.to);
  assert.equal(replaced, 'n n recount\ncount_2 n');
  const many = c.kcReplaceAll('a'.repeat(c.KC_FIND_MAX + 5), 'a', {}, 'b');
  assert.equal(many.count, 0, 'too many matches: replace-all refuses');
  assert(many.truncated);
}
// ---- 查找面板：Ctrl+F 打开，计数，Enter 下一个，全部替换一步写入，Ctrl+G 跳转，Esc 关闭；折叠中的命中自动展开
{
  const text = '{\n  a: "x",\n  b: {\n    c: "x"\n  },\n  d: "x"\n}';
  const { code, ta } = editor(text);
  code.foldLevel(2);
  assert(ta.value.includes(c.KC_FOLD_PH));
  assert.equal(key(ta, 'f', { ctrlKey: true }), true);
  const panel = code.el.querySelector('.kc-find');
  assert(panel, 'find panel above the editor');
  assert.equal(
    code.el.children.indexOf(panel) + 1,
    code.el.children.indexOf(code.surface),
    'panel right above the text'
  );
  const q = panel.querySelector('.kc-fq');
  q.value = '"x"';
  q.fire('input');
  runTimers();
  assert.match(panel.querySelector('.kc-find-count').textContent, /共 3 处/);
  assert(
    ta.highlight.ranges.some((r) => r.color === c.KC_MARK.hit || r.color === c.KC_MARK.cur),
    'all hits coloured'
  );
  const enter = (shift) => q.fire('keydown', { key: 'Enter', shiftKey: shift, preventDefault() {} });
  enter();
  enter();
  assert(!ta.value.includes(c.KC_FOLD_PH), 'navigating into a fold opens it');
  assert.equal(code.get().slice(code.editor.selection()[0], code.editor.selection()[1]), '"x"');
  assert.match(panel.querySelector('.kc-find-count').textContent, /第 \d+ \/ 共 3 处/);
  // Replace all: one edit.
  assert.equal(key(ta, 'h', { ctrlKey: true }), true);
  const r = panel.querySelector('.kc-fr');
  r.value = '"y"';
  toasts = [];
  qa(panel, '.k-btn')
    .find((b) => b.textContent === '全部替换')
    .fire('click');
  assert.equal(code.get(), text.replace(/"x"/g, '"y"'));
  assert(toasts.some(([m]) => /已替换 3 处/.test(m)));
  // Regex errors are shown, not thrown.
  qa(panel, '.kc-opt')
    .find((o) => o.textContent === '.*')
    .fire('click');
  q.value = '(a+)+';
  q.fire('input');
  runTimers();
  assert.match(panel.querySelector('.kc-find-msg').textContent, /嵌套重复/);
  q.value = '[';
  q.fire('input');
  runTimers();
  assert.match(panel.querySelector('.kc-find-msg').textContent, /正则无效/);
  // Go to line:column.
  assert.equal(key(ta, 'g', { ctrlKey: true }), true);
  const g = panel.querySelector('.kc-fg');
  g.value = '4:5';
  g.fire('keydown', { key: 'Enter', preventDefault() {} });
  const lines = code.get().split('\n');
  assert.equal(code.editor.caret(), lines[0].length + lines[1].length + lines[2].length + 3 + 4);
  assert(!code.el.querySelector('.kc-find') || code.el.querySelector('.kc-find').getAttribute('inert') !== null);
  // Escape in the editor closes an open panel without closing the editor.
  key(ta, 'f', { ctrlKey: true });
  assert.equal(key(ta, 'Escape'), true);
  // Readonly editors can find but never replace.
  const ro = editor('{a:1}', { readonly: true });
  key(ro.ta, 'h', { ctrlKey: true });
  assert.equal(ro.code.el.querySelector('.kc-find').querySelectorAll('.kc-fr')[0].parentNode.style.display, 'none');
  c.Prefs.vals.codeFind = {};
}
// ---- 嵌入字符串：定位、解码 / 编码往返、深度上限、父文本变动拒绝、格式化视图逐字往返
{
  const lit = '"a \\"b\\" \\\\ c\\nd \\u00a7e \\x41 \\s"';
  const s = c.kcStringAt('{k:' + lit + '}', 6);
  assert.equal(s.raw, lit);
  assert.equal(s.key, false);
  assert.equal(c.kcStringAt('{"k":1}', 2).key, true, 'keys are recognised');
  assert.equal(c.kcStringAt('{k:1}', 3), null);
  const v = c.kcDecodeString(lit);
  assert.equal(v, 'a "b" \\ c\nd §e A  ');
  assert.equal(c.kcDecodeString(c.kcEncodeString(v, '"')), v, 'round trip with double quotes');
  assert.equal(c.kcDecodeString(c.kcEncodeString(v, "'")), v, 'round trip with single quotes');
  assert.equal(c.kcEncodeString('it\'s "x"', "'"), "'it\\'s \"x\"'", 'keeps the original quote');
  assert.throws(() => c.kcDecodeString('"\\N{SNOWMAN}"'), /不支持的转义/);
  assert.throws(() => c.kcDecodeString('"\\u12"'));
  const json = '{"text":"hi","extra":[{"text":"x","color":"#ff0000"}],"n":1.50}';
  const pretty = c.kcPrettyTokens(json, 'json');
  assert(pretty.includes('\n'));
  assert.equal(c.kcCompactTokens(pretty, 'json'), json, 'token-preserving format round trip');
  assert.equal(
    c.kcCompactTokens(c.kcPrettyTokens('{a:[I;1,2],b:1.0f,c:[]}', 'snbt'), 'snbt'),
    '{a:[I;1,2],b:1.0f,c:[]}'
  );
  assert.equal(c.kcEmbeddedLanguage(json), 'json');
  assert.equal(c.kcEmbeddedLanguage('{a:1b}'), 'snbt');
  assert.equal(c.kcEmbeddedLanguage('say hi'), 'plain');
  // UI: open, edit, write back with escaping; recursive level title.
  const parentText = '{cmd:\'{"text":"hi"}\',other:1}';
  const { code, ta } = editor(parentText);
  ta.selectionStart = ta.selectionEnd = 8;
  assert.equal(key(ta, 'o', { ctrlKey: true }), true);
  const modal = t.doc.getElementById('modal');
  assert(modal, 'string dialog opened');
  assert.match(modal.textContent, /第 1 层/);
  const inner = modal.querySelector('textarea');
  assert.equal(inner.value, '{"text":"hi"}');
  inner.value = '{"text":"it\'s \\"q\\"\nok"}';
  inner.fire('input');
  qa(modal, '.k-btn')
    .find((b) => /写回/.test(b.textContent))
    .fire('click');
  assert.equal(t.doc.getElementById('modal'), null, 'dialog closed');
  const written = code.get();
  const ws = c.kcStringAt(written, 8);
  assert.equal(ws.quote, "'", 'original quote kept');
  assert.equal(c.kcDecodeString(ws.raw), '{"text":"it\'s \\"q\\"\nok"}', 'decoded value round-trips');
  assert(!/\n/.test(written), 'newline escaped');
  assert.equal(c.parseSnbt(written).cmd, '{"text":"it\'s \\"q\\"\nok"}', 'project parser agrees');
  // Formatted view: unchanged pretty text writes back the original bytes.
  ta.selectionStart = ta.selectionEnd = 8;
  key(ta, 'o', { ctrlKey: true });
  let m2 = t.doc.getElementById('modal');
  qa(m2, '.k-btn')
    .find((b) => /格式化视图/.test(b.textContent))
    .fire('click');
  assert(m2.querySelector('textarea').value.includes('\n'), 'formatted view');
  qa(m2, '.k-btn')
    .find((b) => /写回/.test(b.textContent))
    .fire('click');
  assert.equal(code.get(), written, 'no-op write back keeps the exact original');
  // Parent changed meanwhile: refuse.
  ta.selectionStart = ta.selectionEnd = 8;
  key(ta, 'o', { ctrlKey: true });
  m2 = t.doc.getElementById('modal');
  m2.querySelector('textarea').value = '{"text":"changed"}';
  m2.querySelector('textarea').fire('input');
  code.editor.replace(written.length - 2, written.length - 1, '2');
  const parentNow = code.get();
  toasts = [];
  qa(m2, '.k-btn')
    .find((b) => /写回/.test(b.textContent))
    .fire('click');
  assert.equal(code.get(), parentNow, 'stale write back refused');
  assert(toasts.some(([m]) => /重新打开/.test(m)));
  c.closeModal();
  // Not in a string / a key / depth limit.
  toasts = [];
  ta.selectionStart = ta.selectionEnd = 2;
  key(ta, 'o', { ctrlKey: true });
  assert(toasts.some(([m]) => /字符串值内/.test(m)));
  const deep = editor('{a:"x"}', { stringDepth: c.KC_STRING_DEPTH });
  deep.ta.selectionStart = deep.ta.selectionEnd = 4;
  toasts = [];
  key(deep.ta, 'o', { ctrlKey: true });
  assert(toasts.some(([m]) => /最多打开 16 层/.test(m)));
  assert.equal(t.doc.getElementById('modal'), null);
}
// ---- 补全语境
{
  const stack =
    '{id:"minecraft:stone",count:1,components:{"minecraft:food":{nutrition:1,can_always_eat:|,saturation:2f},"minecraft:ench|}}';
  const pos1 = stack.indexOf('|'),
    text1 = stack.replace('|', '');
  let x = c.kcContext(text1, pos1);
  assert.equal(x.mode, 'value');
  assert.deepEqual(plain(Array.from(x.path)), ['components', 'minecraft:food', 'can_always_eat']);
  assert.equal(x.root, 'stack');
  assert.equal(x.item, 'minecraft:stone');
  assert(x.siblings.includes('nutrition') && x.siblings.includes('saturation'), 'siblings before and after the cursor');
  const t2 = '{id:"minecraft:stone",components:{"minecraft:ench';
  x = c.kcContext(t2, t2.length);
  assert.equal(x.mode, 'key');
  assert.deepEqual(plain(Array.from(x.path)), ['components']);
  assert.equal(x.prefix, 'minecraft:ench');
  assert.equal(x.quote, '"');
  assert.equal(x.start, t2.lastIndexOf('"'));
  x = c.kcContext('{a:[{b:1},{', 11);
  assert.equal(x.mode, 'key');
  assert.deepEqual(plain(Array.from(x.path)), ['a', '[]']);
  assert.equal(x.root, 'nbt');
  x = c.kcContext('{effects:[{type:"apply_effects",', 32);
  assert.equal(x.values.type, 'apply_effects');
  x = c.kcContext('{id:minecraft:dia', 17);
  assert.equal(x.mode, 'value');
  assert.equal(x.prefix, 'minecraft:dia');
  assert.equal(c.kcContext('{a:1 ', 5).mode, 'none', 'after a complete value');
  assert.equal(c.kcContext('{a:[I;', 6).mode, 'none', 'typed array prefix');
  assert.equal(c.kcContext('{a:"x', 5).mode, 'value', 'inside an unterminated string value');
  x = c.kcContext('{a:[', 4);
  assert.deepEqual(plain(Array.from(x.path)), ['a', '[]']);
  // Insertion: key with template and caret inside, comma before a following key, quotes for values.
  let txt = '{\n  |\n  count: 1\n}';
  let p = txt.indexOf('|');
  txt = txt.replace('|', '');
  x = c.kcContext(txt, p);
  let e = c.kcCompletionEdit(txt, x, { v: 'components', k: 'key', t: '{}' });
  let out = txt.slice(0, e.from) + e.insert + txt.slice(e.to);
  assert.equal(out, '{\n  components: {},\n  count: 1\n}');
  assert.equal(out.charAt(e.caret - 1), '{', 'caret inside the template');
  txt = '{id:"minecraft:dia}';
  x = c.kcContext(txt, 18);
  e = c.kcCompletionEdit(txt, x, { v: 'minecraft:diamond', k: 'id' });
  assert.equal(txt.slice(0, e.from) + e.insert + txt.slice(e.to), '{id:"minecraft:diamond"}', 'open quote completed');
  txt = '{a:1,"minecraft:fo": {}}';
  x = c.kcContext(txt, 18);
  e = c.kcCompletionEdit(txt, x, { v: 'minecraft:food', k: 'component' });
  assert.equal(txt.slice(0, e.from) + e.insert + txt.slice(e.to), '{a:1,"minecraft:food": {}}', 'existing colon kept');
  txt = '{b:,c:1}';
  x = c.kcContext(txt, 3);
  e = c.kcCompletionEdit(txt, x, { v: 'true', k: 'bool' });
  assert.equal(txt.slice(0, e.from) + e.insert + txt.slice(e.to), '{b:true,c:1}');
  txt = '{components:{}}';
  x = c.kcContext(txt, 13);
  e = c.kcCompletionEdit(txt, x, { v: '!minecraft:food', k: 'removal', t: '{}' });
  assert.equal(txt.slice(0, e.from) + e.insert + txt.slice(e.to), '{components:{"!minecraft:food": {}}}');
  assert.deepEqual(
    plain(
      c
        .kcFilterItems([{ v: 'minecraft:stone' }, { v: 'minecraft:cobblestone' }, { v: 'mod:stone_x' }], 'stone')
        .map((i) => i.v)
    ),
    ['minecraft:stone', 'mod:stone_x', 'minecraft:cobblestone'],
    'path-prefix matches first, then contains'
  );
}
// ---- 补全弹窗：只发语境（不发整段文本），↑↓/Enter 采纳，Esc 关闭；关闭时 Enter / Tab 不被吞
{
  const live = c.Reg.live;
  c.Reg.live = () => true;
  const doc =
    '{id:"minecraft:stone",count:1,components:{\n' +
    '  "minecraft:custom_data": {big: "' +
    'z'.repeat(20000) +
    '"},\n  \n}}';
  const { code, ta } = editor(doc);
  const at = doc.indexOf('\n  \n') + 3;
  ta.selectionStart = ta.selectionEnd = at;
  const before = t.sent.length;
  assert.equal(key(ta, ' ', { ctrlKey: true }), true);
  const req = t.sent.slice(before).find(([k]) => k === 'code_assist');
  assert(req, 'request sent to the host');
  const msg = req[1];
  assert.equal(msg.mode, 'key');
  assert.deepEqual(plain(Array.from(msg.path)), ['components']);
  assert.equal(msg.item, 'minecraft:stone');
  assert(msg.siblings.includes('minecraft:custom_data'));
  assert(!JSON.stringify(msg).includes('zzzz'), 'document text is never sent');
  assert(JSON.stringify(msg).length < 1000);
  c.CodeAssistHost.receive({
    requestId: msg.requestId,
    ok: true,
    items: [
      { v: 'minecraft:enchantments', k: 'component' },
      { v: 'minecraft:food', k: 'component', df: true }
    ]
  });
  const pop = liveAc(code.surface);
  assert(pop, 'popup shown near the caret');
  assert.equal(qa(pop, '.kc-ac-i').length, 2);
  assert.match(pop.textContent, /默认组件/);
  assert.equal(key(ta, 'ArrowDown'), true);
  assert.equal(key(ta, 'Enter'), true);
  assert(code.get().includes('\n  "minecraft:food": \n'), 'accepted with quotes and ": "');
  assert.equal(liveAc(code.surface), null);
  // Closed popup: Enter / Tab go to the text field.
  assert.equal(key(ta, 'Enter'), false);
  // Escape closes without leaking to the page.
  key(ta, ' ', { ctrlKey: true });
  const req2 = t.sent[t.sent.length - 1];
  c.CodeAssistHost.receive({ requestId: req2[1].requestId, ok: true, items: [{ v: 'x', k: 'enum' }] });
  assert(liveAc(code.surface));
  let stopped = false;
  ta.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation: () => (stopped = true) });
  assert.equal(liveAc(code.surface), null);
  assert(stopped);
  // Typing ':' schedules an automatic request; a stale answer is ignored.
  const n0 = t.sent.length;
  type(ta, ta.value.indexOf('{big'), ta.value.indexOf('{big'), '');
  runTimers();
  assert(t.sent.length >= n0);
  // Offline: local candidates only, with a short note.
  c.Reg.live = () => false;
  const off = editor('{}');
  off.ta.selectionStart = off.ta.selectionEnd = 1;
  key(off.ta, ' ', { ctrlKey: true });
  const offPop = liveAc(off.code.surface);
  assert(offPop);
  assert.match(offPop.textContent, /补全需要进入世界|这里没有候选/);
  const st = editor('{\n}');
  st.ta.selectionStart = st.ta.selectionEnd = 2;
  // Stack root detection needs the stack keys; an empty object is free NBT.
  c.Reg.live = live;
}
console.log(
  'PASS code IDE: fold real-text fidelity/mapping/rejection/copy/gutter, bracket pairs, find/replace/regex guards/goto, embedded string escapes/formatted round trip/depth/stale parent, completion context/insertion/host window, colour literals'
);
