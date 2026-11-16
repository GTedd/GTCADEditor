// New item (js/newitem.js): pick any registry item, edit a slotless "new item" page from its default stack, then put it
// in an empty inventory slot through the vault give engine (vault op give with the stack inline, or uploaded when large),
// or store it in the vault. Every failure keeps the draft; going back returns to the page (or vault) it came from.
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

function fresh(rootId) {
  const t = H.create(),
    c = t.c;
  c.Reg.meta = {};
  c.Reg.kinds = {};
  c.window.EDITOR_PREVIEW = true;
  c.snd = () => {};
  t.toasts = [];
  c.toast = (text, kind) => t.toasts.push({ text, kind });
  if (rootId) {
    c.Store.docs.push(c.makeDoc({ id: rootId, comps: {}, src: { kind: 'inventory', index: 0 } }));
    c.rebuild();
  }
  return t;
}
const T = (c, key, ...args) => c.I18n.t(key, ...args);
const gives = (t) => t.sent.filter((x) => x[0] === 'vault' && x[1].op === 'give').map((x) => x[1]);
const reply = (t, request, fields) => t.c.Vault.receive(Object.assign({ requestId: request.requestId }, fields));
const shortTimers = (t) => {
  const due = t.timers.filter((x) => x.ms <= 100 && !x.repeat);
  due.forEach((x) => t.timers.splice(t.timers.indexOf(x), 1));
  due.forEach((x) => x.fn());
};

// ---- from the editor: picker, default stack, slotless page ----
{
  const t = fresh('diamond_sword'),
    c = t.c;
  c.openNewItem();
  assert.ok(t.doc.getElementById('modal'), 'new item window open');
  shortTimers(t);
  assert.ok(c.KPop.el, 'item picker opens at once (live registry search, pinyin)');
  c.kPopClose();
  c.closeModal();
  c.openNewItemDoc('apple');
  assert.ok(c.NestedItem && c.NestedItem.options.newItem, 'new item page is a slotless nested page');
  const d = c.Store.doc();
  assert.equal(d.id, 'minecraft:apple');
  assert.equal(d.count, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(d.comps)), {}, 'baseline is the default stack');
  assert.equal(d.src, null, 'not bound to any slot');
  assert.equal(c.diffDoc(d).length, 0);
  // Footer "write permissions and scope" shows the vault give capability (the path a new item is written through).
  const stats = t.sent.filter((x) => x[0] === 'vault' && x[1].op === 'stats').pop();
  assert.ok(stats, 'asks the host for the current give capability');
  c.Vault.receive({ requestId: stats[1].requestId, ok: true, op: 'stats', giveCapability: '取出能力说明' });
  const chip = t.doc.getElementById('footer').querySelector('.inventory-capability');
  assert.equal(chip && chip.getAttribute('data-tip'), '取出能力说明');
  const apply = t.doc.getElementById('topbar').querySelectorAll('.k-apply')[0];
  assert.ok(apply.textContent.includes(T(c, 'cadeditor.ui.newitem.apply')), 'apply says put in inventory');
  assert.ok(!apply.classList.contains('dim'), 'a default stack can be put in as is');
  // Ctrl+S / apply: the new item window, never the parent's "save and return".
  c.openApply();
  const win = t.doc.getElementById('modal');
  assert.ok(win.textContent.includes(T(c, 'cadeditor.ui.newitem.apply_title')));
  const giveBtn = win
    .querySelectorAll('.k-btn')
    .find((b) => b.textContent.trim() === T(c, 'cadeditor.ui.newitem.give'));
  const storeBtn = win
    .querySelectorAll('.k-btn')
    .find((b) => b.textContent.trim() === T(c, 'cadeditor.ui.newitem.store'));
  assert.ok(giveBtn && storeBtn, 'put in inventory and store in vault');
  c.Store.set('custom_name', '新物品');
  giveBtn.click();
  let g = gives(t);
  assert.equal(g.length, 1, 'one give request');
  assert.equal(g[0].slot, 'inventory');
  assert.equal(g[0].stack.id, 'minecraft:apple');
  assert.equal(g[0].stack.comps.custom_name, '新物品', 'the edited stack is sent inline');
  assert.equal(g[0].id, undefined, 'not a vault entry');
  // Second click while waiting: held, not sent twice.
  c.newItemGive(c.Store.doc(), 'inventory');
  assert.equal(gives(t).length, 1, 'one in flight');
  // No empty slot: refused, draft kept.
  reply(t, g[0], { ok: false, error: 'INVENTORY_FULL', code: 'inventory_full', reason: '目标区域没有空槽' });
  let last = t.toasts[t.toasts.length - 1];
  assert.equal(last.kind, 'error');
  assert.ok(last.text.includes('目标区域没有空槽') && last.text.includes(T(c, 'cadeditor.ui.newitem.draft_kept')));
  assert.ok(c.NestedItem && c.Store.doc().comps.custom_name === '新物品', 'draft kept after refusal');
  // Closed vanilla route (no server editor, survival, no OP): refused locally, draft kept.
  c.newItemGive(c.Store.doc(), 'hotbar');
  g = gives(t);
  assert.equal(g[1].slot, 'hotbar');
  reply(t, g[1], { ok: false, error: 'vanilla_closed', code: 'vanilla_closed', reason: '写回已关闭' });
  assert.equal(t.toasts[t.toasts.length - 1].kind, 'error');
  // Creative: sent without a server confirmation only counts as submitted.
  c.newItemGive(c.Store.doc(), 'inventory');
  g = gives(t);
  reply(t, g[2], { ok: true, op: 'give', status: 'sent', confirmed: false, path: 'creative', reason: '已显示' });
  last = t.toasts[t.toasts.length - 1];
  assert.equal(last.kind, 'warn', 'unconfirmed creative give is not reported as confirmed');
  assert.ok(last.text.includes(T(c, 'cadeditor.ui.newitem.creative_unconfirmed')));
  // Confirmed (command readback or editor server).
  c.newItemGive(c.Store.doc(), 'inventory');
  g = gives(t);
  reply(t, g[3], { ok: true, op: 'give', status: 'saved', confirmed: true, path: 'command', reason: '服务器已确认' });
  assert.equal(t.toasts[t.toasts.length - 1].kind, 'ok');
  // Unknown outcome (host tombstone or page timeout): never claimed, draft kept.
  c.newItemGive(c.Store.doc(), 'inventory');
  g = gives(t);
  reply(t, g[4], { ok: false, status: 'unknown', code: 'request_timeout', reason: 'x' });
  assert.ok(t.toasts[t.toasts.length - 1].text.includes(T(c, 'cadeditor.ui.newitem.unknown')));
  // Large stack: uploaded first, then give with the upload token.
  c.Store.set('custom_name', 'x'.repeat(9000));
  c.newItemGive(c.Store.doc(), 'inventory');
  const upload = t.sent.filter((x) => x[0] === 'vault' && x[1].op === 'upload');
  assert.ok(upload.length >= 1, 'large stack uploads in chunks');
  console.log('PASS new item: default stack, inline give through the vault engine, refusals keep the draft, upload');
  // Going back with changes: continue or discard only (nothing to write back to).
  c.returnFromNestedItem();
  const leave = t.doc.getElementById('modal');
  const labels = leave.querySelectorAll('.k-btn').map((b) => b.textContent.trim());
  assert.ok(labels.includes(T(c, 'cadeditor.ui.screens.discard_return')));
  assert.ok(!labels.includes(T(c, 'cadeditor.ui.eschema.save_return')), 'no save-and-return for a new item');
  leave
    .querySelectorAll('.k-btn')
    .find((b) => b.textContent.trim() === T(c, 'cadeditor.ui.screens.discard_return'))
    .click();
  assert.equal(c.NestedItem, null);
  assert.equal(c.shortId(c.Store.doc().id), 'diamond_sword', 'back on the item that was open');
  console.log('PASS new item: going back offers continue/discard and restores the original page');
}

