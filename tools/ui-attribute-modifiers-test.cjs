// Regression: sword defaults remain editable; one attribute type may have multiple modifiers.
const assert = require('node:assert/strict'), H = require('./lib/ui-harness.cjs');
const t = H.create(), c = t.c;
c.window.EDITOR_PREVIEW = true; c.Reg.meta = {}; c.snd = () => {}; c.toast = () => {};
c.document.documentElement.setAttribute('data-motion', 'reduced');
let modal, menu, context;
c.openModal = el => { modal = el; }; c.closeModal = () => { modal = null; }; c.windowify = () => {};
c.pickFrom = (anchor, options, cb, opts) => { menu = { options, cb, opts }; };
c.kMenu = (x, y, items) => { context = items; };
const mods = () => c.Ctx.get('attribute_modifiers');
const plain = value => JSON.parse(JSON.stringify(value));
function open(id, components) { c.Store.open({ id, count: 1, comps: components || {}, removed: {} }, true); }
function pageAttrs(kind, tab) {
  const spec = c.PAGES[kind].find(p => p.id === tab).cards.find(s => s === 'extraAttrs' || Array.isArray(s) && s[0] === 'extraAttrs');
  assert(spec, kind + ' has a detailed modifier list');
  return Array.isArray(spec) ? c.CARDS.extraAttrs(...spec.slice(1)) : c.CARDS.extraAttrs();
}
const rows = card => card.el.querySelectorAll('.k-xrow');
function expand(card, index) { rows(card)[index].querySelector('.k-xhead').fire('click'); }
function select(card, index, control, value) {
  rows(card)[index].querySelectorAll('.k-sel')[control].fire('click');
  assert(menu.opts.manual, 'manual input remains available');
  menu.cb(menu.options.find(o => o.v === value) || { v: value, manual: true });
}
function add(card, type) {
  card.el.querySelector('.k-add').fire('click');
  const entry = modal.querySelectorAll('.addrow').find(r => r.getAttribute('data-full') === type);
  assert(entry, type + ' is offered, including an already present type');
  assert(!entry.classList.contains('locked'), 'existing attribute is not locked');
  assert(!entry.classList.contains('on'), 'adding starts with an empty selection');
  entry.fire('click');
  modal.querySelectorAll('.k-btn').find(b => b.textContent === '添加所选').fire('click');
}

// Inherited defaults are listed; opening does not write an override.
open('minecraft:diamond_sword');
const defaultCount = mods().length, untouched = c.snapOf(c.Store.doc());
assert(defaultCount >= 2);
let card = pageAttrs('melee', 'combat');
assert.equal(rows(card).length, defaultCount, 'default sword attack damage/speed are visible');
assert.equal(c.snapOf(c.Store.doc()), untouched);
expand(card, 0); select(card, 0, 1, 'head');
assert.equal(mods()[0].slot, 'head', 'inherited modifier can change slot');
c.Store.undo(); assert.equal(c.snapOf(c.Store.doc()), untouched, 'undo restores inheritance');
for (const [id, kind, tab] of [['minecraft:diamond_pickaxe', 'tool', 'mine'], ['minecraft:diamond_chestplate', 'armor', 'def']]) {
  open(id); card = pageAttrs(kind, tab);
  assert(mods().length > 0); assert.equal(rows(card).length, mods().length, kind + ' defaults are not filtered');
}

// Preserve original IDs and typed unknown data while changing slot/operation and adding the same type.
const original = c.parseSnbt('[{type:"minecraft:attack_damage",id:"minecraft:base_attack_damage",amount:6d,operation:"add_value",slot:"mainhand",extra:{n:9007199254740993L,bytes:[B;1b,2b]}},{type:"minecraft:attack_speed",id:"minecraft:base_attack_speed",amount:-2.4d,operation:"add_value",slot:"mainhand"},{type:"example:odd",id:"example:kept",amount:2d,operation:"add_value",slot:"offhand",extra:{flag:1b}}]');
open('minecraft:diamond_sword', { attribute_modifiers: original, 'example:component': c.parseSnbt('{keep:9007199254740993L}') });
card = pageAttrs('melee', 'combat');
const speed = plain(mods()[1]), unknown = plain(mods()[2]);
expand(card, 0); select(card, 0, 1, 'head'); select(card, 0, 0, 'add_multiplied_base');
let input = rows(card)[0].querySelector('input'); input.value = '25'; input.fire('change');
assert.equal(c.nbtNumberValue(mods()[0].amount), 0.25, 'percentage maps back to the modifier amount');
assert.equal(mods()[0].id, 'minecraft:base_attack_damage');
assert.deepEqual(plain(mods()[1]), speed); assert.deepEqual(plain(mods()[2]), unknown);
let text = c.nbtComponentText(c.Store.doc(), 'attribute_modifiers');
assert(text.includes('9007199254740993L')); assert(text.includes('[B;1b,2b]'));
add(card, 'minecraft:attack_damage');
assert.equal(mods().length, 4); assert.equal(mods()[3].slot, 'mainhand');
assert.equal(mods()[0].slot, 'head'); assert.equal(mods()[0].operation, 'add_multiplied_base');
assert.deepEqual(plain(mods()[1]), speed); assert.deepEqual(plain(mods()[2]), unknown);
select(card, 3, 1, 'offhand');
assert.equal(mods()[3].slot, 'offhand');
const saved = c.snapOf(c.Store.doc()), restored = c.nbtReadSnapshot(saved);
c.Store.open(restored, true); card = pageAttrs('melee', 'combat');
assert.equal(rows(card).length, 4); assert.equal(mods()[3].slot, 'offhand');
assert.equal(c.snapOf(c.Store.doc()), saved, 'reopening keeps the typed payload');
card.el.querySelector('.k-add').fire('click');
modal.querySelectorAll('.k-btn').find(b => b.textContent === '取消').fire('click');
assert.equal(c.snapOf(c.Store.doc()), saved, 'cancel does not change modifiers');

