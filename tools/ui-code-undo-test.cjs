// SNBT 编辑器的页面撤销：Ctrl+Z / Ctrl+Y 由页面按“真实文本 + 折叠 + 选区”记录，折叠、展开、整体替换都不再清空历史。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');
H.Element.prototype.setTextHighlights = function () {
  return true;
};
const t = H.create(),
  c = t.c;
c.snd = () => {};
c.Reg.meta = {};
c.toast = () => {};
const qa = (el, sel) => el.querySelectorAll(sel);

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
function key(ta, k, extra) {
  let prevented = false;
  ta.fire('keydown', Object.assign({ key: k, ctrlKey: true, preventDefault: () => (prevented = true) }, extra || {}));
  return prevented;
}
const undo = (ta) => key(ta, 'z');
const redo = (ta) => key(ta, 'y');
// User typing into the display: replace [a, b) of the current display with s, caret after it.
function type(ta, a, b, s, inputType) {
  ta.selectionStart = a;
  ta.selectionEnd = b;
  ta.fire('beforeinput', { inputType: inputType || 'insertText', data: s });
  ta.value = ta.value.slice(0, a) + s + ta.value.slice(b);
  ta.selectionStart = ta.selectionEnd = a + s.length;
  ta.fire('input', { inputType: inputType || 'insertText', data: s });
}

const TEXT = [
  '{',
  '  id: "minecraft:stone",',
  '  components: {',
  '    "minecraft:custom_data": {',
  '      a: 1',
  '    }',
  '  }',
  '}'
].join('\n');
const OPEN = TEXT.indexOf('components: {') + 'components: '.length;

// 1. Undo / redo of plain typing; a burst of typing is one step, a paste is its own step.
{
  const { code, ta } = editor(TEXT);
  const at = TEXT.indexOf('stone');
  type(ta, at, at, 'x');
  type(ta, at + 1, at + 1, 'y');
  assert.equal(code.get(), TEXT.replace('stone', 'xystone'));
  type(ta, 0, 0, '// ', 'insertFromPaste');
  assert(undo(ta), 'Ctrl+Z is handled by the page');
  assert.equal(code.get(), TEXT.replace('stone', 'xystone'), 'the paste is undone alone');
  undo(ta);
  assert.equal(code.get(), TEXT, 'the typing burst is one step');
  assert.equal(ta.value, TEXT);
  assert(redo(ta), 'Ctrl+Y is handled by the page');
  assert.equal(code.get(), TEXT.replace('stone', 'xystone'));
  key(ta, 'z', { shiftKey: true }); // Ctrl+Shift+Z redoes too
  assert.equal(code.get(), '// ' + TEXT.replace('stone', 'xystone'));
  assert.equal(ta.selectionStart, 3, 'redo restores the caret after the paste');
}

// 2. Folding and unfolding keep the history; undo works while folded and restores the real text.
{
  const { code, ta } = editor(TEXT);
  const at = TEXT.indexOf('"minecraft:stone"');
  type(ta, at, at, 'Q');
  code.fold(OPEN + 1); // a shifted offset: one character was inserted before the region
  assert(ta.value.indexOf('⋯') > 0, 'the region is folded');
  code.unfoldAll();
  code.fold(OPEN + 1);
  undo(ta);
  assert.equal(code.get(), TEXT, 'undo after fold / unfold / fold restores the real text');
  assert(ta.value.indexOf('Q') < 0, 'the display follows the restored text');
  assert(ta.value.indexOf('⋯') > 0, 'the current fold is kept, shifted onto the restored text');
  redo(ta);
  assert.equal(code.get(), TEXT.replace('"minecraft:stone"', 'Q"minecraft:stone"'));
}

// 3. An edit typed while folded (outside the fold) is undone exactly; the hidden text is untouched.
{
  const { code, ta } = editor(TEXT);
  code.fold(OPEN);
  const display = ta.value;
  const at = display.indexOf('stone');
  type(ta, at, at, 'red_');
  assert.equal(code.get(), TEXT.replace('stone', 'red_stone'));
  undo(ta);
  assert.equal(code.get(), TEXT);
  assert.equal(ta.value, display, 'still folded after undo');
}

// 4. Replacements through the editor API (completion, replace-all) are separate undo steps.
{
  const { code, ta } = editor(TEXT);
  const ed = code.editor;
  const at = TEXT.indexOf('stone');
  ed.replace(at, at + 'stone'.length, 'dirt');
  assert.equal(code.get(), TEXT.replace('stone', 'dirt'));
  undo(ta);
  assert.equal(code.get(), TEXT);
  redo(ta);
  assert.equal(code.get(), TEXT.replace('stone', 'dirt'));
}

// 5. A new typing step clears redo; a value set from outside starts a new history; read-only ignores the keys.
{
  const { code, ta } = editor(TEXT);
  type(ta, 0, 0, 'a');
  undo(ta);
  type(ta, 0, 0, 'b', 'insertFromPaste');
  redo(ta);
  assert.equal(code.get(), 'b' + TEXT, 'redo after a new edit does nothing');
  code.set('{}');
  undo(ta);
  assert.equal(code.get(), '{}', 'history does not cross an outside set()');
  const ro = editor(TEXT, { readonly: true });
  assert(undo(ro.ta), 'read-only still keeps the keys from the native control');
  assert.equal(ro.code.get(), TEXT);
}

// 6. Undo notifies the owner like an edit, so the draft follows.
{
  let last = null;
  const { code, ta } = editor(TEXT, {
    onText: (v) => {
      last = v;
    }
  });
  type(ta, 0, 0, 'z');
  undo(ta);
  assert.equal(last, TEXT, 'onText receives the restored text');
  assert.equal(code.get(), TEXT);
}

console.log(
  'PASS SNBT editor page-owned undo: typing bursts, paste steps, fold/unfold keep history, API replace, redo'
);
