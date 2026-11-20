// 物品类别与窗口的类别色（--cat：左栏光晕和类别标签）。
// 1. 类别按原版创造模式的分类页：“战斗用品”页里带武器或工具组件的（剑、长矛、斧、锤、三叉戟）是战斗用品，
//    只在“工具与实用物品”页的镐、铲、锄是工具；没有分类页信息时按组件判断。
// 2. 类别要等物品数据到达后才确定：之前不画光晕、标签用中性灰（不再先显示绿色），确定后换成类别色并淡入一次；
//    不需要等到改窗口大小（例如“窗口布局 → 恢复默认”）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./lib/ui-harness.cjs');

const t = H.create({ data: {} }),
  c = t.c;
// redrawRegistryPage lives in app.js, which the harness does not boot.
const app = fs.readFileSync(path.join(t.dir, 'js/app.js'), 'utf8');
vm.runInContext(app.slice(0, app.lastIndexOf('boot();')), c, { filename: 'js/app.js' });

// ---- 1. kind from facts ----
const COMBAT = 'minecraft:combat',
  TOOLS = 'minecraft:tools_and_utilities';
const kind = (id, meta, dc) => c.kindFromFacts(id, dc || {}, meta);
assert.equal(kind('diamond_sword', { weapon: true, tool: true, creative_tabs: [COMBAT] }), 'melee', 'sword');
assert.equal(kind('iron_spear', { weapon: true, creative_tabs: [COMBAT] }), 'melee', 'spear');
assert.equal(kind('iron_axe', { weapon: true, tool: true, creative_tabs: [TOOLS, COMBAT] }), 'melee', 'axe');
assert.equal(kind('mace', { weapon: true, creative_tabs: [COMBAT] }), 'melee', 'mace');
assert.equal(kind('trident', { tool: true, creative_tabs: [COMBAT] }), 'melee', 'trident');
assert.equal(kind('iron_pickaxe', { weapon: true, tool: true, creative_tabs: [TOOLS] }), 'tool', 'pickaxe');
assert.equal(kind('iron_hoe', { weapon: true, tool: true, creative_tabs: [TOOLS] }), 'tool', 'hoe');
assert.equal(kind('iron_chestplate', { armor_slot: 'chest', creative_tabs: [COMBAT] }), 'armor', 'armor stays armor');
assert.equal(kind('bow', { ranged_weapon: true, creative_tabs: [COMBAT] }), 'ranged', 'bow stays ranged');
assert.equal(kind('shield', { creative_tabs: [COMBAT] }, { blocks_attacks: {} }), 'shield', 'shield stays shield');
assert.equal(kind('arrow', { creative_tabs: [COMBAT] }), 'generic', 'combat items without weapon / tool');
// Without creative tab facts (a mod item in no vanilla tab): components decide, as before.
assert.equal(kind('mod_blade', { weapon: true }), 'melee', 'weapon without tool');
assert.equal(kind('mod_axe', { weapon: true, tool: true }, { weapon: { disable_blocking_for_seconds: 5 } }), 'melee');
assert.equal(kind('mod_pick', { weapon: true, tool: true }), 'tool');
assert.equal(c.KIND_INFO.melee.name, '战斗用品', 'named as the creative tab');

// ---- 2. category colour waits for the kind ----
c.Store.open({ id: 'minecraft:diamond_sword', count: 1, comps: {}, removed: {} }, true);
const win = t.root.querySelector('#win');
// The harness is a live page without item facts: the kind is not known yet.
c.Reg.preview = () => false;
c.Reg.live = () => true;
assert.equal(c.kindKnown('minecraft:diamond_sword'), false, 'no facts yet');
c.drawEdit();
assert.ok(win.getAttribute('style').includes('--cat:#8c8d90'), 'neutral colour before the data, not green');
assert.ok(win.classList.contains('cat-pending'), 'no halo before the data');

// The item data arrives and decides the kind.
c.kindKnown = () => true;
c.kindOfItem = (id) => (id === 'minecraft:diamond_sword' ? 'melee' : 'generic');
c.redrawRegistryPage(['item_meta_one']);
assert.ok(
  win.getAttribute('style').includes('--cat:' + c.KIND_INFO.melee.color),
  'combat colour once the kind is known'
);
assert.equal(win.classList.contains('cat-pending'), false);
assert.ok(win.classList.contains('cat-in'), 'the halo fades in once');
assert.equal(c.UI.shellKind, 'melee');

// A generic item becomes known too: the pending state ends even though the kind name does not change.
c.Store.open({ id: 'minecraft:stone', count: 1, comps: {}, removed: {} }, true);
c.kindKnown = () => false;
c.applyWinStyle();
assert.ok(win.classList.contains('cat-pending'));
c.kindKnown = () => true;
c.redrawRegistryPage(['item_meta_one']);
assert.ok(win.getAttribute('style').includes('--cat:' + c.KIND_INFO.generic.color));
assert.equal(win.classList.contains('cat-pending'), false, 'generic item leaves the pending state');

// Data that changes nothing leaves the window style alone.
win.setAttribute('style', '--cat:' + c.KIND_INFO.generic.color + ';--marker:1;');
c.redrawRegistryPage(['item_meta_one']);
assert.ok(win.getAttribute('style').includes('--marker:1'), 'no restyle without a change');

console.log('PASS item category: combat items by the creative tabs, category colour only once the kind is known.');
