// Client-only world pages: actual builders, draft isolation and keyboard routing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('./lib/ui-harness.cjs');

for (const kind of ['block', 'entity']) {
  const world = { kind, readOnly: true, partial: true, canUndo: false,
    type: kind === 'block' ? 'minecraft:oak_stairs' : 'minecraft:pig',
    revision: 'client-view-test', slot: { kind, dim: 'minecraft:overworld', x: 1, y: 64, z: 1, uuid: 'test', id: 1 },
    snbt: '{}', nbt: {}, client_values: { 'cadeditor.ui.world.position': '1 / 64 / 1' } };
  if (kind === 'block') { world.block = world.type; world.client_properties = { facing: 'north', waterlogged: 'false' }; }
  else world.client_name = '猪';
  const events = {};
  const h = create({ documentEvents: events, data: { hostPrefs: true, prefs: {}, world } }), c = h.c;
  // Load app after the harness has created index.html's skeleton, as in the native host.
  vm.runInContext(fs.readFileSync(path.join(h.dir, 'js/app.js'), 'utf8'), c, { filename: 'js/app.js' });
  assert.match(h.doc.getElementById('screen').textContent, /只读 · 服务端未安装 CAD Editor，无法编辑数据/);
  assert.equal(h.doc.getElementById('screen').querySelectorAll('input, textarea, select').length, 0);
  assert.equal(h.doc.getElementById('topbar').querySelectorAll('.k-apply').length, 0);
  assert.equal(c.WorldDrafts.key(world), null);
  const text = c.WE.text, before = h.sent.length;
  c.wePut(); c.weApply(); c.weUndo(); c.weSend('apply', { snbt: '{Health:1f}' });
  c.WorldDrafts.restore({}); // Even a malformed saved draft must not be read or restored.
  c.WorldDrafts.flush();
  assert.equal(c.WE.text, text);
  assert.equal(c.weDirty(), false);
  assert.equal(h.sent.length, before);
  for (const k of ['k', 'i', 's', 'z', 'y', '1']) {
    let prevented = false;
    const e = { key: k, ctrlKey: true, target: h.root, preventDefault() { prevented = true; } };
    for (const listener of events.keydown) listener(e);
    assert.equal(prevented, true, kind + ': block root Ctrl+' + k);
  }
  assert.equal(h.doc.getElementById('modal'), null);
  assert.equal(h.sent.length, before);
  c.openSettings(); // Viewing preferences remains available.
  assert.ok(h.doc.getElementById('modal'));
  assert.match(h.root.textContent, /页面背景不透明度/);
}
console.log('PASS readonly world UI: block/entity, no editing controls, no writes, draft isolation, keyboard routing, settings.');
