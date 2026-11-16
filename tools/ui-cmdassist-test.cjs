// 命令框辅助 CommandAssist.attach：防抖后请求宿主检查，状态（通过 / 错误行列可定位 / 无法检查），
// Ctrl+Space 补全（只在显式点击时才向服务器请求），采纳候选按范围替换并保留前导 /，detach 清理。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');
const t = H.create(),
  c = t.c;
c.snd = () => {};
let toasts = [];
c.toast = (m) => toasts.push(m);
function runTimers() {
  for (let guard = 0; guard < 10 && t.timers.length; guard++) {
    // Debounces only: request timeouts (seconds) must not fire in the middle of a test.
    const list = t.timers.splice(0);
    list.filter((x) => !x.repeat && x.ms <= 500).forEach((x) => x.fn());
  }
}
const key = (ta, key, extra) => {
  let prevented = false;
  ta.fire('keydown', Object.assign({ key, preventDefault: () => (prevented = true) }, extra || {}));
  return prevented;
};
const lastSent = (op) => {
  for (let i = t.sent.length - 1; i >= 0; i--)
    if (t.sent[i][0] === 'command_assist' && (!op || t.sent[i][1].op === op)) return t.sent[i][1];
  return null;
};

// Without a live host: never pretends the command is fine.
{
  const box = t.doc.createElement('div'),
    ta = t.doc.createElement('textarea');
  box.appendChild(ta);
  ta.value = 'give @s stone';
  const detach = c.CommandAssist.attach(ta);
  const status = box.querySelector('.cma-st');
  assert(status, 'status line inserted after the textarea');
  assert.equal(box.children.indexOf(status.parentNode.parentNode), 1);
  assert.match(status.textContent, /无法检查/);
  detach();
  assert.equal(box.querySelector('.cma'), null, 'detach removes the status line');
}
const live = c.Reg.live;
c.Reg.live = () => true;
{
  const host = t.doc.createElement('div'),
    ta = t.doc.createElement('textarea');
  ta.setSelectionRange = (a, b) => {
    ta.selectionStart = a;
    ta.selectionEnd = b;
  };
  let applied = [];
  ta.value = '/give @s stone 1';
  const detach = c.CommandAssist.attach(ta, { host, onApply: (v) => applied.push(v) });
  const status = host.querySelector('.cma-st');
  assert(status, 'mounted in the given host');
  let req = lastSent('check');
  assert.equal(req.text, '/give @s stone 1', 'leading slash sent as typed');
  assert.match(status.textContent, /检查中/);
  c.CmdAssistHost.receive({ requestId: req.requestId, ok: true, op: 'check', status: 'ok', start: -1 });
  assert.match(status.textContent, /语法通过/);
  assert(status.classList.contains('ok'));
  // Debounced re-check on input; stale answers for older text are ignored.
  ta.value = '/give @s stone x';
  ta.fire('input');
  const before = t.sent.length;
  ta.fire('input');
  assert.equal(t.sent.length, before, 'no request before the input pause');
  runTimers();
  req = lastSent('check');
  assert.equal(req.text, '/give @s stone x');
  c.CmdAssistHost.receive({
    requestId: req.requestId,
    ok: true,
    op: 'check',
    status: 'error',
    message: 'Invalid integer',
    start: 15
  });
  assert.match(status.textContent, /第 1 行第 16 列：Invalid integer/);
  status.fire('click');
  assert.equal(ta.selectionStart, 15, 'clicking the error selects its position');
  assert.equal(ta.selectionEnd, 16);
  // Unknown root: "cannot check", naming the command.
  ta.value = 'op Steve';
  ta.fire('input');
  runTimers();
  req = lastSent('check');
  c.CmdAssistHost.receive({
    requestId: req.requestId,
    ok: true,
    status: 'unchecked',
    reason: 'unknown_root',
    root: 'op',
    start: -1
  });
  assert.match(status.textContent, /无法检查.*op/);
  // Too long: never sent.
  const n = t.sent.length;
  ta.value = 'say ' + 'x'.repeat(32767);
  ta.fire('input');
  runTimers();
  assert.equal(t.sent.length, n, 'over-long commands are not sent');
  assert.match(status.textContent, /32767/);
  // Suggestions: local by default; skipped server suggestions offer an explicit request.
  ta.value = '/gi';
  ta.selectionStart = ta.selectionEnd = 3;
  assert.equal(key(ta, ' ', { ctrlKey: true }), true);
  req = lastSent('suggest');
  assert.equal(req.server, false, 'never asks the server by default');
  assert.equal(req.cursor, 3);
  c.CmdAssistHost.receive({
    requestId: req.requestId,
    ok: true,
    op: 'suggest',
    suggestions: [
      { text: 'gamemode', from: 1, to: 3 },
      { text: 'give', from: 1, to: 3, tooltip: 'Give an item' }
    ],
    askServer: true
  });
  const list = host.querySelector('.cma-pop');
  assert.notEqual(list.style.display, 'none');
  assert.equal(list.querySelectorAll('.cma-i').length, 2);
  assert(list.querySelector('.cma-ask'), 'explicit server request row');
  assert.equal(key(ta, 'ArrowDown'), true);
  assert.equal(key(ta, 'Enter'), true);
  assert.equal(ta.value, '/give', 'range replaced, slash kept');
  assert.equal(applied[applied.length - 1], '/give');
  assert.equal(list.style.display, 'none');
  // Closed list: Enter / Tab are not swallowed.
  assert.equal(key(ta, 'Enter'), false);
  assert.equal(key(ta, 'Tab'), false);
  // Explicit server request: flagged and announced.
  key(ta, ' ', { ctrlKey: true });
  req = lastSent('suggest');
  c.CmdAssistHost.receive({ requestId: req.requestId, ok: true, op: 'suggest', suggestions: [], askServer: true });
  toasts = [];
  list.querySelector('.cma-ask').fire('mousedown');
  req = lastSent('suggest');
  assert.equal(req.server, true, 'server only on the explicit click');
  assert(toasts.some((m) => /发给服务器/.test(m)));
  c.CmdAssistHost.receive({
    requestId: req.requestId,
    ok: true,
    op: 'suggest',
    suggestions: [{ text: 'stone', from: 6, to: 6 }],
    server: true,
    askServer: false
  });
  assert(!list.querySelector('.cma-ask'), 'no second server prompt after a server answer');
  // Escape closes the list without leaking.
  let stopped = false;
  ta.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation: () => (stopped = true) });
  assert(stopped);
  assert.equal(list.style.display, 'none');
  // Offline answer from the host.
  key(ta, ' ', { ctrlKey: true });
  req = lastSent('suggest');
  c.CmdAssistHost.receive({
    requestId: req.requestId,
    ok: true,
    op: 'suggest',
    status: 'unchecked',
    reason: 'offline'
  });
  assert.match(list.textContent, /未进入世界/);
  // Detach: listeners removed, nothing more is sent.
  detach();
  const m = t.sent.length;
  ta.value = 'give @s';
  ta.fire('input');
  runTimers();
  assert.equal(t.sent.length, m, 'no requests after detach');
  assert.equal(host.querySelector('.cma'), null);
}
c.Reg.live = live;
console.log(
  'PASS command assist: debounced host check, ok/error line:col navigation/unchecked reasons, length guard, local-only suggestions with explicit server request, range insertion keeping /, Enter/Tab passthrough, detach'
);
