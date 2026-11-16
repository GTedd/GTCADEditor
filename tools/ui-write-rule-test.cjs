// Write rule on the item page (VanillaWriteRule, docs/editor/client-only-hotbar.md): when the server has no CAD Editor
// and the player is neither creative nor an operator, the host marks the page writeClosed. The draft stays editable,
// the footer "write permissions and scope" and the apply window explain why, a closed refusal keeps the draft, and the
// host can re-send the capability when permission changes mid-session (op/deop).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./lib/ui-harness.cjs');

const closedText = '写回已关闭的能力说明',
  openText = '命令模式能力说明';
const t = H.create({
  data: {
    stack: {
      id: 'minecraft:diamond_sword',
      count: 1,
      comps: {},
      removed: {},
      slot: { kind: 'inventory', index: 3 },
      capability: closedText,
      writeClosed: true
    }
  }
});
const c = t.c;
c.Reg.meta = {};
c.Reg.kinds = {};
c.window.EDITOR_PREVIEW = true;
c.snd = () => {};
const toasts = [];
c.toast = (text, kind) => toasts.push({ text, kind });
// Boot the real app.js with a recording oriel.on, so host patches go through the page's own data handler.
const events = {};
c.oriel.on = (k, fn) => (events[k] = fn);
vm.runInContext(fs.readFileSync(path.join(t.dir, 'js/app.js'), 'utf8'), c, { filename: 'js/app.js' });
const T = (key) => c.I18n.t(key);
const chip = () => t.doc.getElementById('footer').querySelector('.inventory-capability');

assert.equal(c.EditorInventoryClosed, true, 'opened with the route closed');
assert.equal(c.EditorInventoryCapability, closedText);
assert.ok(chip(), 'footer shows write permissions and scope');
assert.equal(chip().getAttribute('data-tip'), closedText);
// Draft stays editable.
c.Store.set('custom_name', '草稿');
assert.equal(c.Store.doc().comps.custom_name, '草稿');
// Apply window explains the closure but still lets the host decide (re-evaluated per submission).
c.openApply();
let win = t.doc.getElementById('modal');
const warn = win.querySelectorAll('.k-effect').find((x) => x.classList.contains('warn'));
assert.ok(warn && warn.textContent === closedText, 'apply window states why writing back is off');
c.closeModal();
c.applyToGame();
const sent = t.sent.filter((x) => x[0] === 'apply');
assert.equal(sent.length, 1, 'submission still reaches the host, which refuses it locally');
events.data(
  {
    result: {
      requestId: sent[0][1].requestId,
      status: 'rejected',
      code: 'vanilla_closed',
      reason: T('cadeditor.ui.worldplayer.vanilla_closed_draft')
    }
  },
  'result'
);
const refusal = toasts[toasts.length - 1];
assert.equal(refusal.kind, 'error');
assert.ok(refusal.text.startsWith(T('cadeditor.ui.worldplayer.vanilla_closed_draft')));
assert.ok(!refusal.text.includes(T('cadeditor.ui.app.permission_save_changes_draft_kept')), 'no generic follow-up');
assert.equal(c.Store.doc().comps.custom_name, '草稿', 'draft kept after a closed refusal');
assert.equal(c.EditorBridge.pending, null, 'next apply allowed');
console.log('PASS write rule closed: footer and apply window explain it, refusal keeps the draft');

// Opped mid-session: the host re-sends the capability; footer and apply window follow without reopening.
events.data({ inventory_capability: { capability: openText, writeClosed: false } }, 'inventory_capability');
assert.equal(c.EditorInventoryClosed, false);
assert.equal(c.EditorInventoryCapability, openText);
assert.equal(chip().getAttribute('data-tip'), openText, 'footer updated in place');
assert.equal(toasts[toasts.length - 1].text, openText);
c.openApply();
win = t.doc.getElementById('modal');
assert.ok(!win.querySelectorAll('.k-effect').some((x) => x.classList.contains('warn')), 'no closure notice once opped');
c.closeModal();
// Deopped again.
events.data({ inventory_capability: { capability: closedText, writeClosed: true } });
assert.equal(c.EditorInventoryClosed, true, 'combined data patches are understood too');
assert.equal(chip().getAttribute('data-tip'), closedText);
// A reloaded page keeps its "close and read again" notice; capability updates cannot replace it.
events.data({ stale: true, reason: '关闭后重新读取' }, 'inventory_session');
events.data({ capability: openText, writeClosed: false }, 'inventory_capability');
assert.equal(c.EditorInventoryCapability, '关闭后重新读取');
console.log('PASS write rule live: op/deop mid-session updates footer and apply window; reload notice wins');
