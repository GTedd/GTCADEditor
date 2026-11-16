// SNBT 补全默认开启：输入键名、值或结构符号时自动请求候选并弹出，不需要 Ctrl+Space；删字后按剩下的前缀继续提示；
// 不可补全的位置和没有候选时什么都不显示。
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
c.Reg.live = () => true;
const qa = (el, sel) => el.querySelectorAll(sel);
const liveAc = (surface) => qa(surface, '.kc-ac').find((e) => !e.classList.contains('ui-leaving')) || null;
function runTimers() {
  for (let guard = 0; guard < 20 && t.timers.length; guard++) {
    const list = t.timers.splice(0);
    list.filter((x) => !x.repeat && x.ms <= 500).forEach((x) => x.fn());
  }
}
function editor(value) {
  const code = c.kCode({ value });
  const ta = qa(code.el, 'textarea')[0];
  ta.setSelectionRange = (a, b) => {
    ta.selectionStart = a;
    ta.selectionEnd = b;
  };
  ta.selectionStart = ta.selectionEnd = 0;
  return { code, ta };
}
function type(ta, at, s, inputType) {
  ta.selectionStart = ta.selectionEnd = at;
  ta.fire('beforeinput', { inputType: inputType || 'insertText', data: s });
  ta.value = ta.value.slice(0, at) + s + ta.value.slice(at);
  ta.selectionStart = ta.selectionEnd = at + s.length;
  ta.fire('input', { inputType: inputType || 'insertText', data: s });
}
function backspace(ta) {
  const at = ta.selectionStart;
  ta.fire('beforeinput', { inputType: 'deleteContentBackward', data: null });
  ta.value = ta.value.slice(0, at - 1) + ta.value.slice(at);
  ta.selectionStart = ta.selectionEnd = at - 1;
  ta.fire('input', { inputType: 'deleteContentBackward', data: null });
}
const requests = (from) => t.sent.slice(from).filter(([k]) => k === 'code_assist');
const DOC = '{id:"minecraft:stone",count:1,components:{\n  \n}}';

// 1. Typing a key opens the list by itself: request after the pause, popup when the host answers.
{
  const { code, ta } = editor(DOC);
  const at = DOC.indexOf('\n  \n') + 3;
  const n0 = t.sent.length;
  type(ta, at, '"');
  type(ta, at + 1, 'f');
  assert.equal(requests(n0).length, 0, 'debounced: nothing sent while typing');
  runTimers();
  const sent = requests(n0);
  assert(sent.length >= 1, 'a request without any shortcut');
  const msg = sent[sent.length - 1][1];
  assert.equal(msg.mode, 'key');
  assert.equal(msg.prefix, 'f');
  c.CodeAssistHost.receive({
    requestId: msg.requestId,
    ok: true,
    items: [
      { v: 'minecraft:food', k: 'component', df: true },
      { v: 'minecraft:fireworks', k: 'component' }
    ]
  });
  const pop = liveAc(code.surface);
  assert(pop, 'popup opened automatically');
  assert(qa(pop, '.kc-ac-i').length >= 1);
}

// 2. A letter in a key position triggers; a space alone does not.
{
  const doc = '{id:"minecraft:stone",count:1,components:{"minecraft:food":{}}}';
  const { ta } = editor(doc);
  const inside = doc.indexOf('"minecraft:food":{') + '"minecraft:food":{'.length;
  let n0 = t.sent.length;
  type(ta, inside, 'n');
  runTimers();
  assert(requests(n0).length >= 1, 'a letter in a key position');
  n0 = t.sent.length;
  type(ta, ta.selectionStart, ' ');
  runTimers();
  assert.equal(requests(n0).length, 0, 'a space alone does not open the list');
}

// 3. Deleting back into a word asks again for the shorter prefix.
{
  const { ta } = editor(DOC);
  const at = DOC.indexOf('\n  \n') + 3;
  type(ta, at, '"');
  type(ta, at + 1, 'fo');
  runTimers();
  const n0 = t.sent.length;
  backspace(ta);
  runTimers();
  const sent = requests(n0);
  assert(sent.length >= 1, 'request after deleting');
  assert.equal(sent[sent.length - 1][1].prefix, 'f', 'prefix follows the deletion');
}

// 4. No candidates: nothing is shown while typing (only Ctrl+Space shows the "no candidates" note).
{
  const { code, ta } = editor(DOC);
  const at = DOC.indexOf('\n  \n') + 3;
  const n0 = t.sent.length;
  type(ta, at, '"');
  type(ta, at + 1, 'q');
  runTimers();
  const sent = requests(n0);
  c.CodeAssistHost.receive({ requestId: sent[sent.length - 1][1].requestId, ok: true, items: [] });
  assert.equal(liveAc(code.surface), null, 'empty answers stay quiet while typing');
}

console.log(
  'PASS SNBT completion is on by default: typing keys/values/structure opens it, deleting re-asks, quiet without candidates'
);