// Copy/delete/add cannot reuse an ID after the list shrinks.
rows(card)[0].fire('contextmenu'); context[0].run();
assert.equal(mods().length, 5); assert.notEqual(mods()[0].id, mods()[1].id);
assert(c.nbtComponentText(c.Store.doc(), 'attribute_modifiers').includes('[B;1b,2b]'));
rows(card)[2].querySelector('.del').fire('click');
add(card, 'minecraft:attack_damage');
assert.equal(new Set(mods().map(m => m.id)).size, mods().length, 'generated IDs remain unique after deletion');
const added = c.snapOf(c.Store.doc()); c.Store.undo(); card.update(); c.Store.redo(); card.update();
assert.equal(c.snapOf(c.Store.doc()), added, 'undo/redo preserves the added entry');

// A quick mainhand edit must not overwrite a vanilla-ID modifier moved to head.
open('minecraft:diamond_sword', { attribute_modifiers: [
  { type: 'minecraft:attack_damage', id: 'minecraft:base_attack_damage', amount: 6, operation: 'add_value', slot: 'head' },
  { type: 'minecraft:attack_speed', id: 'minecraft:base_attack_speed', amount: -2.4, operation: 'add_value', slot: 'mainhand' }
] });
card = c.CARDS.attackDamage(); input = card.el.querySelector('input'); input.value = '10'; input.fire('change');
assert.equal(mods()[0].amount, 6); assert.equal(mods()[0].slot, 'head');
assert.equal(c.attrSum('attack_damage', ['mainhand']) + 1, 10);
assert.equal(new Set(mods().map(m => m.id)).size, mods().length);

// The actual main-page card always opens the existing independent detail page, even without a component.
const integration = H.create(), ci = integration.c;
ci.window.EDITOR_PREVIEW = true; ci.Reg.meta = {}; ci.snd = () => {}; ci.toast = () => {}; ci.windowify = () => {};
for (const comps of [{}, { attribute_modifiers: [] }, { attribute_modifiers: [{ type: 'minecraft:attack_damage', id: 'test:damage', amount: 2, operation: 'add_value', slot: 'head' }] }]) {
  ci.Store.open({ id: 'minecraft:stick', count: 1, comps, removed: {} }, true);
  const main = ci.makeCard('extraAttrs'); integration.root.appendChild(main.el);
  assert(main.el.classList.contains('det-on'), 'attribute card keeps the detail-page entry even when empty');
  main.el.querySelector('.k-chead').fire('click');
  assert(integration.root.querySelector('#detailwin'), 'click opens the original independent detail window');
  assert.equal(ci.UI.detail.cid, 'attribute_modifiers');
  ci.closeModal(); main.el.remove();
}

// Real enum IDs remain authoritative; raw IDs receive localized labels in both list and readback.
for (const [locale, head, mainhand] of [['zh_cn', '头部', '主手'], ['en_us', 'Head', 'Main hand']]) {
  const localized = H.create({ data: { uiLocale: locale } }), cl = localized.c;
  cl.Reg.meta = {}; cl.Reg.kinds['enum:equipment_slot_group'] = { entries: [
    { id: 'head', name: 'head' }, { id: 'mainhand', name: 'mainhand' }, { id: 'custom_slot', name: 'Mod slot' }
  ], done: true };
  const options = cl.attributeSlotOptions();
  assert.equal(options.find(e => e.v === 'head').label, head);
  assert.equal(options.find(e => e.v === 'mainhand').label, mainhand);
  assert.equal(options.length, 3, 'no invented slot candidates');
  assert.equal(cl.attributeSlotLabel('head'), head);
  assert.equal(cl.attributeSlotLabel('custom_slot'), 'Mod slot', 'real registry name wins');
  cl.Tr.map['equipment_slot_group.head'] = 'Resource pack head';
  assert.equal(cl.attributeSlotLabel('head'), 'Resource pack head', 'game/resource-pack translation wins');
}
console.log('PASS inherited modifiers, slot/operation/percentage edits, repeated types, cancel/reopen, ID collisions, typed preservation, undo/redo, independent-page entry, live slot localization');