// ---- from the standalone vault: the editor window shows while editing, the vault comes back afterwards ----
{
  const t = fresh(null),
    c = t.c;
  // app.js enterVaultMode (app.js boots the page and is not loaded by the harness).
  c.VaultOnly = true;
  t.doc.body.classList.add('vault-only');
  c.Store.docs.length = 0;
  c.openVault({});
  assert.ok(c.VaultOnly && t.doc.body.classList.contains('vault-only'));
  const vault = t.doc.getElementById('modal');
  const btn = vault
    .querySelectorAll('.k-btn')
    .find((b) => b.textContent.trim() === T(c, 'cadeditor.ui.newitem.vault_button'));
  assert.ok(btn, 'vault window offers New item');
  btn.click();
  assert.notEqual(t.doc.getElementById('modal'), vault, 'picker window stacked over the vault');
  c.kPopClose();
  c.closeModal();
  assert.equal(t.doc.getElementById('modal'), vault, 'closing the picker returns to the vault, page stays open');
  c.openNewItemDoc('minecraft:stone');
  assert.ok(!c.VaultOnly && !t.doc.body.classList.contains('vault-only'), 'editor window shown');
  assert.equal(c.Store.doc().id, 'minecraft:stone');
  // A modal closed while editing must not close the page.
  let closed = 0;
  c.oriel.close = () => closed++;
  c.openNewItemApply();
  c.closeModal();
  assert.equal(closed, 0, 'closing a window while editing keeps the page');
  c.returnFromNestedItem();
  assert.ok(c.VaultOnly && t.doc.body.classList.contains('vault-only'), 'vault-only restored');
  assert.equal(t.doc.getElementById('modal'), vault, 'vault window is back');
  console.log('PASS new item from the standalone vault: editor shown while editing, vault restored on return');
}

// ---- palette entry ----
{
  const t = fresh('diamond_sword'),
    c = t.c;
  const item = c.paletteItems().find((x) => x.label === T(c, 'cadeditor.ui.newitem.action'));
  assert.ok(item, 'Ctrl+K offers New item');
  item.run();
  assert.ok(t.doc.getElementById('modal').textContent.includes(T(c, 'cadeditor.ui.newitem.title')));
  console.log('PASS Ctrl+K New item opens the picker window');
}
